import { dispatchToolCall, getAvailableTools } from "../executable/tools";
import { beginLlmLoop, finishLlmLoop, isPausing } from "../observable";
import { buildInputItems, type ThreadContext } from "./context";
import type { LlmClient } from "./llm/types";

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
    // Context 模块先直接返回 LLM messages，避免中间层抽象。
    const llmInput = await buildInputItems(thread);
    const tools = getAvailableTools(thread);

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
