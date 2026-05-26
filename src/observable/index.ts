import type { ThreadContext } from "../thinkable/context";
import type { LlmGenerateResult, LlmInputItem, LlmMessage, LlmTool } from "../thinkable/llm/types";
import {
  captureContextSnapshot,
  deriveOutputItems,
  normalizeInputItems,
  writeDebugInput,
  writeDebugOutput,
  writeLoopDebugInput,
  writeLoopDebugMeta,
  writeLoopDebugOutput,
} from "../persistable";
import { buildWindowsSnapshot } from "./window-hash";

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

/**
 * 运行时可注入的 permission 判定器 (Q0b 新增; design:
 * docs/2026-05-25-permission-model-design.md, meta:
 * meta/object.doc.ts:executable.children.permission)。
 *
 * 与 PauseChecker 完全独立 — 旧的全局 pause 路径保持向后兼容,新 per-command
 * 权限检查走 permission decider / policies.json / CommandTableEntry 三层。
 *
 * 类型定义放在 src/executable/permissions.ts; 这里只持有 setter / getter,
 * 避免 observable 反向依赖 executable (executable 依赖 observable, 不能反过来)。
 */
export type RuntimePermissionDecision =
  | { decision: "allow" }
  | { decision: "ask" }
  | { decision: "deny"; reason: string };

export type RuntimePendingToolCall = {
  toolName: "exec" | "close" | "wait" | "compress";
  command?: string;
  args?: unknown;
  windowId?: string;
};

export type RuntimePermissionDecider = (
  thread: ThreadContext,
  call: RuntimePendingToolCall,
) => RuntimePermissionDecision | Promise<RuntimePermissionDecision>;

/**
 * 状态翻转通知：事件源（talk/do/end）写完对端 thread.inbox 后调一次,
 * 告诉 runtime "这个 thread 现在该被调度了"。runtime 把它转成 jobManager.enqueue。
 *
 * 根因 #5（worker 事件驱动改造，2026-05-24）：
 * - worker 不再周期扫 fs 兜底入队；状态翻转由事件源直接 enqueue
 * - 默认 notifier 是 no-op，单元测试 / 跨层调用不依赖 runtime 注入也能跑
 * - app/server/buildServer 启动时调 setThreadActivationNotifier 把 jobManager 接进来
 */
export type ThreadActivationRef = {
  sessionId: string;
  objectId: string;
  threadId: string;
};
export type ThreadActivationNotifier = (ref: ThreadActivationRef) => void;

let latestLlmObservation: LlmObservation | undefined;
let debugEnabled = false;
const loopCounters = new Map<string, number>();
let pauseChecker: PauseChecker = () => false;
let permissionDecider: RuntimePermissionDecider | null = null;
let threadActivationNotifier: ThreadActivationNotifier = () => {};

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

/**
 * 注入 permission decider (Q0b)。传 null 即清除注入,回到默认链
 * (policies.json + CommandTableEntry + allow)。
 *
 * 与 setPauseChecker 完全独立 — pause 是旧的"全局开关"路径,permission 是新的
 * "per-command 三档"路径,两者互不干扰。
 */
export function setPermissionDecider(decider: RuntimePermissionDecider | null): void {
  permissionDecider = decider;
}

/** 读取当前注入的 permission decider; 未注入返回 null。 */
export function getPermissionDecider(): RuntimePermissionDecider | null {
  return permissionDecider;
}

/**
 * 注入 thread 激活通知（jobManager.createRunThreadJob 的薄封装）。
 * 默认 no-op；buildServer 启动时把 jobManager 接入。
 */
export function setThreadActivationNotifier(notifier: ThreadActivationNotifier): void {
  threadActivationNotifier = notifier;
}

/**
 * 通知 runtime：ref 指向的 thread 应被 worker 调度。
 *
 * 调用约束：
 * - 必须在写完目标 thread.inbox + 翻 status 为 running 之后调
 * - 多次调用幂等（jobManager.createRunThreadJob 自带去重 by (sessionId,objectId)）
 * - 单元测试无 runtime 时是 no-op，不抛错
 */
export function notifyThreadActivated(ref: ThreadActivationRef): void {
  try {
    threadActivationNotifier(ref);
  } catch (err) {
    // silent-swallow ban：通知失败时 warn 但不阻塞调用方
    // eslint-disable-next-line no-console
    console.warn(
      `[thread-activation] notifier threw for ${ref.sessionId}/${ref.objectId}/${ref.threadId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
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
  permissionDecider = null;
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
      contextSnapshot: captureContextSnapshot(thread),
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
      contextSnapshot: captureContextSnapshot(thread),
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
    // Round 9 E2: 落 windowsSnapshot 供前端 LoopTimeline 算 diff
    // (docs/2026-05-26-loop-time-machine-with-window-diff-design.md § 3.2)
    const windowsSnapshot = buildWindowsSnapshot(thread.contextWindows ?? []);
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
      error: payload.error,
      windowsSnapshot,
    });
  }
}
