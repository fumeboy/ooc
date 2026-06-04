import { decidePermission, type PendingToolCall } from "../executable/permissions";
import { dispatchToolCall, getAvailableTools } from "../executable/tools";
import { beginLlmLoop, finishLlmLoop, isPausing } from "../observable";
import { writeThread } from "../persistable";
import { buildInputItems, type ProcessEvent, type ThreadContext } from "./context";
import {
  BudgetManager,
  loadBudgetThresholds,
  type BudgetThresholds,
} from "./context/budget";
import type { LlmClient, LlmInputItem, LlmToolCall } from "./llm/types";
import { LlmTimeoutError } from "./llm/timeout";

/** Default per-window budget for BudgetManager.allocate (soft threshold from config). */
const BUDGET_MANAGER = new BudgetManager();

/**
 * Construct a budget warning LlmInputItem for the current token estimate.
 *
 * Uses the same XML format <context_budget_warning current soft hard/> that the legacy
 * emergency guard used, so LLM behavior stays consistent.
 */
function buildBudgetWarningItem(
  currentTokens: number,
  thresholds: BudgetThresholds,
): LlmInputItem {
  return {
    type: "message",
    role: "system",
    content:
      `<context_budget_warning current="${currentTokens}" soft="${thresholds.soft}" hard="${thresholds.hard}"/>\n` +
      `当前估算 token 接近预算上限 (current=${currentTokens}, soft=${thresholds.soft}, hard=${thresholds.hard})。` +
      `系统已通过 BudgetManager 将低相关性窗口排除在 context 之外。你可主动 compress(scope=windows, target_ids=[...]) ` +
      `进一步精简，或继续推进任务。`,
  };
}

/**
 * Estimate total tokens for a set of context windows using the same heuristic
 * (JSON.stringify.length / 4) that BudgetManager uses internally.
 * Returns the sum across all windows.
 */
function estimateWindowsTokens(
  windows: import("../executable/windows/_shared/types").ContextWindow[],
): number {
  let total = 0;
  for (const w of windows) {
    try {
      total += Math.ceil(JSON.stringify(w).length / 4);
    } catch {
      total += 100;
    }
  }
  return total;
}

/**
 * 把 LlmToolCall 解析成 PermissionDecider 可消费的 PendingToolCall 载荷。
 *
 * - exec: 提取 args.command 作为实际 command 路径; args.window_id 作为目标 window
 * - close / wait / compress: command = toolName 自身; windowId/args 视情况
 *
 * Q0b: 当前 exec 的 args 形态为 `{ command, window_id, args, ... }` (见 tools/exec.ts);
 * 解析失败 / 字段缺失时退化为 command=toolName, 由后续 decidePermission 走 ObjectMethod
 * fallback 链。
 */
function buildPendingToolCall(toolCall: LlmToolCall): PendingToolCall {
  const args = toolCall.arguments ?? {};
  if (toolCall.name === "exec") {
    const innerMethod = typeof args.command === "string" ? args.command : undefined;
    const windowId = typeof args.window_id === "string" ? args.window_id : undefined;
    return {
      toolName: "exec",
      command: innerMethod ?? "exec",
      args: args.args,
      windowId,
    };
  }
  return {
    toolName: toolCall.name,
    command: toolCall.name,
    args,
  };
}

/** 截断长字符串到 200 字符 (Q0b: permission_ask / permission_denied 的 argsSummary)。 */
function summarizeArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  let text: string;
  try {
    text = typeof args === "string" ? args : JSON.stringify(args);
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  if (text.length <= 200) return text;
  return `${text.slice(0, 197)}...`;
}

/**
 * Q0c: 派发单个已 approved 的 pending tool call (从 permission_ask.pendingCall 重建 LlmToolCall)。
 *
 * 把"原本被 paused 的 tool call"按 approve 决定真正跑一遍, 写一条 function_call_output。
 * 失败路径与 think 主循环里 allow 分支保持一致 (写 ok:false + 上抛中止本轮)。
 */
