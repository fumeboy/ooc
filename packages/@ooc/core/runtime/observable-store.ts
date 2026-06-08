/**
 * ObservableStore — per-world 观测与运行时注入状态。
 *
 * M1 (2026-06-02): 从 observable/index.ts 抽出为可实例化类。
 * 原有 module-level 导出保留为对 `defaultObservableStore` 的 thin wrapper。
 */
import type { ThreadContext } from "../thinkable/context.js";
import type {
  LlmGenerateResult,
  LlmInputItem,
  LlmMessage,
  LlmTool,
} from "../thinkable/llm/types.js";
import {
  captureContextSnapshot,
  deriveOutputItems,
  normalizeInputItems,
  readLoopDebugMeta,
  writeDebugInput,
  writeDebugOutput,
  writeLoopDebugInput,
  writeLoopDebugMeta,
  writeLoopDebugOutput,
} from "../persistable/index.js";
import { buildWindowsSnapshot } from "../observable/window-hash.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";

/** 一轮 LLM 观测的运行时句柄。 */
export interface LlmLoopHandle {
  threadId: string;
  loopIndex: number;
  startedAt: number;
  messageCount: number;
  toolCount: number;
  contextBytes: number;
}

export type LlmObservation = {
  input?: {
    threadId: string;
    inputItems: LlmInputItem[];
    tools: LlmTool[];
  };
  output?: {
    threadId: string;
    outputItems: LlmInputItem[];
    provider?: string;
    model?: string;
  };
};

export interface ObservableDebugStatus {
  enabled: boolean;
}

export type PauseChecker = (thread: ThreadContext) => boolean | Promise<boolean>;

export type RuntimePermissionDecision =
  | { decision: "allow" }
  | { decision: "ask" }
  | { decision: "deny"; reason: string };

export type RuntimePendingToolCall = {
  toolName: "exec" | "close" | "wait" | "compress";
  method?: string;
  args?: unknown;
  windowId?: string;
};

export type RuntimePermissionDecider = (
  thread: ThreadContext,
  call: RuntimePendingToolCall,
) => RuntimePermissionDecision | Promise<RuntimePermissionDecision>;

