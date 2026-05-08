import type { ThreadContext } from "../thinkable/context";
import type { LlmTool, LlmToolCall } from "../thinkable/llm/types";

// getAvailableTools 先返回空数组，占位表达“工具入口已建立”。
export function getAvailableTools(thread: ThreadContext): LlmTool[] {
  void thread;
  return [];
}

// dispatchToolCall 先提供空实现，后续接入真实 executable 能力。
export async function dispatchToolCall(
  thread: ThreadContext,
  toolCall: LlmToolCall
): Promise<void> {
  void thread;
  void toolCall;
}