async function dispatchApprovedToolCall(
  thread: ThreadContext,
  toolCall: LlmToolCall,
): Promise<void> {
  try {
    const output = (await dispatchToolCall(thread, toolCall))
      ?? JSON.stringify({ ok: true, tool: toolCall.name });
    let ok = true;
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === "object" && "ok" in parsed) {
        ok = Boolean((parsed as Record<string, unknown>).ok);
      }
    } catch {
      // output 不是 JSON 时默认认为成功
    }
    thread.events.push({
      category: "tool_runtime",
      kind: "function_call_output",
      callId: toolCall.id,
      toolName: toolCall.name,
      output,
      ok,
    });
  } catch (error) {
    thread.events.push({
      category: "tool_runtime",
      kind: "function_call_output",
      callId: toolCall.id,
      toolName: toolCall.name,
      output: JSON.stringify({ ok: false, error: (error as Error).message }),
      ok: false,
    });
    throw error;
  }
}

/**
 * Q0c: 处理本轮 thinkloop 入口前的"已决议 ask event"。
 *
 * 扫 thread.events 中最近一条 kind=permission_ask 且有 decided 字段的事件:
 * - approve → 用 pendingCall 重建 LlmToolCall 并 dispatch
 * - reject  → 写 permission_denied event + 合成 function_call_output (denied: user-rejected)
 *
 * 无待处理的 decided ask → 直接返回 (false), 调用方继续走正常 thinkloop。
 *
 * 返回 true 表示本轮已被 HITL 决议消费; 调用方仍继续跑常规 thinkloop (再发一次 LLM)。
 * 决议过的 event 不会再次被处理 (decided 字段已持久化, 不会重复触发)。
 */
async function processDecidedPermissionAsks(thread: ThreadContext): Promise<boolean> {
  // 倒序扫 — 只关心"最近一条"刚被 HTTP endpoint 写入 decided 的 ask
  // (HTTP endpoint 一次只 decide 一条; 多次 HITL 也是逐条来的)
  for (let i = thread.events.length - 1; i >= 0; i -= 1) {
    const event = thread.events[i];
    if (event.category !== "permission" || event.kind !== "permission_ask") continue;
    if (!event.decided) continue;
    // 找到了 — 但还得确认它还没被 follow-up output 消费 (幂等保护):
    // 扫 event 之后的事件, 看是否已经有 toolCallId 对应的 function_call_output
    const alreadyHandled = thread.events
      .slice(i + 1)
      .some(
        (e) =>
          e.category === "tool_runtime" &&
          e.kind === "function_call_output" &&
          e.callId === event.toolCallId,
      );
    if (alreadyHandled) return false;

    if (event.decided.action === "approve") {
      const pc = event.pendingCall;
      if (!pc) {
        // pendingCall 不应缺失 (写 ask event 时必填); 缺失时退化为写 denied,
        // 避免静默吞噬 (silent-swallow ban)。
        thread.events.push({
          category: "permission",
          kind: "permission_denied",
          toolCallId: event.toolCallId,
          command: event.command,
          reason: "approve received but pendingCall missing; cannot replay",
          windowId: event.windowId,
        });
        thread.events.push({
          category: "tool_runtime",
          kind: "function_call_output",
          callId: event.toolCallId,
          toolName: "exec",
          output: JSON.stringify({
            ok: false,
            error: "approve received but pendingCall missing; cannot replay",
          }),
          ok: false,
        });
        return true;
      }
      const reconstructed: LlmToolCall = {
        id: pc.toolCallId,
        name: pc.toolName,
        arguments: pc.args,
      };
      await dispatchApprovedToolCall(thread, reconstructed);
      return true;
    }

    // reject 路径
    const reason = `user-rejected: ${event.decided.reason ?? ""}`.trim();
    thread.events.push({
      category: "permission",
      kind: "permission_denied",
      toolCallId: event.toolCallId,
      command: event.command,
      reason,
      argsSummary: event.argsSummary,
      windowId: event.windowId,
    });
    thread.events.push({
      category: "tool_runtime",
      kind: "function_call_output",
      callId: event.toolCallId,
      toolName: "exec",
      output: JSON.stringify({
        ok: false,
        tool: "exec",
        error: `permission denied: ${reason}`,
      }),
      ok: false,
    });
    return true;
  }
  return false;
}

