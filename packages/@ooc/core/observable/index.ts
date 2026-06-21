/**
 * observable 维度入口：对 defaultObservableStore 的薄 module-level facade。
 *
 * 简单 state accessor 薄委托；复合 loop 函数（beginLlmLoop / finishLlmLoop /
 * writeLatestLlm*）刻意在此模块级实现而非挂 class，以便 bun:test 的
 * spyOn(module, "fn") 拦截（见 thinkable/__tests__/thinkloop.test.ts）——
 * spyOn 只能拦截真正经过模块导出的调用，故复合实现必须调模块级导出函数。
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
} from "./debug-file.js";
import { buildWindowsSnapshot } from "./window-hash.js";
import { getSessionObjectTable } from "../runtime/session-object-table.js";
import { defaultObservableStore } from "../runtime/observable-store.js";
import type {
  LlmLoopHandle,
  LlmObservation,
  ObservableDebugStatus,
  PauseChecker,
  RuntimePermissionDecision,
  RuntimePendingToolCall,
  RuntimePermissionDecider,
  ThreadActivationRef,
  ThreadActivationNotifier,
} from "../runtime/observable-store.js";

export type { ThreadActivationRef } from "../runtime/observable-store.js";

// ——— Simple state accessors: thin delegation (tests rarely spy on these) ———

export function enableDebug(): void { defaultObservableStore.enableDebug(); }
export function disableDebug(): void { defaultObservableStore.disableDebug(); }
export function getDebugStatus(): ObservableDebugStatus { return defaultObservableStore.getDebugStatus(); }
export function setPauseChecker(checker: PauseChecker): void { defaultObservableStore.setPauseChecker(checker); }
export function isPausing(thread: ThreadContext): ReturnType<PauseChecker> { return defaultObservableStore.isPausing(thread); }
export function setPermissionDecider(decider: RuntimePermissionDecider | null): void { defaultObservableStore.setPermissionDecider(decider); }
export function getPermissionDecider(): RuntimePermissionDecider | null { return defaultObservableStore.getPermissionDecider(); }
export function setThreadActivationNotifier(notifier: ThreadActivationNotifier): void { defaultObservableStore.setThreadActivationNotifier(notifier); }
export function notifyThreadActivated(ref: ThreadActivationRef): void { defaultObservableStore.notifyThreadActivated(ref); }
export function clearLatestLlmObservation(): void { defaultObservableStore.clearLatestLlmObservation(); }
export function clearObservableDebugState(): void { defaultObservableStore.clearDebugState(); }
export function getLatestLlmObservation(): LlmObservation | undefined { return defaultObservableStore.getLatestLlmObservation(); }

// ——— State-mutating functions that tests DO spy on — kept as module-level implementations ———
// Tests spy on `spyOn(observableModule, "writeLatestLlmInput")` etc.
// Implementations are deliberately at this module level so interception works.

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Record the latest LLM input snapshot (tests spy on this export). */
export async function writeLatestLlmInput(
  thread: ThreadContext,
  items: LlmInputItem[] | LlmMessage[],
  tools: LlmTool[],
): Promise<void> {
  const inputItems = normalizeInputItems(items);
  defaultObservableStore.setLatestInputObservation(thread.id, inputItems, tools);
  if (thread.persistence) {
    await writeDebugInput(thread.persistence, {
      threadId: thread.id,
      inputItems,
      contextSnapshot: captureContextSnapshot(thread),
    });
  }
}

/** Record the latest LLM output snapshot (tests spy on this export). */
export async function writeLatestLlmOutput(
  thread: ThreadContext,
  result: LlmGenerateResult,
): Promise<void> {
  const outputItems = deriveOutputItems(result);
  defaultObservableStore.setLatestOutputObservation(thread.id, outputItems, result.provider, result.model);
  if (thread.persistence) {
    await writeDebugOutput(thread.persistence, {
      threadId: thread.id,
      outputItems,
      provider: result.provider,
      model: result.model,
    });
  }
}

/**
 * Begin an LLM loop.
 *
 * Implemented HERE (not delegated to the class) so that spies on
 * `writeLatestLlmInput` (the module export) fire correctly.
 */
export async function beginLlmLoop(
  thread: ThreadContext,
  items: LlmInputItem[] | LlmMessage[],
  tools: LlmTool[],
): Promise<LlmLoopHandle> {
  const loopIndex = defaultObservableStore.allocateLoopIndex(thread);
  const startedAt = Date.now();
  const inputItems = normalizeInputItems(items);
  // Calls the MODULE-LEVEL writeLatestLlmInput (spyable), NOT the class method.
  await writeLatestLlmInput(thread, inputItems, tools);
  if (getDebugStatus().enabled && thread.persistence) {
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

/**
 * Finish an LLM loop.
 *
 * Same rationale as beginLlmLoop: implemented at module level so that spies on
 * `writeLatestLlmOutput` fire correctly.
 */
export async function finishLlmLoop(
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
    await writeLatestLlmOutput(thread, payload.result);
    if (getDebugStatus().enabled && thread.persistence) {
      const outputItems = deriveOutputItems(payload.result);
      await writeLoopDebugOutput(thread.persistence, handle.loopIndex, {
        threadId: thread.id,
        outputItems,
        provider: payload.result.provider,
        model: payload.result.model,
      });
    }
  }
  if (getDebugStatus().enabled && thread.persistence) {
    let previousSnapshot;
    if (handle.loopIndex > 1) {
      const prevMeta = await readLoopDebugMeta(thread.persistence, handle.loopIndex - 1);
      previousSnapshot = prevMeta?.windowsSnapshot;
    }
    // Prefer the pipeline's rendered window set (base + derived: activator/protocol
    // knowledge, peer Objects) so the snapshot mirrors what the LLM saw. Falls back
    // to persisted contextWindows when no render happened this loop (e.g. mocked path).
    const snapshotWindows = thread._renderedWindows ?? thread.contextWindows ?? [];
    const windowsSnapshot = await buildWindowsSnapshot(
      snapshotWindows,
      getSessionObjectTable(thread),
      previousSnapshot,
    );
    const resultTextBytes = payload.result ? byteLength(payload.result.text) : 0;
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
      resultTextBytes,
      status: payload.status,
      error: payload.error,
      windowsSnapshot,
    });
  }
}
