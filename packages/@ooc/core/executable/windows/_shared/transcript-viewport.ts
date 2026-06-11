/**
 * transcript viewport 协议 — talk_window / do_window 共享的"持续对话窗口节流"控制。
 *
 * 纯类型 + 纯函数（`TranscriptViewport` / `mergeTranscriptViewport` /
 * `applyTranscriptViewport` / …）已迁入 canonical 源
 * `@ooc/core/_shared/types/viewport.ts`，此处 re-export 保持旧 import 路径可用。
 * 本文件仅保留 runtime 执行入口 `executeWindowSetTranscriptViewport`
 * （依赖 MethodExecutionContext + 写 ctx.self 副作用）。
 */

import type { WindowMethodExecutionContext, WindowMethodOutcome } from "../../../_shared/types/window-method.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  hasAnyTranscriptViewportField,
  mergeTranscriptViewport,
} from "../../../_shared/types/viewport.js";

export * from "../../../_shared/types/viewport.js";

/**
 * talk_window / do_window 共享的 set_transcript_window 执行体（window method）。
 *
 * 读 ctx.windowState.transcriptViewport，校验+合并，返回新 WindowDisplayState（immutable）。
 * 不再 mutate ctx.self —— manager 命中 windowMethod 时把返回的 state 写回 window.state。
 *
 * @param expectedTypes 仅用于错误文案 label（talk / do）。
 */
export function windowSetTranscriptViewport(
  ctx: WindowMethodExecutionContext,
  expectedTypes: Array<"talk" | "do">,
): WindowMethodOutcome {
  const label = expectedTypes[0] ?? "transcript";
  if (!hasAnyTranscriptViewportField(ctx.args)) {
    return {
      ok: true,
      state: ctx.windowState,
      result: `[${label}_window.set_transcript_window] 至少需要传入 tail / range_start+range_end 之一。`,
    };
  }
  const current = ctx.windowState.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT;
  const merged = mergeTranscriptViewport(current, ctx.args);
  if (!merged.ok) {
    return { ok: false, error: `[${label}_window.set_transcript_window] ${merged.error}` };
  }
  return { ok: true, state: { ...ctx.windowState, transcriptViewport: merged.viewport } };
}