/**
 * Q0c: 扫 thread.events 中所有 approved 的 ask event, 返回 toolCallId 集合。
 *
 * thinkloop 在 dispatch 前用这个集合短路 decidePermission — approved 过的 call 直接 allow,
 * 避免 "approve 后再调 decidePermission 又返回 ask, 无限循环"。
 *
 * 注意: 与 processDecidedPermissionAsks 不同, 本函数只读, 用于"本轮新 tool call 是否
 * 撞上了历史已 approve 的 callId"判断。实际正常路径里, approved 的 callId 在
 * processDecidedPermissionAsks 中已被 replay, 不会再次出现; 但 LLM 在后续轮中可能
 * 引用旧 callId — 这种异常情况下短路掉避免再次 ask。
 */
function collectApprovedToolCallIds(thread: ThreadContext): Set<string> {
  const ids = new Set<string>();
  for (const event of thread.events) {
    if (
      event.category === "permission" &&
      event.kind === "permission_ask" &&
      event.decided?.action === "approve"
    ) {
      ids.add(event.toolCallId);
    }
  }
  return ids;
}

function latestAssistantText(thread: ThreadContext): string | undefined {
  for (const event of [...thread.events].reverse()) {
    if (event.category === "llm_interaction" && event.kind === "text") {
      return event.text;
    }
  }
  return undefined;
}

