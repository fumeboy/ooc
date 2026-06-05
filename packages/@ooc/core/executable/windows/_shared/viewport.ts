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

import type { MethodExecutionContext } from "./command-types.js";
import type { ContextWindow } from "./types.js";
import {
  type Viewport,
  DEFAULT_VIEWPORT,
  hasAnyViewportField,
  mergeViewport,
} from "../../../_shared/types/viewport.js";

export * from "../../../_shared/types/viewport.js";

/**
 * file / knowledge window 共享的 set_viewport 执行入口。
 *
 * - 校验 ctx.self 是目标 type
 * - 校验至少有一个 viewport 字段（否则 no-op + 提示）
 * - 合并 + fail-loud 校验
 * - Object.assign 写回 window（按现有 set_range 的同模式，保证 manager.toData() 写回持久层）
 */
export async function executeWindowSetViewport(
  ctx: MethodExecutionContext,
  expectedType: "file" | "knowledge",
): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === expectedType（caller 注册的），
  // method 体不再 re-check self 类型。expectedType 仅用于错误文案 label。
  const window = ctx.self as ContextWindow;
  if (!hasAnyViewportField(ctx.args)) {
    return `[${expectedType}_window.set_viewport] 至少需要传入 line_start / line_end / column_start / column_end 之一。`;
  }
  // 注：FileWindow / KnowledgeWindow 都有 viewport?: Viewport（缺省 = DEFAULT_VIEWPORT）
  const current = (window as { viewport?: Viewport }).viewport ?? DEFAULT_VIEWPORT;
  const merged = mergeViewport(current, ctx.args);
  if (!merged.ok) {
    return `[${expectedType}_window.set_viewport] ${merged.error}`;
  }
  Object.assign(window, { viewport: merged.viewport });
  return undefined;
}
