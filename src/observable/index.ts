import type { ThreadContext } from "../thinkable/context";
import type { LlmGenerateResult, LlmMessage, LlmTool } from "../thinkable/llm/types";
import {
  writeDebugInput,
  writeDebugOutput,
  writeLoopDebugInput,
  writeLoopDebugMeta,
  writeLoopDebugOutput,
} from "../persistable";

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

/** 一轮 LLM 观测的运行时句柄，由 thinkloop 在 begin/finish 间传递。 */
export interface LlmLoopHandle {
  /** 触发本轮请求的线程 ID。 */
  threadId: string;
  /** 当前线程的轮次编号。 */
  loopIndex: number;
  /** 本轮开始时间。 */
  startedAt: number;
  /** 本轮输入消息数量。 */
  messageCount: number;
  /** 本轮可用工具数量。 */
  toolCount: number;
  /** 输入 context 的字节数。 */
  contextBytes: number;
}

/** 对外暴露的 debug 状态。 */
export interface ObservableDebugStatus {
  /** 是否开启 loop 级 debug。 */
  enabled: boolean;
}

let latestLlmObservation: LlmObservation | undefined;
let debugEnabled = false;
const loopCounters = new Map<string, number>();

/** 把线程定位为稳定 key；持久化线程按磁盘 ref 区分，内存线程退化到 id。 */
function loopKey(thread: ThreadContext): string {
  if (!thread.persistence) {
    return `ephemeral:${thread.id}`;
  }
  const ref = thread.persistence;
  return `${ref.baseDir}:${ref.sessionId}:${ref.objectId}:${ref.threadId}`;
}

/** 返回文本的 UTF-8 字节数。 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 为某个线程分配下一个 loopIndex。 */
function nextLoopIndex(thread: ThreadContext): number {
  const key = loopKey(thread);
  const next = (loopCounters.get(key) ?? 0) + 1;
  loopCounters.set(key, next);
  return next;
}

/** 开启 loop 级 debug。 */
export function enableDebug(): void {
  debugEnabled = true;
}

/** 关闭 loop 级 debug。 */
export function disableDebug(): void {
  debugEnabled = false;
}

/** 返回当前 debug 状态。 */
export function getDebugStatus(): ObservableDebugStatus {
  return { enabled: debugEnabled };
}

/** pause 能力先默认为 false，占位表达“暂停检查点存在”。 */
export function isPausing(thread: ThreadContext): Promise<boolean> | boolean {
  void thread;
  return false;
}

/** 清空最近一次 LLM 观测，避免测试之间互相污染。 */
export function clearLatestLlmObservation(): void {
  latestLlmObservation = undefined;
}

/** 清空 observable 的调试状态，包括 latest snapshot 与 loop 计数器。 */
export function clearObservableDebugState(): void {
  latestLlmObservation = undefined;
  debugEnabled = false;
  loopCounters.clear();
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

/** 开始一轮 LLM 调用：记录 latest 输入，必要时写入 loop_NNN.input.json。 */
export async function beginLlmLoop(
  thread: ThreadContext,
  messages: LlmMessage[],
  tools: LlmTool[]
): Promise<LlmLoopHandle> {
  const loopIndex = nextLoopIndex(thread);
  const startedAt = Date.now();
  await writeLatestLlmInput(thread, messages, tools);
  if (debugEnabled && thread.persistence) {
    await writeLoopDebugInput(thread.persistence, loopIndex, {
      threadId: thread.id,
      messages,
      tools
    });
  }
  return {
    threadId: thread.id,
    loopIndex,
    startedAt,
    messageCount: messages.length,
    toolCount: tools.length,
    contextBytes: byteLength(messages.map((message) => message.content).join("\n"))
  };
}

/** 结束一轮 LLM 调用：记录 latest 输出，并在 debug 模式下写 loop 级 output/meta。 */
export async function finishLlmLoop(
  thread: ThreadContext,
  handle: LlmLoopHandle,
  payload: {
    result?: LlmGenerateResult;
    status: "ok" | "paused" | "error";
    error?: string;
  }
): Promise<void> {
  const finishedAt = Date.now();
  if (payload.result) {
    await writeLatestLlmOutput(thread, payload.result);
    if (debugEnabled && thread.persistence) {
      await writeLoopDebugOutput(thread.persistence, handle.loopIndex, {
        threadId: thread.id,
        result: payload.result
      });
    }
  }
  if (debugEnabled && thread.persistence) {
    await writeLoopDebugMeta(thread.persistence, handle.loopIndex, {
      threadId: thread.id,
      loopIndex: handle.loopIndex,
      provider: payload.result?.provider,
      model: payload.result?.model,
      startedAt: handle.startedAt,
      finishedAt,
      latencyMs: finishedAt - handle.startedAt,
      messageCount: handle.messageCount,
      toolCount: handle.toolCount,
      toolCallCount: payload.result?.toolCalls.length ?? 0,
      contextBytes: handle.contextBytes,
      resultTextBytes: payload.result ? byteLength(payload.result.text) : 0,
      status: payload.status,
      error: payload.error
    });
  }
}
