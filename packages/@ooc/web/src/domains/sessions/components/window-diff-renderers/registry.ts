/**
 * Round 10 F3 — Window diff renderer registry.
 *
 * Type-dispatch 入口：每个 window type 注册一个独立 renderer，LoopDiffView 展开某
 * window 时按 type 派发。
 *
 * 协议（与 meta/object.doc.ts visible.children.loop_timeline.patches.type_dispatch_diff_renderer 对齐）：
 *
 *   - previous: 上一 loop 该 window 在 contextSnapshot 中的完整对象（added 时 undefined）
 *   - current : 本 loop 该 window 在 contextSnapshot 中的完整对象（removed 时 undefined）
 *
 * 未注册 type / renderer 抛错 → FallbackJsonDiff + DiffRendererErrorBoundary（见 ErrorBoundary.tsx）。
 *
 * 不变量：
 *   - 注册是 idempotent（同 type 重复 register 后注册者覆盖；测试用 reset 清空）
 *   - 不抛错（找不到返回 undefined；调用方负责 fallback）
 *
 * 单测可通过 `resetWindowDiffRegistry()` 隔离全局状态。
 */

import type { ReactNode } from "react";

export interface WindowDiffRendererProps {
  /** 上一 loop 该 window 的完整对象（added 时 undefined）。 */
  previous: unknown;
  /** 本 loop 该 window 的完整对象（removed 时 undefined）。 */
  current: unknown;
  /** Window type 字面量（dispatch key）。 */
  windowType: string;
  /** Window id（renderer 内可用作 anchor / tooltip）。 */
  windowId: string;
}

export type WindowDiffRenderer = (props: WindowDiffRendererProps) => ReactNode;

const REGISTRY = new Map<string, WindowDiffRenderer>();

/** 注册某 type 的 renderer；后注册覆盖先注册（测试中可临时替换）。 */
export function registerWindowDiffRenderer(
  type: string,
  renderer: WindowDiffRenderer,
): void {
  REGISTRY.set(type, renderer);
}

/** 查 renderer；未注册返回 undefined（调用方决定 fallback）。 */
export function getWindowDiffRenderer(
  type: string,
): WindowDiffRenderer | undefined {
  return REGISTRY.get(type);
}

/** 调试 / 单测：列出当前已注册的 type 名（顺序不稳定）。 */
export function listRegisteredDiffRenderers(): string[] {
  return Array.from(REGISTRY.keys());
}

/** 测试 hook：清空 registry。生产代码不应调用。 */
export function resetWindowDiffRegistry(): void {
  REGISTRY.clear();
}
