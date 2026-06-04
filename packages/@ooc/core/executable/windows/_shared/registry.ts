/**
 * ObjectRegistry — 把每种 ContextObject 类型的"行为契约"集中在这里。
 *
 * 2026-06-03 ooc-6 cleanup Phase A：
 * - 已删除 ObjectTypeDefinition（重命名为 ObjectDefinition）
 * - 已删除 ObjectDefinition.prototype（重命名为 parentClass）
 * - 已删除 ObjectDefinition.methods（重命名为 methods）
 *
 * 2026-06-04 ooc-6 cleanup Phase E：
 * - 已删除所有 thin wrapper 函数（registerObjectType / getObjectDefinition /
 *   listRegisteredObjectTypes / lookupMethod / lookupMethodEntry / resolveMethod /
 *   lookupConstructor / isBuiltinFeatureType / resolveParentClassChain /
 *   resolveEffectiveVisibleType / assertAllObjectDefinitionsRegistered / registerNewObjectType）
 * - 已删除 module-level defaultObjectRegistry singleton
 *
 * 本文件：
 * - 保留所有类型定义 (interface/type)——它们不依赖可变状态，是 canonical 源。
 * - 导出 builtinRegistry：builtin 类型通过 side-effect import 向此注册表注册。
 * - 导出 createObjectRegistry：创建独立 ObjectRegistry 实例。
 * - 导出 filterMethodsByVisibility：纯函数，不依赖状态。
 *
 * 使用迁移指引：
 * - Builtin 注册：import { builtinRegistry } from "./registry.js"; builtinRegistry.registerObjectType(...)
 * - 运行时查找：通过 WorldRuntime.objects（per-world registry）或 WindowManager.registry
 * - 测试/独立场景：const reg = createObjectRegistry(); reg.registerObjectType(...)
 */
import type { ThreadContext } from "../../../thinkable/context.js";
import type { XmlNode } from "../../../thinkable/context/xml.js";
import type { ObjectMethod } from "./command-types.js";
import type { ContextWindow, ObjectType, ContextObject } from "./types.js";
import {
  builtinRegistry,
  createObjectRegistry,
  filterMethodsByVisibility as _filterMethodsByVisibility,
  ObjectRegistry,
} from "../../../runtime/object-registry.js";

// ——— 类型定义（canonical）———

export interface OnCloseContext {
  thread: ThreadContext;
  window: ContextWindow;
}
export type OnCloseHook = (ctx: OnCloseContext) => boolean | void;

export interface RenderContext {
  thread: ThreadContext;
  window: ContextWindow;
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

export type { ObjectRegistry, ObjectMethod, ContextWindow, ObjectType, ContextObject };
export { builtinRegistry, createObjectRegistry };

// ——— Method Visibility Filtering（纯函数，不依赖状态）———

export type MethodVisibilityContext =
  | { kind: "self" }
  | { kind: "peer"; viewerObjectId: string }
  | { kind: "ui" };

export function filterMethodsByVisibility(
  methods: Record<string, ObjectMethod>,
  ctx: MethodVisibilityContext,
): Record<string, ObjectMethod> {
  return _filterMethodsByVisibility(methods, ctx);
}
