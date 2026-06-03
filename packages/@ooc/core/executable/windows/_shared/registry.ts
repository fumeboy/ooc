/**
 * WindowRegistry / ObjectRegistry — 把每种 ContextWindow 类型的"行为契约"集中在这里。
 *
 * @deprecated (M1 2026-06-02) 直接使用 registry 函数的位置请逐步迁移到
 *   `import { createObjectRegistry, ObjectRegistry } from "@ooc/core/runtime/object-registry"`
 *   或通过 `WorldRuntime.objects` 访问 per-world 实例。
 *
 * 本文件：
 * - 保留所有类型定义 (interface/type)——它们不依赖可变状态，是 canonical 源。
 * - 所有函数变成对 `defaultObjectRegistry` (module-level 默认实例) 的 thin wrapper，
 *   保证零调用点修改。
 */
import type { ThreadContext } from "../../../thinkable/context.js";
import type { XmlNode } from "../../../thinkable/context/xml.js";
import type { CommandTableEntry, ObjectMethod } from "./command-types.js";
import type { ContextWindow, WindowType, ObjectType, ContextObject } from "./types.js";
import {
  createObjectRegistry,
  defaultObjectRegistry,
  filterMethodsByVisibility as _filterMethodsByVisibility,
  ObjectRegistry,
} from "../../../runtime/object-registry.js";

// ——— 类型定义（canonical，原封不动保留）———

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

/** @deprecated Use ObjectDefinition instead. */
export interface WindowTypeDefinition {
  type: WindowType;
  commands: Record<string, CommandTableEntry>;
  onClose?: OnCloseHook;
  renderXml?: RenderHook;
  compressView?: CompressViewHook;
  basicKnowledge?: string;
  readable?: ReadableFn;
  isBuiltinFeature?: boolean;
  parentClass?: string | null;
}

export interface ObjectDefinition extends Omit<WindowTypeDefinition, "commands"> {
  type: ObjectType;
  methods: Record<string, ObjectMethod>;
  /** @deprecated Use `methods` instead. */
  commands: Record<string, ObjectMethod>;
  /** @deprecated Use `parentClass` instead. */
  prototype?: string;
  readable?: ReadableFn;
  isBuiltinFeature?: boolean;
  parentClass?: string | null;
}

export type { ObjectRegistry, ObjectMethod, CommandTableEntry, ContextWindow, WindowType, ObjectType };
export { createObjectRegistry };

// ——— 函数 wrapper（全部委托给 module-level 默认实例）———

/** @deprecated Use registerObjectType instead. */
export function registerWindowType(
  type: WindowType,
  partial: Partial<Omit<WindowTypeDefinition, "type">>,
): void {
  defaultObjectRegistry.registerWindowType(type, partial);
}

export function registerObjectType(
  type: ObjectType,
  partial: Partial<Omit<ObjectDefinition, "type">>,
): void {
  defaultObjectRegistry.registerObjectType(type, partial);
}

export function registerNewObjectType(
  type: ObjectType,
  definition: Partial<ObjectDefinition> & { commands?: Record<string, any>; methods?: Record<string, any> },
): void {
  defaultObjectRegistry.registerNewObjectType(type, definition);
}

/** @deprecated Use getObjectDefinition instead. */
export function getWindowTypeDefinition(type: WindowType): WindowTypeDefinition {
  return defaultObjectRegistry.getWindowTypeDefinition(type);
}

export function getObjectDefinition(type: ObjectType): ObjectDefinition {
  return defaultObjectRegistry.getObjectDefinition(type);
}

export function isBuiltinFeatureType(type: ObjectType): boolean {
  return defaultObjectRegistry.isBuiltinFeatureType(type);
}

export function resolveParentClassChain(startType: ObjectType): string[] {
  return defaultObjectRegistry.resolveParentClassChain(startType);
}

export function lookupMethod(
  parentWindow: { type: ObjectType },
  methodName: string,
): ObjectMethod | undefined {
  return defaultObjectRegistry.lookupMethod(parentWindow, methodName);
}

export function lookupMethodEntry(
  parentWindow: { type: ObjectType },
  methodName: string,
): { entry: ObjectMethod; declaringType: ObjectType } | undefined {
  return defaultObjectRegistry.lookupMethodEntry(parentWindow, methodName);
}

export function resolveMethod(
  classId: string,
  methodName: string,
): ObjectMethod | undefined {
  return defaultObjectRegistry.resolveMethod(classId, methodName);
}

export function lookupConstructor(type: ObjectType): ObjectMethod | undefined {
  return defaultObjectRegistry.lookupConstructor(type);
}

/** @deprecated Use listRegisteredObjectTypes instead. */
export function listRegisteredWindowTypes(): WindowType[] {
  return defaultObjectRegistry.listRegisteredWindowTypes();
}

export function listRegisteredObjectTypes(): ObjectType[] {
  return defaultObjectRegistry.listRegisteredObjectTypes();
}

/** @deprecated Use assertAllObjectDefinitionsRegistered instead. */
export function assertAllRenderHooksRegistered(): void {
  defaultObjectRegistry.assertAllRenderHooksRegistered();
}

export function assertAllObjectDefinitionsRegistered(): void {
  defaultObjectRegistry.assertAllObjectDefinitionsRegistered();
}

export function resolveEffectiveVisibleType(type: ObjectType): string | undefined {
  return defaultObjectRegistry.resolveEffectiveVisibleType(type);
}

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
