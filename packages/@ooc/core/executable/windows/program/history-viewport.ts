/**
 * program_window 的 exec history viewport 协议（R1c）。
 *
 * 设计：
 * - 复用 _shared/transcript-viewport.ts 的泛型算法 applyTranscriptViewport<M>
 *   与 mergeTranscriptViewport（fail-loud + 互斥校验）。
 * - 字段命名采用 program-specific 前缀 history_*（与 transcript_ 的 tail / range_* 同结构）：
 *     - history_tail            → tail
 *     - history_start           → range_start
 *     - history_end             → range_end
 * - 默认 { tail: 10 } —— 显示末 10 次 exec；前面 earlier_omitted=M。
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

import type { CommandExecutionContext } from "../_shared/command-types.js";
import {
  mergeTranscriptViewport,
  type TranscriptViewport,
} from "../_shared/transcript-viewport.js";
import type { ProgramWindow } from "./types.js";

/** program_window 的 history viewport 类型 alias（复用 TranscriptViewport 结构）。 */
export type HistoryViewport = TranscriptViewport;

/** program_window 的默认 history viewport：末 10 次 exec。 */
export const DEFAULT_HISTORY_VIEWPORT: HistoryViewport = Object.freeze({
  tail: 10,
});

/**
 * 把 set_history_window 的 args (history_tail / history_start / history_end)
 * 翻译为 transcript-viewport 的通用 args (tail / range_start / range_end)。
 *
 * 不在 args 里的字段不复制；保留 unknown 字段（让 mergeTranscriptViewport 内部不识别即可）。
 */
function translateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const translated: Record<string, unknown> = {};
  if ("history_tail" in args) translated.tail = args.history_tail;
  if ("history_start" in args) translated.range_start = args.history_start;
  if ("history_end" in args) translated.range_end = args.history_end;
  return translated;
}

/** 是否带任意 set_history_window 字段。 */
export function hasAnyHistoryViewportField(
  args: Record<string, unknown>,
): boolean {
  return (
    "history_tail" in args ||
    "history_start" in args ||
    "history_end" in args
  );
}

/**
 * set_history_window 的执行入口。
 *
 * - 校验 ctx.parentWindow 必须是 program_window
 * - 校验至少有一个 history_tail / history_start / history_end 字段
 * - 字段名翻译 → 调用 mergeTranscriptViewport（共享 fail-loud + 互斥逻辑）
 * - 写回 window.historyViewport
 *
 * 错误信息中错误字段名替换回 history_* 前缀，避免 LLM 困惑（merge 报的是 tail / range_*）。
 */
export async function executeProgramSetHistoryViewport(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const window = ctx.parentWindow;
  if (!window || window.type !== "program") {
    return "[program_window.set_history_window] 未挂载在 program_window 上。";
  }
  if (!hasAnyHistoryViewportField(ctx.args)) {
    return "[program_window.set_history_window] 至少需要传入 history_tail / history_start+history_end 之一。";
  }
  const pw = window as ProgramWindow;
  const current = pw.historyViewport ?? DEFAULT_HISTORY_VIEWPORT;
  const translated = translateArgs(ctx.args);
  const merged = mergeTranscriptViewport(current, translated);
  if (!merged.ok) {
    // 翻译错误信息中的字段名，对 LLM 暴露 history_* 前缀
    const msg = merged.error
      .replace(/range_start/g, "history_start")
      .replace(/range_end/g, "history_end")
      .replace(/\btail\b/g, "history_tail");
    return `[program_window.set_history_window] ${msg}`;
  }
  Object.assign(window, { historyViewport: merged.viewport });
  return undefined;
}
