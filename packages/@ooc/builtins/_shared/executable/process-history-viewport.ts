/**
 * 进程 window 的 exec history viewport 协议 —— terminal_process / interpreter_process 共用。
 *
 * 复用 _shared/executable/viewport-adapter.ts 的 makeTranscriptViewportAdapter 工厂
 * （内部走 core 的 fail-loud + 互斥算法）。字段命名采用 history_* 前缀：
 *     - history_tail   → tail
 *     - history_start  → range_start
 *     - history_end    → range_end
 * 默认 { tail: 10 } —— 显示末 10 次 exec；前面 earlier_omitted=M。
 */

import type {
  WindowMethodExecutionContext,
  WindowMethodOutcome,
} from "@ooc/core/_shared/types/window-method.js";
import type { TranscriptViewport } from "@ooc/core/extendable/_shared/transcript-viewport.js";
import { makeTranscriptViewportAdapter } from "./viewport-adapter.js";

/** 进程 window 的 history viewport 类型 alias（复用 TranscriptViewport 结构）。 */
export type HistoryViewport = TranscriptViewport;

/** 进程 window 的默认 history viewport：末 10 次 exec。 */
export const DEFAULT_HISTORY_VIEWPORT: HistoryViewport = Object.freeze({
  tail: 10,
});

/** 为某个进程 window 类构造 set_history_window 的视口工具（adapter + helpers）。 */
export function makeHistoryViewport(label: string): {
  hasAnyField: (args: Record<string, unknown>) => boolean;
  setViewport: (ctx: WindowMethodExecutionContext) => WindowMethodOutcome;
} {
  const adapter = makeTranscriptViewportAdapter({
    prefix: "history",
    windowField: "historyViewport",
    label,
    defaultViewport: DEFAULT_HISTORY_VIEWPORT,
  });
  return {
    hasAnyField: (args) => adapter.hasAnyField(args),
    setViewport: (ctx) => adapter.execute(ctx),
  };
}
