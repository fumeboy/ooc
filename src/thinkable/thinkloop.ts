import { dispatchToolCall, getAvailableTools } from "../executable/tools";
import { isPausing, writeLatestLlmInput, writeLatestLlmOutput } from "../observable";
import { buildContext, type ThreadContext } from "./context";
import type { LlmClient } from "./llm/types";

// think 是单轮执行器，只负责编排本轮顺序，不承担 scheduler 和持久化。
export async function think(thread: ThreadContext, llmClient: LlmClient): Promise<void> {
  // 当前单轮执行只接受 running 状态，其他状态直接视为调用方错误。
  if (thread.status !== "running") {
    throw new Error(`think 只能处理 running 线程: ${thread.id}`);
  }

  try {
    // Context 模块先直接返回 LLM messages，避免中间层抽象。
    const messages = await buildContext(thread);
    const tools = getAvailableTools(thread);

    // 输入输出记录点先挂到 observable 占位模块上。
    await writeLatestLlmInput(thread, messages, tools);
    const result = await llmClient.generate({ messages, tools });

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
        kind: "tool_use",
        toolName: toolCall.name,
        arguments: toolCall.arguments
      });
    }

    await writeLatestLlmOutput(thread, result);

    // pause 必须发生在输出记录之后、tool 执行之前。
    if (await isPausing(thread)) {
      thread.status = "paused";
      return;
    }

    for (const toolCall of result.toolCalls) {
      try {
        await dispatchToolCall(thread, toolCall);
      } catch (error) {
        thread.events.push({
          category: "context_change",
          kind: "inject",
          text: (error as Error).message
        });
        return;
      }
    }
  } catch (error) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: (error as Error).message
    });
    thread.status = "failed";
  }
}
