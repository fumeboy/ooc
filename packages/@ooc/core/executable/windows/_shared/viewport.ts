/**
 * viewport 协议 — file_window / knowledge_window 共享的"精细化窗口大小"控制。
 *
 * 纯类型 + 纯函数（`Viewport` / `mergeViewport` / `applyViewport` / …）已于
 * batch C2 迁入 canonical 源 `@ooc/core/_shared/types/viewport.ts`，此处 re-export
 * 保持旧 import 路径可用。本文件仅保留 runtime 执行入口
 * `executeWindowSetViewport`（依赖 MethodExecutionContext + 写 ctx.self 副作用）。
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

import type { WindowMethodExecutionContext, WindowMethodOutcome } from "../../../_shared/types/window-method.js";
import {
  DEFAULT_VIEWPORT,
  hasAnyViewportField,
  mergeViewport,
} from "../../../_shared/types/viewport.js";

export * from "../../../_shared/types/viewport.js";

/**
 * file / knowledge window 共享的 set_viewport 执行体（window method）。
 *
 * 读 ctx.windowState.viewport，校验+合并，返回新 WindowDisplayState（immutable）。
 * 不再 mutate ctx.self —— manager 命中 windowMethod 时把返回的 state 写回 window.state。
 *
 * - 无 viewport 字段：no-op，返回原 state + 提示文案（result）
 * - 合并 fail-loud：返回 { ok:false, error }
 *
 * @param expectedType 仅用于错误文案 label（如 file / knowledge / example）；不是类型判别式。
 */
export function windowSetViewport(
  ctx: WindowMethodExecutionContext,
  expectedType: string,
): WindowMethodOutcome {
  if (!hasAnyViewportField(ctx.args)) {
    return {
      ok: true,
      state: ctx.windowState,
      result: `[${expectedType}_window.set_viewport] 至少需要传入 line_start / line_end / column_start / column_end 之一。`,
    };
  }
  const current = ctx.windowState.viewport ?? DEFAULT_VIEWPORT;
  const merged = mergeViewport(current, ctx.args);
  if (!merged.ok) {
    return { ok: false, error: `[${expectedType}_window.set_viewport] ${merged.error}` };
  }
  return { ok: true, state: { ...ctx.windowState, viewport: merged.viewport } };
}