// think 是单轮执行器，只负责编排本轮顺序，不承担 scheduler 和持久化。
export async function think(thread: ThreadContext, llmClient: LlmClient): Promise<void> {
  // 当前单轮执行只接受 running 状态，其他状态直接视为调用方错误。
  if (thread.status !== "running") {
    throw new Error(`think 只能处理 running 线程: ${thread.id}`);
  }

  let loopHandle:
    | Awaited<ReturnType<typeof beginLlmLoop>>
    | undefined;
  try {
    // Q0c: 在做任何 LLM 调用前, 先看看是否有"上一轮 ask + 本轮被 HITL 批准/拒绝"的待处理 event。
    // 走 HTTP /api/.../permission 路径后, endpoint 写入 decided 字段并把 status 翻回 running。
    // 这里检测并消费一次, 然后继续走常规 thinkloop (LLM 在下一轮看到 approved/rejected
    // 渲染 + function_call_output, 决定下一步)。
    await processDecidedPermissionAsks(thread);

    // P6 BudgetManager: rank windows by relevance and trim to budget.
    // Replaces legacy applyNaturalDecay (compressLevel advancement by rounds)
    // and applyEmergencyGuard (three-wave hard thresholding).
    // compressLevel is now exclusively controlled by explicit LLM compress/expand commands.
    const thresholds = loadBudgetThresholds(thread);
    const allocation = BUDGET_MANAGER.allocate(thread.contextWindows ?? [], thresholds.hard);

    // Replace thread.contextWindows with only the in-budget windows for this round.
    // This is a transient effect — buildInputItems reads from thread.contextWindows,
    // and the persistable layer will write the trimmed set back to thread.json.
    // Overflow windows are tracked via a context_compressed visibility event so the
    // LLM knows some windows were excluded (silent-swallow ban).
    if (allocation.overflow.length > 0) {
      thread.contextWindows = allocation.visible;
      const overflowSummary = allocation.overflow
        .map((o) => `${o.id}(relevance=${o.relevance.toFixed(2)})`)
        .join(",");
      thread.events.push({
        category: "context_change",
        kind: "context_compressed",
        windowIds: allocation.overflow.map((o) => o.id),
        levelChange: "budget_excluded",
        reason: "budget_manager_allocation",
        scope: "auto",
      });
    }

    // P6 budget warning: if the in-budget windows still exceed soft threshold,
    // inject a transient warning system message (not persisted to events,
    // only affects this round's LLM input).
    const currentTokens = estimateWindowsTokens(allocation.visible);
    const budgetWarning = currentTokens > thresholds.soft
      ? buildBudgetWarningItem(currentTokens, thresholds)
      : undefined;

    // Context 模块先直接返回 LLM messages，避免中间层抽象。
    const llmInput = await buildInputItems(thread);
    const tools = getAvailableTools(thread);

    // P6 budget warning: if budget soft threshold exceeded, inject a transient
    // <context_budget_warning .../> system message. Only affects this round's
    // LLM input — not persisted to thread.events.
    if (budgetWarning) {
      // 插在第一条 (XML context system message) 之后,使 LLM 看到 context 后立即看到警告
      llmInput.input = [llmInput.input[0], budgetWarning, ...llmInput.input.slice(1)];
    }

    // 输入输出记录点先挂到 observable 占位模块上。
    loopHandle = await beginLlmLoop(thread, llmInput.input, tools);

    // 中断恢复锚点: beginLlmLoop 已写 llm.input.json, 现在把 call_started 事件落进 thread.json,
    // 让磁盘上的 thread.json 与 debug llm.input.json atomic 对应。任何"call_started 之后无
    // 任何 llm_interaction 后续"的 thread.json 即被 detectInterruptedThread 判定为中断。
    // 见 src/thinkable/recovery.ts。
    thread.events.push({
      category: "llm_interaction",
      kind: "call_started",
      loopIndex: loopHandle.loopIndex,
    });
    await writeThread(thread);

    const result = await llmClient.generate({
      input: llmInput.input,
      instructions: llmInput.instructions,
      tools,
      // 根因 #1: 任务级超时覆盖透传到 client；缺省回落全局默认。
      timeoutMs: thread.llmTimeoutMs,
    });

    // thinking 只记录，不负责回注到下一轮 context。
    if (result.thinking) {
      thread.events.push({
        category: "llm_interaction",
        kind: "thinking",
        text: result.thinking
      });
    }

    // 文本输出进入 process events，供后续 context-builder 消费；完全重复的文本不再追加。
    if (result.text && latestAssistantText(thread) !== result.text) {
      thread.events.push({
        category: "llm_interaction",
        kind: "text",
        text: result.text
      });
    }

    // tool call 先记录，再由 executable 占位模块顺序执行。
    for (const toolCall of result.toolCalls) {
      thread.events.push({
        category: "llm_interaction",
        kind: "function_call",
        callId: toolCall.id,
        toolName: toolCall.name,
        arguments: toolCall.arguments
      });
    }

    // pause 必须发生在输出记录之后、tool 执行之前。
    if (await isPausing(thread)) {
      await finishLlmLoop(thread, loopHandle, { result, status: "paused" });
      thread.status = "paused";
      return;
    }

    // Q0b/Q0c: 在 dispatch 前对每个 pending tool call 做 permission 检查。
    // 三档语义 (design: docs/2026-05-25-permission-model-design.md):
    //   allow → 继续 dispatchToolCall
    //   ask   → 写 permission_ask event (含 pendingCall 序列化) + thread.status="paused" + return
    //           Q0c: 控制面 /api/.../permission 写入 decided 字段后, 下一轮 thinkloop
    //                由 processDecidedPermissionAsks 重放或拒绝
    //   deny  → 写 permission_denied event + 合成 function_call_output(让 LLM 看见,
    //           silent-swallow ban + Deny 信息流不变量) + 跳过本 tool call 的 dispatch
    //
    // Q0c 短路: 历史已 approved 的 toolCallId 跳过 decidePermission 直接 allow,
    // 避免"approve 后又被打回 ask"无限循环。
    const approvedIds = collectApprovedToolCallIds(thread);

    for (const toolCall of result.toolCalls) {
      const pending = buildPendingToolCall(toolCall);
      const decision = approvedIds.has(toolCall.id)
        ? ({ decision: "allow" } as const)
        : await decidePermission(thread, pending);

      if (decision.decision === "deny") {
        const denyEvent: ProcessEvent = {
          category: "permission",
          kind: "permission_denied",
          toolCallId: toolCall.id,
          command: pending.command ?? toolCall.name,
          reason: decision.reason,
          argsSummary: summarizeArgs(pending.args ?? toolCall.arguments),
          windowId: pending.windowId,
        };
        thread.events.push(denyEvent);
        // 合成 function_call_output, LLM 下一轮可以看到 (Deny 信息流不变量)
        thread.events.push({
          category: "tool_runtime",
          kind: "function_call_output",
          callId: toolCall.id,
          toolName: toolCall.name,
          output: JSON.stringify({
            ok: false,
            tool: toolCall.name,
            error: `permission denied: ${decision.reason}`,
          }),
          ok: false,
        });
        continue;
      }

      if (decision.decision === "ask") {
        // Q0c: pendingCall 序列化整条 tool call, 让 approve 后的 resume 路径
        // (processDecidedPermissionAsks) 能直接重放, 不依赖 LLM 再次发起。
        const askEvent: ProcessEvent = {
          category: "permission",
          kind: "permission_ask",
          toolCallId: toolCall.id,
          command: pending.command ?? toolCall.name,
          argsSummary: summarizeArgs(pending.args ?? toolCall.arguments),
          windowId: pending.windowId,
          pendingCall: {
            toolName: toolCall.name,
            command: pending.command ?? toolCall.name,
            args: toolCall.arguments,
            windowId: pending.windowId,
            toolCallId: toolCall.id,
          },
        };
        thread.events.push(askEvent);
        await finishLlmLoop(thread, loopHandle, { result, status: "paused" });
        thread.status = "paused";
        return;
      }

      // allow → 继续走 dispatchToolCall
      try {
        const output = (await dispatchToolCall(thread, toolCall))
          ?? JSON.stringify({ ok: true, tool: toolCall.name });
        // 解析 handler 返回的 JSON output 中的 ok 字段;handler 用 {ok:false,...} 报业务错时,
        // event.ok 也要跟着 false,以便 UI 和后续逻辑能正确识别失败。
        // 旧实现硬写 ok:true 导致 LLM 端拿到错误消息但 event 显示 ok。
        let ok = true;
        try {
          const parsed = JSON.parse(output);
          if (parsed && typeof parsed === "object" && "ok" in parsed) {
            ok = Boolean((parsed as Record<string, unknown>).ok);
          }
        } catch {
          // output 不是 JSON 时默认认为成功(handler 没遵循 ok-shape)
        }
        thread.events.push({
          category: "tool_runtime",
          kind: "function_call_output",
          callId: toolCall.id,
          toolName: toolCall.name,
          output,
          ok,
        });
      } catch (error) {
        thread.events.push({
          category: "tool_runtime",
          kind: "function_call_output",
          callId: toolCall.id,
          toolName: toolCall.name,
          output: JSON.stringify({ ok: false, error: (error as Error).message }),
          ok: false
        });
        await finishLlmLoop(thread, loopHandle, {
          result,
          status: "error",
          error: (error as Error).message
        });
        thread.events.push({
          category: "context_change",
          kind: "inject",
          text: (error as Error).message
        });
        return;
      }
    }
    await finishLlmLoop(thread, loopHandle, { result, status: "ok" });
  } catch (error) {
    const message = (error as Error).message;
    if (loopHandle) {
      await finishLlmLoop(thread, loopHandle, {
        status: "error",
        error: message
      });
    }
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: message
    });
    thread.status = "failed";
    // 根因 #4: 给 failed 终态补结构化失败原因，让 worker 对账 + 控制面直接读，
    // 不必去 events 里扒文本。LlmTimeoutError → "llm_timeout"；其他 → "think_error"。
    thread.statusReason = error instanceof LlmTimeoutError ? "llm_timeout" : "think_error";
    thread.lastError = message;
  }
}
