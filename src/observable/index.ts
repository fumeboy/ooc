import type { ThreadContext } from "../thinkable/context";
import type { LlmGenerateResult, LlmMessage, LlmTool } from "../thinkable/llm/types";
import { writeDebugInput, writeDebugOutput } from "../persistable";

/** 最近一次 LLM 输入/输出观测快照，用于本地调试和测试断言。 */
export type LlmObservation = {
  /** 调用 provider 前记录的输入。 */
  input?: {
    /** 触发本次请求的线程 ID。 */
    threadId: string;
    /** 传给 LLM 的完整 messages。 */
    messages: LlmMessage[];
    /** 本轮暴露的 tool 定义。 */
    tools: LlmTool[];
  };
  /** provider 返回后记录的输出。 */
  output?: {
    /** 触发本次请求的线程 ID。 */
    threadId: string;
    /** 统一 LLM 结果。 */
    result: LlmGenerateResult;
  };
};

let latestLlmObservation: LlmObservation | undefined;

/** pause 能力先默认为 false，占位表达“暂停检查点存在”。 */
export function isPausing(thread: ThreadContext): Promise<boolean> | boolean {
  void thread;
  return false;
}

/** 清空最近一次 LLM 观测，避免测试之间互相污染。 */
export function clearLatestLlmObservation(): void {
  latestLlmObservation = undefined;
}

/** 读取最近一次 LLM 输入/输出观测快照。 */
export function getLatestLlmObservation(): LlmObservation | undefined {
  return latestLlmObservation;
}

/** 记录最近一次 LLM 输入快照；线程带 persistence 时同步落盘。 */
export async function writeLatestLlmInput(
  thread: ThreadContext,
  messages: LlmMessage[],
  tools: LlmTool[]
): Promise<void> {
  latestLlmObservation = {
    ...latestLlmObservation,
    input: {
      threadId: thread.id,
      messages,
      tools
    }
  };
  if (thread.persistence) {
    await writeDebugInput(thread.persistence, {
      threadId: thread.id,
      messages,
      tools
    });
  }
}

/** 记录最近一次 LLM 输出快照；线程带 persistence 时同步落盘。 */
export async function writeLatestLlmOutput(
  thread: ThreadContext,
  result: LlmGenerateResult
): Promise<void> {
  latestLlmObservation = {
    ...latestLlmObservation,
    output: {
      threadId: thread.id,
      result
    }
  };
  if (thread.persistence) {
    await writeDebugOutput(thread.persistence, {
      threadId: thread.id,
      result
    });
  }
}
