/**
 * ObjectRegistry 相关类型 + filterMethodsByVisibility 纯函数 —— canonical 源
 * （从 `executable/windows/_shared/registry.ts` 迁入类型部分）。
 *
 * **留在 runtime / executable**（含可变状态，不可下沉 `_shared`）：
 * - `ObjectRegistry` class、`builtinRegistry` singleton、`createObjectRegistry()` 工厂
 *   （在 `runtime/object-registry.ts`）
 *
 * **迁入本文件**：所有 hook/定义类型 + `filterMethodsByVisibility`（纯函数，无可变状态）。
 */

import type { ContextWindow } from "./context-window.js";
import type { ThreadContext } from "./thread.js";
import type { XmlNode } from "./xml.js";
import type { ObjectMethod } from "./method.js";
import type { WindowMethod } from "./window-method.js";

export interface OnCloseContext {
  thread: ThreadContext;
  window: ContextWindow;
}
export type OnCloseHook = (ctx: OnCloseContext) => boolean | void;

export interface RenderContext {
  thread: ThreadContext;
  window: ContextWindow;
}

export type ReadableFn = (ctx: RenderContext) => XmlNode[] | Promise<XmlNode[]>;

export type CompressViewHook = (
  ctx: RenderContext,
  level: 1 | 2,
) => XmlNode[] | Promise<XmlNode[]>;

/**
 * 列出某个 window 在本轮已"消费"的 inbox/outbox 消息 id。
 *
 * 用途：renderer 在渲染顶层 inbox/outbox fallback 时，需要排除那些已被某个
 * window（如 do/talk）的 transcript 视图展示过的消息，避免重复渲染。每个 window
 * type 自己最清楚"哪些消息属于我的 transcript"，故把该判定下放到 ObjectDefinition。
 *
 * 解耦动机（ooc-6 G4）：消除 renderer（thinkable）对 do/talk 过滤函数（executable）
 * 的直接 import；改由 registry 派发。返回 `{ id }` 序列即可，renderer 只取 id。
 */
export type ConsumedMessageIdsHook = (
  ctx: RenderContext,
) => Iterable<{ id: string }>;

/**
 * Object 类型定义（canonical，原 ObjectTypeDefinition 重命名）。
 *
 * 已删除字段：
 * - 旧 `commands` → `methods`；`prototype` → `parentClass`
 * - `type` —— registry Map key 即 type，字段冗余（string 类型本身也在逐步退役）
 * - `renderXml` → `readable`（签名一致的标准替代）
 * - `basicKnowledge` —— type 级协议知识通道退役
 *
 * stone 的 `executable/index.ts` `export const window` 即本形状的 Partial
 * （旧 StoneObjectDeclaration 已删，与本定义冗余）。
 */
export interface ObjectDefinition {
  methods: Record<string, ObjectMethod>;
  /**
   * Window method 表（归 readable 维度，控制 window 展示）。与 methods（object method,
   * 归 executable）物理分离。dispatch 时优先查此表。
   */
  windowMethods?: Record<string, WindowMethod>;
  onClose?: OnCloseHook;
  compressView?: CompressViewHook;
  readable?: ReadableFn;
  isBuiltinFeature?: boolean;
  parentClass?: string | null;
  /**
   * 可选 hook：列出本 window 在 transcript 视图中已消费的 inbox/outbox 消息 id，
   * 供 renderer 去重顶层 inbox/outbox（见 ConsumedMessageIdsHook）。
   */
  consumedMessageIds?: ConsumedMessageIdsHook;
}

// ——— Method Visibility Filtering（纯函数，不依赖状态）———

export type MethodVisibilityContext =
  | { kind: "self" }
  | { kind: "peer"; viewerObjectId: string }
  | { kind: "ui" };

/**
 * 按可见性档位过滤 method 表。纯函数，canonical 源（从 runtime/object-registry.ts 迁入）。
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
