import { dispatchToolCall, getAvailableTools } from "../executable/tools";
import { beginLlmLoop, finishLlmLoop, isPausing } from "../observable";
import { buildInputItems, type ThreadContext } from "./context";
import type { LlmClient } from "./llm/types";

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

    // 文本输出进入 process events，供后续 context-builder 消费。
    if (result.text) {
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
        thread.events.push({
          category: "tool_runtime",
          kind: "function_call_output",
          callId: toolCall.id,
          toolName: toolCall.name,
          output,
          ok: true
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
