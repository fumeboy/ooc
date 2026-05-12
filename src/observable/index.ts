import type { ThreadContext } from "../thinkable/context";
import type { LlmGenerateResult, LlmInputItem, LlmMessage, LlmTool } from "../thinkable/llm/types";
import {
  deriveOutputItems,
  normalizeInputItems,
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
    /** 传给 LLM 的完整 input items。 */
    inputItems: LlmInputItem[];
    /** 本轮暴露的 tool 定义。 */
    tools: LlmTool[];
  };
  /** provider 返回后记录的输出。 */
  output?: {
    /** 触发本次请求的线程 ID。 */
    threadId: string;
    /** 归一化后的输出 items。 */
    outputItems: LlmInputItem[];
    /** 便于排查的 provider 元信息。 */
    provider?: string;
    model?: string;
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

/** 运行时可注入的 pause 判定器。 */
export type PauseChecker = (thread: ThreadContext) => boolean | Promise<boolean>;

let latestLlmObservation: LlmObservation | undefined;
let debugEnabled = false;
const loopCounters = new Map<string, number>();
let pauseChecker: PauseChecker = () => false;

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

/** 注入 pause 判定逻辑，供 app/server runtime 控制暂停。 */
export function setPauseChecker(checker: PauseChecker): void {
  pauseChecker = checker;
}

/** pause 能力由 runtime 注入；默认关闭。 */
export function isPausing(thread: ThreadContext): Promise<boolean> | boolean {
  return pauseChecker(thread);
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
  pauseChecker = () => false;
}

/** 读取最近一次 LLM 输入/输出观测快照。 */
export function getLatestLlmObservation(): LlmObservation | undefined {
  return latestLlmObservation;
}

/** 记录最近一次 LLM 输入快照；线程带 persistence 时同步落盘。 */
export async function writeLatestLlmInput(
  thread: ThreadContext,
  items: LlmInputItem[] | LlmMessage[],
  tools: LlmTool[]
): Promise<void> {
  const inputItems = normalizeInputItems(items);
  latestLlmObservation = {
    ...latestLlmObservation,
    input: {
      threadId: thread.id,
      inputItems,
      tools
    }
  };
  if (thread.persistence) {
    await writeDebugInput(thread.persistence, {
      threadId: thread.id,
      inputItems,
      tools
    });
  }
}

/** 记录最近一次 LLM 输出快照；线程带 persistence 时同步落盘。 */
export async function writeLatestLlmOutput(
  thread: ThreadContext,
  result: LlmGenerateResult
): Promise<void> {
  const outputItems = deriveOutputItems(result);
  latestLlmObservation = {
    ...latestLlmObservation,
    output: {
      threadId: thread.id,
      outputItems,
      provider: result.provider,
      model: result.model
    }
  };
  if (thread.persistence) {
    await writeDebugOutput(thread.persistence, {
      threadId: thread.id,
      outputItems,
      provider: result.provider,
      model: result.model
    });
  }
}

/** 开始一轮 LLM 调用：记录 latest 输入，必要时写入 loop_NNN.input.json。 */
export async function beginLlmLoop(
  thread: ThreadContext,
  items: LlmInputItem[] | LlmMessage[],
  tools: LlmTool[]
): Promise<LlmLoopHandle> {
  const loopIndex = nextLoopIndex(thread);
  const startedAt = Date.now();
  const inputItems = normalizeInputItems(items);
  await writeLatestLlmInput(thread, inputItems, tools);
  if (debugEnabled && thread.persistence) {
    await writeLoopDebugInput(thread.persistence, loopIndex, {
      threadId: thread.id,
      inputItems,
      tools
    });
  }
  return {
    threadId: thread.id,
    loopIndex,
    startedAt,
    messageCount: inputItems.length,
    toolCount: tools.length,
    contextBytes: byteLength(
      inputItems
        .map((item) => ("content" in item ? item.content : "text" in item ? item.text : JSON.stringify(item)))
        .join("\n")
    )
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
      const outputItems = deriveOutputItems(payload.result);
      await writeLoopDebugOutput(thread.persistence, handle.loopIndex, {
        threadId: thread.id,
        outputItems,
        provider: payload.result.provider,
        model: payload.result.model
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
