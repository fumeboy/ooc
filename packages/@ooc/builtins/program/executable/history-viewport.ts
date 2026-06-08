/**
 * program_window 的 exec history viewport 协议（R1c）。
 *
 * 设计：
 * - 复用 _shared/executable/viewport-adapter.ts 的 makeTranscriptViewportAdapter
 *   工厂（内部走 _shared/transcript-viewport.ts 的 fail-loud + 互斥算法）。
 * - 字段命名采用 program-specific 前缀 history_*（与 transcript_ 的 tail / range_* 同结构）：
 *     - history_tail            → tail
 *     - history_start           → range_start
 *     - history_end             → range_end
 * - 默认 { tail: 10 } —— 显示末 10 次 exec；前面 earlier_omitted=M。
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

import type {
  WindowMethodExecutionContext,
  WindowMethodOutcome,
} from "@ooc/core/_shared/types/window-method.js";
import type { TranscriptViewport } from "@ooc/core/extendable/_shared/transcript-viewport.js";
import { makeTranscriptViewportAdapter } from "@ooc/builtins/_shared/executable/viewport-adapter.js";

/** program_window 的 history viewport 类型 alias（复用 TranscriptViewport 结构）。 */
export type HistoryViewport = TranscriptViewport;

/** program_window 的默认 history viewport：末 10 次 exec。 */
export const DEFAULT_HISTORY_VIEWPORT: HistoryViewport = Object.freeze({
  tail: 10,
});

const adapter = makeTranscriptViewportAdapter({
  prefix: "history",
  windowField: "historyViewport",
  label: "program_window.set_history_window",
  defaultViewport: DEFAULT_HISTORY_VIEWPORT,
});

/** 是否带任意 set_history_window 字段。 */
export function hasAnyHistoryViewportField(
  args: Record<string, unknown>,
): boolean {
  return adapter.hasAnyField(args);
}

/** set_history_window 的 window method 执行体（委托共享 adapter，返回新 state）。 */
export function programSetHistoryViewport(
  ctx: WindowMethodExecutionContext,
): WindowMethodOutcome {
  return adapter.execute(ctx);
}
