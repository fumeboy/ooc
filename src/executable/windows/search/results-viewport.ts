/**
 * search_window 的 results viewport 协议（R1b）。
 *
 * 设计：
 * - 复用 _shared/transcript-viewport.ts 的泛型算法 applyTranscriptViewport<M>
 *   与 mergeTranscriptViewport（fail-loud + 互斥校验）。
 * - 字段命名采用 search-specific 前缀 matches_*（与 transcript_ 的 tail / range_* 同结构）：
 *     - matches_tail            → tail
 *     - matches_start           → range_start
 *     - matches_end             → range_end
 * - 默认 { tail: 50 } —— 显示末 50 条 match；前面 earlier_omitted=M。
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

import type { MethodExecutionContext } from "../_shared/method-types.js";
import {
  mergeTranscriptViewport,
  type TranscriptViewport,
} from "../_shared/transcript-viewport.js";
import type { SearchWindow } from "./types.js";

/** search_window 的默认 results viewport：末 50 条 match。 */
export const DEFAULT_RESULTS_VIEWPORT: TranscriptViewport = Object.freeze({
  tail: 50,
});

/**
 * 把 set_results_window 的 args (matches_tail / matches_start / matches_end)
 * 翻译为 transcript-viewport 的通用 args (tail / range_start / range_end)。
 *
 * 不在 args 里的字段不复制；保留 unknown 字段（让 mergeTranscriptViewport 内部不识别即可）。
 */
function translateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const translated: Record<string, unknown> = {};
  if ("matches_tail" in args) translated.tail = args.matches_tail;
  if ("matches_start" in args) translated.range_start = args.matches_start;
  if ("matches_end" in args) translated.range_end = args.matches_end;
  return translated;
}

/** 是否带任意 set_results_window 字段。 */
export function hasAnyResultsViewportField(
  args: Record<string, unknown>,
): boolean {
  return (
    "matches_tail" in args ||
    "matches_start" in args ||
    "matches_end" in args
  );
}

/**
 * set_results_window 的执行入口。
 *
 * - 校验 ctx.parentWindow 必须是 search_window
 * - 校验至少有一个 matches_tail / matches_start / matches_end 字段
 * - 字段名翻译 → 调用 mergeTranscriptViewport（共享 fail-loud + 互斥逻辑）
 * - 写回 window.resultsViewport
 *
 * 错误信息中错误字段名替换回 matches_* 前缀，避免 LLM 困惑（merge 报的是 tail / range_*）。
 */
export async function executeSearchSetResultsViewport(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const window = ctx.parentWindow;
  if (!window || window.type !== "search") {
    return "[search_window.set_results_window] 未挂载在 search_window 上。";
  }
  if (!hasAnyResultsViewportField(ctx.args)) {
    return "[search_window.set_results_window] 至少需要传入 matches_tail / matches_start+matches_end 之一。";
  }
  const sw = window as SearchWindow;
  const current = sw.resultsViewport ?? DEFAULT_RESULTS_VIEWPORT;
  const translated = translateArgs(ctx.args);
  const merged = mergeTranscriptViewport(current, translated);
  if (!merged.ok) {
    // 翻译错误信息中的字段名，对 LLM 暴露 matches_* 前缀
    const msg = merged.error
      .replace(/range_start/g, "matches_start")
      .replace(/range_end/g, "matches_end")
      .replace(/\btail\b/g, "matches_tail");
    return `[search_window.set_results_window] ${msg}`;
  }
  Object.assign(window, { resultsViewport: merged.viewport });
  return undefined;
}
