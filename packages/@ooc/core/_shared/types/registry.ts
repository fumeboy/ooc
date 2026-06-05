/**
 * ObjectRegistry 相关类型 + filterMethodsByVisibility 纯函数 —— canonical 源
 * （batch C7 从 `executable/windows/_shared/registry.ts` 迁入类型部分）。
 *
 * **留在 runtime / executable**（含可变状态，不可下沉 `_shared`）：
 * - `ObjectRegistry` class、`builtinRegistry` singleton、`createObjectRegistry()` 工厂
 *   （在 `runtime/object-registry.ts`）
 *
 * **迁入本文件**：所有 hook/定义类型 + `filterMethodsByVisibility`（纯函数，无可变状态）。
 */

import type { ContextObject, ObjectType } from "./context-window.js";
import type { ThreadContext } from "./thread.js";
import type { XmlNode } from "./xml.js";
import type { ObjectMethod } from "./method.js";

export interface OnCloseContext {
  thread: ThreadContext;
  window: ContextObject;
}
export type OnCloseHook = (ctx: OnCloseContext) => boolean | void;

export interface RenderContext {
  thread: ThreadContext;
  window: ContextObject;
}
export type RenderHook = (ctx: RenderContext) => XmlNode[] | Promise<XmlNode[]>;

export type ReadableFn = (ctx: RenderContext) => XmlNode[] | Promise<XmlNode[]>;

export type CompressViewHook = (
  ctx: RenderContext,
  level: 1 | 2,
) => XmlNode[] | Promise<XmlNode[]>;

/**
 * Object 类型定义（canonical，2026-06-03 ooc-6 cleanup Phase A：原 ObjectTypeDefinition 重命名）。
 *
 * 已删除 deprecated 字段：
 * - `commands` → 使用 `methods`
 * - `prototype` → 使用 `parentClass`
 */
export interface ObjectDefinition {
  type: ObjectType;
  methods: Record<string, ObjectMethod>;
  onClose?: OnCloseHook;
  renderXml?: RenderHook;
  compressView?: CompressViewHook;
  basicKnowledge?: string;
  readable?: ReadableFn;
  isBuiltinFeature?: boolean;
  parentClass?: string | null;
}

// ——— Method Visibility Filtering（纯函数，不依赖状态）———

export type MethodVisibilityContext =
  | { kind: "self" }
  | { kind: "peer"; viewerObjectId: string }
  | { kind: "ui" };

/**
 * 按可见性档位过滤 method 表。纯函数，canonical 源（batch C7 从 runtime/object-registry.ts 迁入）。
 *
 * - self → 全部可见
 * - peer → 仅 public=true
 * - ui   → 仅 for_ui_access=true
 */
export function filterMethodsByVisibility(
  methods: Record<string, ObjectMethod>,
  ctx: MethodVisibilityContext,
): Record<string, ObjectMethod> {
  const filtered: Record<string, ObjectMethod> = {};
  for (const [name, method] of Object.entries(methods)) {
    switch (ctx.kind) {
      case "self":
        filtered[name] = method;
        break;
      case "peer":
        if (method.public === true) filtered[name] = method;
        break;
      case "ui":
        if (method.for_ui_access === true) filtered[name] = method;
        break;
    }
  }
  return filtered;
}
