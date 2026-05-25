import { dispatchToolCall, getAvailableTools } from "../executable/tools";
import { beginLlmLoop, finishLlmLoop, isPausing } from "../observable";
import { buildInputItems, type ThreadContext } from "./context";
import {
  applyEmergencyGuard,
  applyNaturalDecay,
  loadBudgetThresholds,
  loadDecayConfig,
  type BudgetWarning,
} from "./context/budget";
import type { LlmClient, LlmInputItem } from "./llm/types";

/**
 * 构造 P0e emergency guard 的临时警告 LlmInputItem。
 *
 * 选型说明 (instruction E4):
 * - 选 "临时 system message" 而非 "临时 ContextWindow":
 *   1. ContextWindow 是 first-class object,渲染层会按 type-dispatch 调度;
 *      只为本轮警告新建一种 window type 太重,且要管理生命周期 (本轮注入 / 下轮清除)。
 *   2. system message 是 LLM input 协议自带的"环境信息"角色,与 [ooc:paths] 同档,
 *      天然符合"本轮 transient"语义——下一轮 buildInputItems 重新构造,不会残留。
 *   3. 不写入 thread.events 即满足"只本轮生效不污染历史"——避免下一轮看到"过期的旧警告"。
 *
 * 警告内容用 design §4.4 描述的 XML 形式 (<context_budget_warning current soft hard/>),
 * LLM 看到后**自行决定**是否主动调用 compress(scope=windows) 或继续推理 (兜底已由系统做完)。
 */
function buildBudgetWarningItem(warning: BudgetWarning): LlmInputItem {
  return {
    type: "message",
    role: "system",
    content:
      `<context_budget_warning current="${warning.current}" soft="${warning.soft}" hard="${warning.hard}"/>\n` +
      `当前估算 token 接近预算上限 (current=${warning.current}, soft=${warning.soft}, hard=${warning.hard})。` +
      `若超过 hard,系统已自动降级部分 window 与 events。你可主动 compress(scope=windows, target_ids=[...]) ` +
      `进一步精简,或继续推进任务。`,
  };
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
    // P0d: 在 buildContext 前推进自然衰减计数器,可能写入若干 context_compressed 事件,
    // 并把若干 idle/老旧 window 切到压缩态。design §4.3 / meta:context_budget.natural_decay。
    // failure-safe: 衰减失败不应阻塞 think 一轮——但当前实现是纯内存操作,几乎不可能抛错。
    const decayCfg = loadDecayConfig(thread);
    applyNaturalDecay(thread, decayCfg);

    // P0e: emergency budget guard。tokens 估算 → soft 警告 → hard 三波兜底。
    // design §4.4 / meta:context_budget.emergency_guard。warning 仅本轮生效,不持久化。
    const guard = applyEmergencyGuard(thread, loadBudgetThresholds(thread));

    // Context 模块先直接返回 LLM messages，避免中间层抽象。
    const llmInput = await buildInputItems(thread);
    const tools = getAvailableTools(thread);

    // P0e: 若 guard 报告了警告,把一条 <context_budget_warning .../> system message
    // 注入到 llmInput.input 顶部 (XML context message 之后),让 LLM 在本轮真的看见。
    // **临时**注入:仅作用于本次 generate 调用,不写入 thread.events (下一轮重新评估)。
    if (guard.warning) {
      const warnItem = buildBudgetWarningItem(guard.warning);
      // 插在第一条 (XML context system message) 之后,使 LLM 看到 context 后立即看到警告
      llmInput.input = [llmInput.input[0], warnItem, ...llmInput.input.slice(1)];
    }

    // 输入输出记录点先挂到 observable 占位模块上。
    loopHandle = await beginLlmLoop(thread, llmInput.input, tools);
    const result = await llmClient.generate({
      input: llmInput.input,
      instructions: llmInput.instructions,
      tools
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

    for (const toolCall of result.toolCalls) {
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
    if (loopHandle) {
      await finishLlmLoop(thread, loopHandle, {
        status: "error",
        error: (error as Error).message
      });
    }
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: (error as Error).message
    });
    thread.status = "failed";
  }
}
