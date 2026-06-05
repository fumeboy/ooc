/**
 * Shared transcript-style viewport adapter for builtin windows.
 *
 * Batch B4 (2026-06-04): program/history-viewport.ts and search/results-viewport.ts
 * were byte-identical apart from three parameters — the LLM-facing field prefix
 * (`history_` vs `matches_`), the window field that stores the viewport
 * (`historyViewport` vs `resultsViewport`), and the error-message label. Both
 * wrapped the same `_shared/transcript-viewport.ts` algorithm.
 *
 * `makeTranscriptViewportAdapter` collapses them into one factory. Each domain
 * file calls it once with its prefix/field/label/default and re-exports the
 * returned helpers under its existing public names (so importers are unchanged).
 */

import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types.js";
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
  /** ctx.self 上存放 viewport 的字段名，例：`historyViewport` / `resultsViewport`。 */
  windowField: string;
  /** 错误信息前缀标签，例：`program_window.set_history_window`。 */
  label: string;
  /** 默认 viewport（无字段时回退），例：`{ tail: 10 }` / `{ tail: 50 }`。 */
  defaultViewport: TranscriptViewport;
}

/** 一个 viewport adapter 暴露的三件套。 */
export interface TranscriptViewportAdapter {
  /** 是否带任意 `<prefix>_*` viewport 字段。 */
  hasAnyField(args: Record<string, unknown>): boolean;
  /** set_*_window 的执行入口：校验 → 翻译 → merge → 写回 window 字段。 */
  execute(ctx: MethodExecutionContext): Promise<string | undefined>;
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

  async function execute(ctx: MethodExecutionContext): Promise<string | undefined> {
    // P6.§3: manager 在 dispatch 阶段已保证 self.type 正确，method 体不再 re-check。
    const window = ctx.self as unknown as Record<string, unknown>;
    if (!hasAnyField(ctx.args)) {
      return `[${spec.label}] 至少需要传入 ${tailKey} / ${startKey}+${endKey} 之一。`;
    }
    const current = (window[spec.windowField] as TranscriptViewport) ?? spec.defaultViewport;
    const merged = mergeTranscriptViewport(current, translateArgs(ctx.args));
    if (!merged.ok) {
      // 翻译错误信息里的通用字段名，对 LLM 暴露 <prefix>_* 命名
      const fail = merged as { ok: false; error: string };
      const msg = fail.error
        .replace(/range_start/g, startKey)
        .replace(/range_end/g, endKey)
        .replace(/\btail\b/g, tailKey);
      return `[${spec.label}] ${msg}`;
    }
    Object.assign(window, { [spec.windowField]: merged.viewport });
    return undefined;
  }

  return { hasAnyField, execute };
}
