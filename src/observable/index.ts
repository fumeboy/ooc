import type { ThreadContext } from "../thinkable/context";
import type { LlmGenerateResult, LlmMessage, LlmTool } from "../thinkable/llm/types";

// pause 能力先默认为 false，占位表达“暂停检查点存在”。
export function isPausing(thread: ThreadContext): Promise<boolean> | boolean {
  void thread;
  return false;
}

// LLM 输入记录先保留空实现，后续接入真实 debug 文件输出。
export function writeLatestLlmInput(
  thread: ThreadContext,
  messages: LlmMessage[],
  tools: LlmTool[]
): Promise<void> | void {
  void thread;
  void messages;
  void tools;
}

// LLM 输出记录同样先保留空实现，避免提前引入持久化细节。
export function writeLatestLlmOutput(
  thread: ThreadContext,
  result: LlmGenerateResult
): Promise<void> | void {
  void thread;
  void result;
}
