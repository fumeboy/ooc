import { decidePermission, type PendingToolCall } from "../executable/permissions";
import { dispatchToolCall, getAvailableTools } from "../executable/tools";
import { beginLlmLoop, finishLlmLoop, isPausing } from "../observable";
import { writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";
import type { ProcessEvent, ThreadContext } from "../_shared/types/thread.js";
// thinkable 模块经 registry 解析（thinkableOf）调用——core 不再静态 import thread builtin 的
// context 构造 / compress policy；buildInputItems / appendEvents / compress 钩子全归 thread.thinkable。
import { thinkableOf } from "./resolve.js";
import type { LlmClient, LlmGenerateResult, LlmToolCall } from "./llm/types";
import { LlmTimeoutError } from "./llm/timeout";

/** 把 core 本步产出的 ProcessEvent 折进 thread 历史——经 thread.thinkable.appendEvents 单一 ingest。 */
function record(thread: ThreadContext, ...events: ProcessEvent[]): void {
  thinkableOf(thread).appendEvents({ thread }, events);
}

/**
 * 把 LlmToolCall 解析成 PermissionDecider 可消费的 PendingToolCall 载荷。
 *
 * - exec: 提取 args.method 作为实际 method 路径; args.window_id 作为目标 window
 * - close / wait / compress: method = toolName 自身; windowId/args 视情况
 *
 * exec 的 args 形态为 `{ method, window_id, args, ... }` (见 tools/exec.ts);
 * 解析失败 / 字段缺失时退化为 method=toolName, 由后续 decidePermission 走 ObjectMethod
 * fallback 链。
 */
function buildPendingToolCall(toolCall: LlmToolCall): PendingToolCall {
  const args = toolCall.arguments ?? {};
  if (toolCall.name === "exec") {
    const innerMethod = typeof args.method === "string" ? args.method : undefined;
    const windowId = typeof args.window_id === "string" ? args.window_id : undefined;
    return {
      toolName: "exec",
      method: innerMethod ?? "exec",
      args: args.args,
      windowId,
    };
  }
  return {
    toolName: toolCall.name,
    method: toolCall.name,
    args,
  };
}

/** 截断长字符串到 200 字符 (permission_ask / permission_denied 的 argsSummary)。 */
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
 * 派发单个已 approved 的 pending tool call (从 permission_ask.pendingCall 重建 LlmToolCall)。
 *
 * 把"原本被 paused 的 tool call"按 approve 决定真正跑一遍, 写一条 function_call_output。
 * 失败路径与 think 主循环里 allow 分支保持一致 (写 ok:false + 上抛中止本轮)。
 */
async function dispatchApprovedToolCall(
  thread: ThreadContext,
  toolCall: LlmToolCall,
): Promise<void> {
  try {
    const output = await dispatchToolCall(thread, toolCall);
    let ok = true;
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === "object" && "ok" in parsed) {
        ok = Boolean((parsed as Record<string, unknown>).ok);
      }
    } catch {
      // output 不是 JSON 时默认认为成功
    }
    record(thread, {
      category: "tool_runtime",
      kind: "function_call_output",
      callId: toolCall.id,
      toolName: toolCall.name,
      output,
      ok,
    });
  } catch (error) {
    record(thread, {
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
 * 处理本轮 thinkloop 入口前的"已决议 ask event"。
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
        record(thread, {
          category: "permission",
          kind: "permission_denied",
          toolCallId: event.toolCallId,
          method: event.method,
          reason: "approve received but pendingCall missing; cannot replay",
          windowId: event.windowId,
        });
        record(thread, {
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
    record(thread, {
      category: "permission",
      kind: "permission_denied",
      toolCallId: event.toolCallId,
      method: event.method,
      reason,
      argsSummary: event.argsSummary,
      windowId: event.windowId,
    });
    record(thread, {
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
 * 扫 thread.events 中所有 approved 的 ask event, 返回 toolCallId 集合。
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

/**
 * permission / tool dispatch 循环。
 *
 * 对本轮每个 pending tool call 依次做 permission 决策并派发：
 *   - allow → dispatchToolCall（含 ok 字段解析 + 错误处理）
 *   - ask   → 写 permission_ask event（含 pendingCall 序列化）+ paused + 中止本轮
 *   - deny  → 写 permission_denied event + 合成 function_call_output + 跳过本 tool call
 *
 * 短路：历史已 approved 的 toolCallId 跳过 decidePermission 直接 allow，
 * 避免"approve 后又被打回 ask"无限循环。
 *
 * 依赖（thread / result / loopHandle）显式传入，不靠闭包隐式捕获。
 * 返回 outcome 让调用方决定后续：
 *   - "completed" → 全部 dispatch 完，调用方写 finishLlmLoop(ok)
 *   - "paused"    → ask 分支已 finishLlmLoop(paused) + 置 thread.status，调用方直接 return
 *   - "error"     → dispatch 抛错分支已 finishLlmLoop(error) + 写 inject，调用方直接 return
 */
async function runToolDispatchLoop(
  thread: ThreadContext,
  result: LlmGenerateResult,
  loopHandle: Awaited<ReturnType<typeof beginLlmLoop>>,
): Promise<"completed" | "paused" | "error"> {
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
        method: pending.method ?? toolCall.name,
        reason: decision.reason,
        argsSummary: summarizeArgs(pending.args ?? toolCall.arguments),
        windowId: pending.windowId,
      };
      record(thread, denyEvent);
      // 合成 function_call_output, LLM 下一轮可以看到 (Deny 信息流不变量)
      record(thread, {
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
      // pendingCall 序列化整条 tool call, 让 approve 后的 resume 路径
      // (processDecidedPermissionAsks) 能直接重放, 不依赖 LLM 再次发起。
      const askEvent: ProcessEvent = {
        category: "permission",
        kind: "permission_ask",
        toolCallId: toolCall.id,
        method: pending.method ?? toolCall.name,
        argsSummary: summarizeArgs(pending.args ?? toolCall.arguments),
        windowId: pending.windowId,
        pendingCall: {
          toolName: toolCall.name,
          method: pending.method ?? toolCall.name,
          args: toolCall.arguments,
          windowId: pending.windowId,
          toolCallId: toolCall.id,
        },
      };
      record(thread, askEvent);
      await finishLlmLoop(thread, loopHandle, { result, status: "paused" });
      thread.status = "paused";
      return "paused";
    }

    // allow → 继续走 dispatchToolCall
    try {
      const output = await dispatchToolCall(thread, toolCall);
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
      record(thread, {
        category: "tool_runtime",
        kind: "function_call_output",
        callId: toolCall.id,
        toolName: toolCall.name,
        output,
        ok,
      });
    } catch (error) {
      record(thread, {
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
      record(thread, {
        category: "context_change",
        kind: "inject",
        text: (error as Error).message,
        source: "thinkable/thinkloop#runToolDispatchLoop.catch",
        errorCode: "tool_dispatch_error",
        stack: (error as Error).stack,
        dataPreview: JSON.stringify({
          tool: toolCall.name,
          callId: toolCall.id,
          argsKeys: Object.keys(toolCall.arguments ?? {})
        }).slice(0, 200)
      });
      return "error";
    }
  }
  return "completed";
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
    // 在做任何 LLM 调用前, 先看看是否有"上一轮 ask + 本轮被 HITL 批准/拒绝"的待处理 event。
    // 走 HTTP /api/.../permission 路径后, endpoint 写入 decided 字段并把 status 翻回 running。
    // 这里检测并消费一次, 然后继续走常规 thinkloop (LLM 在下一轮看到 approved/rejected
    // 渲染 + function_call_output, 决定下一步)。
    await processDecidedPermissionAsks(thread);

    // Context 模块直接返回本轮 LLM input。预算分配（按相关性排序、超 budget 的窗口归入
    // overflow）由 buildInputItems → pipeline.run 唯一负责：overflow 经 renderer 的
    // <context_overflow> 呈现，soft 档警告由 buildInputItems 注入。thinkloop 不再自行
    // 裁剪 thread.contextWindows——窗口是持久实体，仅由显式 close/compress 移除。
    const llmInput = await thinkableOf(thread).buildInputItems({ thread });

    // compress v2 auto-trigger：未总结 transcript 超 autoCompressLevel 阈值（或 compress 置 intent）
    // 且无在途 compress → fork 一条 summarizer 子线程压缩早期过程（dormant：未 resize/intent 且未超阈值时 no-op）。
    await thinkableOf(thread).maybeAutoCompress({ thread }, llmInput.transcriptTokens ?? 0);

    // compress v2 force-wait：context 超 hard 且有在途 compress → 切 waiting、本轮不 LLM call
    // （等 summarizer 富摘要、不给 LLM 看 lossy clamp）；无在途则照走 buildInputItems clamp floor。
    if (thinkableOf(thread).maybeForceWaitForCompress({ thread }, llmInput.transcriptTokens ?? 0)) {
      await writeThread(thread);
      return;
    }

    // compress v2：summarizer fork 不给工具——强制单轮纯文本摘要响应（无 tool call 诱惑），
    // 首轮文本即被下方 isSummarizer 分支捕获为 endSummary。
    const tools = thread.isSummarizer ? [] : getAvailableTools(thread);

    // 输入输出记录点挂到 observable。
    loopHandle = await beginLlmLoop(thread, llmInput.input, tools);

    // 中断恢复锚点: beginLlmLoop 已写 llm.input.json, 现在把 call_started 事件落进 thread.json,
    // 让磁盘上的 thread.json 与 debug llm.input.json atomic 对应。任何"call_started 之后无
    // 任何 llm_interaction 后续"的 thread.json 即被 detectInterruptedThread 判定为中断。
    // 见 ./recovery.ts。
    record(thread, {
      category: "llm_interaction",
      kind: "call_started",
      loopIndex: loopHandle.loopIndex,
    });
    await writeThread(thread);

    const result = await llmClient.generate({
      input: llmInput.input,
      instructions: llmInput.instructions,
      tools,
      // 任务级超时覆盖透传到 client；缺省回落全局默认。
      timeoutMs: thread.llmTimeoutMs,
    });

    // thinking 只记录，不负责回注到下一轮 context。
    if (result.thinking) {
      record(thread, {
        category: "llm_interaction",
        kind: "thinking",
        text: result.thinking
      });
    }

    // 文本输出进入 process events，供后续 context-builder 消费；完全重复的文本不再追加。
    if (result.text && latestAssistantText(thread) !== result.text) {
      record(thread, {
        category: "llm_interaction",
        kind: "text",
        text: result.text
      });
    }

    // compress v2：summarizer fork **单轮即完成**（镜像 CC single-turn Fork Agent）——首轮 LLM 文本即摘要，
    // 不进多轮 agent loop、不派发 tool、不依赖 agency-end。scheduler harvest 读 thread.endSummary 折入父窗
    // summarizedRanges。无文本时置空摘要（harvest 兜底占位）。
    if (thread.isSummarizer) {
      thread.endSummary = (result.text ?? "").trim();
      thread.status = "done";
      await finishLlmLoop(thread, loopHandle, { result, status: "ok" });
      return;
    }

    // tool call 先记录，再由 executable 顺序执行。
    for (const toolCall of result.toolCalls) {
      record(thread, {
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

    // 在 dispatch 前对每个 pending tool call 做 permission 检查 + 派发（三档语义）：
    //   allow → 继续 dispatchToolCall
    //   ask   → 写 permission_ask event (含 pendingCall 序列化) + thread.status="paused" + return
    //           控制面 /api/.../permission 写入 decided 字段后, 下一轮 thinkloop
    //           由 processDecidedPermissionAsks 重放或拒绝
    //   deny  → 写 permission_denied event + 合成 function_call_output(让 LLM 看见,
    //           silent-swallow ban + Deny 信息流不变量) + 跳过本 tool call 的 dispatch
    //
    // paused/error 分支已在 runToolDispatchLoop 内部 finishLlmLoop + 置 thread.status，
    // 这里据 outcome 决定是否提前返回。
    const outcome = await runToolDispatchLoop(thread, result, loopHandle);
    if (outcome !== "completed") return;
    await finishLlmLoop(thread, loopHandle, { result, status: "ok" });
  } catch (error) {
    const message = (error as Error).message;
    if (loopHandle) {
      await finishLlmLoop(thread, loopHandle, {
        status: "error",
        error: message
      });
    }
    record(thread, {
      category: "context_change",
      kind: "inject",
      text: message,
      source: "thinkable/thinkloop#think.catch",
      errorCode: error instanceof LlmTimeoutError ? "llm_timeout" : "think_error",
      stack: (error as Error).stack
    });
    thread.status = "failed";
    // 给 failed 终态补结构化失败原因，让 worker 对账 + 控制面直接读，
    // 不必去 events 里扒文本。LlmTimeoutError → "llm_timeout"；其他 → "think_error"。
    thread.statusReason = error instanceof LlmTimeoutError ? "llm_timeout" : "think_error";
    thread.lastError = message;
  }
}
