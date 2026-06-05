/**
 * search_window 的 results viewport 协议（R1b）。
 *
 * 设计：
 * - 复用 _shared/executable/viewport-adapter.ts 的 makeTranscriptViewportAdapter
 *   工厂（内部走 _shared/transcript-viewport.ts 的 fail-loud + 互斥算法）。
 * - 字段命名采用 search-specific 前缀 matches_*（与 transcript_ 的 tail / range_* 同结构）：
 *     - matches_tail            → tail
 *     - matches_start           → range_start
 *     - matches_end             → range_end
 * - 默认 { tail: 50 } —— 显示末 50 条 match；前面 earlier_omitted=M。
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types.js";
import type { TranscriptViewport } from "@ooc/core/extendable/_shared/transcript-viewport.js";
import { makeTranscriptViewportAdapter } from "@ooc/builtins/_shared/executable/viewport-adapter.js";

/** search_window 的默认 results viewport：末 50 条 match。 */
export const DEFAULT_RESULTS_VIEWPORT: TranscriptViewport = Object.freeze({
  tail: 50,
});

const adapter = makeTranscriptViewportAdapter({
  prefix: "matches",
  windowField: "resultsViewport",
  label: "search_window.set_results_window",
  defaultViewport: DEFAULT_RESULTS_VIEWPORT,
});

/** 是否带任意 set_results_window 字段。 */
export function hasAnyResultsViewportField(
  args: Record<string, unknown>,
): boolean {
  return adapter.hasAnyField(args);
}

/** set_results_window 的执行入口（委托共享 adapter）。 */
export function executeSearchSetResultsViewport(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  return adapter.execute(ctx);
}
