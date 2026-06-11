/**
 * Shared transcript-style viewport adapter for builtin windows.
 *
 * program/history-viewport.ts and search/results-viewport.ts
 * were byte-identical apart from three parameters — the LLM-facing field prefix
 * (`history_` vs `matches_`), the window field that stores the viewport
 * (`historyViewport` vs `resultsViewport`), and the error-message label. Both
 * wrapped the same `_shared/transcript-viewport.ts` algorithm.
 *
 * `makeTranscriptViewportAdapter` collapses them into one factory. Each domain
 * file calls it once with its prefix/field/label/default and re-exports the
 * returned helpers under its existing public names (so importers are unchanged).
 */

import type {
  WindowMethodExecutionContext,
  WindowMethodOutcome,
} from "@ooc/core/_shared/types/window-method.js";
import type { WindowDisplayState } from "@ooc/core/_shared/types/window-state.js";
import {
  mergeTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/extendable/_shared/transcript-viewport.js";

/** makeTranscriptViewportAdapter 的配置项。 */
export interface TranscriptViewportAdapterSpec {
  /**
   * LLM-facing 字段前缀（不含下划线后缀），例：`history` / `matches`。
   * 对外字段 = `<prefix>_tail` / `<prefix>_start` / `<prefix>_end`，
   * 内部翻译为通用 `tail` / `range_start` / `range_end`。
   */
  prefix: string;
  /**
   * WindowDisplayState 上存放 viewport 的字段名，例：`historyViewport` / `resultsViewport`。
   * window method 写回 ctx.windowState[windowField]。
   */
  windowField: keyof WindowDisplayState;
  /** 错误信息前缀标签，例：`program_window.set_history_window`。 */
  label: string;
  /** 默认 viewport（无字段时回退），例：`{ tail: 10 }` / `{ tail: 50 }`。 */
  defaultViewport: TranscriptViewport;
}

/** 一个 viewport adapter 暴露的两件套（window method 执行体）。 */
export interface TranscriptViewportAdapter {
  /** 是否带任意 `<prefix>_*` viewport 字段。 */
  hasAnyField(args: Record<string, unknown>): boolean;
  /** set_*_window 的 window method 执行体：校验 → 翻译 → merge → 返回新 state（immutable）。 */
  execute(ctx: WindowMethodExecutionContext): WindowMethodOutcome;
}

/**
 * 构造一个 transcript-style viewport adapter（hasAnyField + execute）。
 *
 * 字段名翻译：`<prefix>_tail|start|end` ↔ 通用 `tail|range_start|range_end`。
 * 错误信息里的通用字段名再翻译回 `<prefix>_*`，避免对 LLM 暴露内部命名。
 */
export function makeTranscriptViewportAdapter(
  spec: TranscriptViewportAdapterSpec,
): TranscriptViewportAdapter {
  const tailKey = `${spec.prefix}_tail`;
  const startKey = `${spec.prefix}_start`;
  const endKey = `${spec.prefix}_end`;

  function hasAnyField(args: Record<string, unknown>): boolean {
    return tailKey in args || startKey in args || endKey in args;
  }

  function translateArgs(args: Record<string, unknown>): Record<string, unknown> {
    const translated: Record<string, unknown> = {};
    if (tailKey in args) translated.tail = args[tailKey];
    if (startKey in args) translated.range_start = args[startKey];
    if (endKey in args) translated.range_end = args[endKey];
    return translated;
  }

  function execute(ctx: WindowMethodExecutionContext): WindowMethodOutcome {
    if (!hasAnyField(ctx.args)) {
      return {
        ok: true,
        state: ctx.windowState,
        result: `[${spec.label}] 至少需要传入 ${tailKey} / ${startKey}+${endKey} 之一。`,
      };
    }
    const current =
      (ctx.windowState[spec.windowField] as TranscriptViewport | undefined) ?? spec.defaultViewport;
    const merged = mergeTranscriptViewport(current, translateArgs(ctx.args));
    if (!merged.ok) {
      // 翻译错误信息里的通用字段名，对 LLM 暴露 <prefix>_* 命名
      const fail = merged as { ok: false; error: string };
      const msg = fail.error
        .replace(/range_start/g, startKey)
        .replace(/range_end/g, endKey)
        .replace(/\btail\b/g, tailKey);
      return { ok: false, error: `[${spec.label}] ${msg}` };
    }
    return { ok: true, state: { ...ctx.windowState, [spec.windowField]: merged.viewport } };
  }

  return { hasAnyField, execute };
}