export type ThreadActivationRef = {
  sessionId: string;
  objectId: string;
  threadId: string;
};
export type ThreadActivationNotifier = (ref: ThreadActivationRef) => void;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export class ObservableStore {
  private latestLlmObservation: LlmObservation | undefined;
  private debugEnabled = false;
  private readonly loopCounters = new Map<string, number>();
  private pauseChecker: PauseChecker = () => false;
  private permissionDecider: RuntimePermissionDecider | null = null;
  private threadActivationNotifier: ThreadActivationNotifier = () => {};

  private loopKey(thread: ThreadContext): string {
    if (!thread.persistence) return `ephemeral:${thread.id}`;
    const ref = thread.persistence;
    return `${ref.baseDir}:${ref.sessionId}:${ref.objectId}:${ref.threadId}`;
  }

  private nextLoopIndex(thread: ThreadContext): number {
    const key = this.loopKey(thread);
    const next = (this.loopCounters.get(key) ?? 0) + 1;
    this.loopCounters.set(key, next);
    return next;
  }

  /** Allocate the next loop index for a thread. Public so module-level composites can use it. */
  allocateLoopIndex(thread: ThreadContext): number {
    return this.nextLoopIndex(thread);
  }

  enableDebug(): void {
    this.debugEnabled = true;
  }
  disableDebug(): void {
    this.debugEnabled = false;
  }
  getDebugStatus(): ObservableDebugStatus {
    return { enabled: this.debugEnabled };
  }

  setPauseChecker(checker: PauseChecker): void {
    this.pauseChecker = checker;
  }
  isPausing(thread: ThreadContext): Promise<boolean> | boolean {
    return this.pauseChecker(thread);
  }

  setPermissionDecider(decider: RuntimePermissionDecider | null): void {
    this.permissionDecider = decider;
  }
  getPermissionDecider(): RuntimePermissionDecider | null {
    return this.permissionDecider;
  }

  setThreadActivationNotifier(notifier: ThreadActivationNotifier): void {
    this.threadActivationNotifier = notifier;
  }
  notifyThreadActivated(ref: ThreadActivationRef): void {
    try {
      this.threadActivationNotifier(ref);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[thread-activation] notifier threw for ${ref.sessionId}/${ref.objectId}/${ref.threadId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  clearLatestLlmObservation(): void {
    this.latestLlmObservation = undefined;
  }

  clearDebugState(): void {
    this.latestLlmObservation = undefined;
    this.debugEnabled = false;
    this.loopCounters.clear();
    this.pauseChecker = () => false;
    this.permissionDecider = null;
  }

  getLatestLlmObservation(): LlmObservation | undefined {
    return this.latestLlmObservation;
  }

  /** Primitive setter for the input half of latestLlmObservation. */
  setLatestInputObservation(threadId: string, inputItems: LlmInputItem[], tools: LlmTool[]): void {
    this.latestLlmObservation = {
      ...this.latestLlmObservation,
      input: { threadId, inputItems, tools },
    };
  }

  /** Primitive setter for the output half of latestLlmObservation. */
  setLatestOutputObservation(
    threadId: string,
    outputItems: LlmInputItem[],
    provider?: string,
    model?: string,
  ): void {
    this.latestLlmObservation = {
      ...this.latestLlmObservation,
      output: { threadId, outputItems, provider, model },
    };
  }

  async writeLatestLlmInput(
    thread: ThreadContext,
    items: LlmInputItem[] | LlmMessage[],
    tools: LlmTool[],
  ): Promise<void> {
    const inputItems = normalizeInputItems(items);
    this.latestLlmObservation = {
      ...this.latestLlmObservation,
      input: { threadId: thread.id, inputItems, tools },
    };
    if (thread.persistence) {
      await writeDebugInput(thread.persistence, {
        threadId: thread.id,
        inputItems,
        contextSnapshot: captureContextSnapshot(thread),
      });
    }
  }

  async writeLatestLlmOutput(
    thread: ThreadContext,
    result: LlmGenerateResult,
  ): Promise<void> {
    const outputItems = deriveOutputItems(result);
    this.latestLlmObservation = {
      ...this.latestLlmObservation,
      output: {
        threadId: thread.id,
        outputItems,
        provider: result.provider,
        model: result.model,
      },
    };
    if (thread.persistence) {
      await writeDebugOutput(thread.persistence, {
        threadId: thread.id,
        outputItems,
        provider: result.provider,
        model: result.model,
      });
    }
  }

  async beginLlmLoop(
    thread: ThreadContext,
    items: LlmInputItem[] | LlmMessage[],
    tools: LlmTool[],
  ): Promise<LlmLoopHandle> {
    const loopIndex = this.nextLoopIndex(thread);
    const startedAt = Date.now();
    const inputItems = normalizeInputItems(items);
    await this.writeLatestLlmInput(thread, inputItems, tools);
    if (this.debugEnabled && thread.persistence) {
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
          .map((item) =>
            "content" in item ? item.content : "text" in item ? item.text : JSON.stringify(item),
          )
          .join("\n"),
      ),
    };
  }

  async finishLlmLoop(
    thread: ThreadContext,
    handle: LlmLoopHandle,
    payload: {
      result?: LlmGenerateResult;
      status: "ok" | "paused" | "error";
      error?: string;
    },
  ): Promise<void> {
    const finishedAt = Date.now();
    if (payload.result) {
      await this.writeLatestLlmOutput(thread, payload.result);
      if (this.debugEnabled && thread.persistence) {
        const outputItems = deriveOutputItems(payload.result);
        await writeLoopDebugOutput(thread.persistence, handle.loopIndex, {
          threadId: thread.id,
          outputItems,
          provider: payload.result.provider,
          model: payload.result.model,
        });
      }
    }
    if (this.debugEnabled && thread.persistence) {
      let previousSnapshot;
      if (handle.loopIndex > 1) {
        const prevMeta = await readLoopDebugMeta(thread.persistence, handle.loopIndex - 1);
        previousSnapshot = prevMeta?.windowsSnapshot;
      }
      // Prefer the pipeline's rendered window set (base + derived: activator/protocol
      // knowledge, peer Objects) so the snapshot mirrors what the LLM saw. Falls back
      // to persisted contextWindows when no render happened this loop.
      const snapshotWindows = (thread._renderedWindows ?? thread.contextWindows ?? []) as ContextWindow[];
      const windowsSnapshot = await buildWindowsSnapshot(
        // batch C narrowing(N4): contextWindows 契约层是 base[]；narrow 回 union[] 传入 buildWindowsSnapshot。
        snapshotWindows,
        previousSnapshot,
      );
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
}

export const defaultObservableStore = new ObservableStore();

export function createObservableStore(): ObservableStore {
  return new ObservableStore();
}
