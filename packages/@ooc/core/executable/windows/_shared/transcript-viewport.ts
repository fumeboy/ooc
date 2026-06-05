/**
 * transcript viewport 协议 — talk_window / do_window 共享的"持续对话窗口节流"控制。
 *
 * 纯类型 + 纯函数（`TranscriptViewport` / `mergeTranscriptViewport` /
 * `applyTranscriptViewport` / …）已于 batch C2 迁入 canonical 源
 * `@ooc/core/_shared/types/viewport.ts`，此处 re-export 保持旧 import 路径可用。
 * 本文件仅保留 runtime 执行入口 `executeWindowSetTranscriptViewport`
 * （依赖 MethodExecutionContext + 写 ctx.self 副作用）。
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

import type { MethodExecutionContext } from "./command-types.js";
import type { ContextWindow } from "./types.js";
import {
  type TranscriptViewport,
  DEFAULT_TRANSCRIPT_VIEWPORT,
  hasAnyTranscriptViewportField,
  mergeTranscriptViewport,
} from "../../../_shared/types/viewport.js";

export * from "../../../_shared/types/viewport.js";

/**
 * talk_window / do_window 共享的 set_transcript_window 执行入口。
 *
 * - 校验 ctx.self 是 expectedTypes 中某一种
 * - 校验至少有一个 tail / range_start / range_end 字段（否则 no-op + 提示）
 * - 合并 + fail-loud 校验
 * - Object.assign 写回 window.transcriptViewport（按现有 set_viewport 的同模式）
 */
export async function executeWindowSetTranscriptViewport(
  ctx: MethodExecutionContext,
  expectedTypes: Array<"talk" | "do">,
): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type 是 caller 注册的 type 之一，
  // method 体不再 re-check self 类型。expectedTypes 仅用于错误文案 label。
  const window = ctx.self as ContextWindow;
  if (!hasAnyTranscriptViewportField(ctx.args)) {
    return `[${window.type}_window.set_transcript_window] 至少需要传入 tail / range_start+range_end 之一。`;
  }
  const current =
    (window as { transcriptViewport?: TranscriptViewport }).transcriptViewport ??
    DEFAULT_TRANSCRIPT_VIEWPORT;
  const merged = mergeTranscriptViewport(current, ctx.args);
  if (!merged.ok) {
    return `[${window.type}_window.set_transcript_window] ${merged.error}`;
  }
  Object.assign(window, { transcriptViewport: merged.viewport });
  return undefined;
}
