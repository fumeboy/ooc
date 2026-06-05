/**
 * ObjectRegistry —— 类型部分的 canonical 源已于 batch C7 迁入
 * `@ooc/core/_shared/types/registry.ts`；此处 re-export 保持旧 import 路径
 * (`executable/windows/_shared/registry`) 可用，并桥接 runtime 的可变状态部分。
 *
 * 本文件 runtime 桥接：
 * - 从 `runtime/object-registry.ts` re-export `builtinRegistry` / `createObjectRegistry`
 *   / `ObjectRegistry`（含可变注册状态，不可下沉 `_shared`）。
 * - 从 `_shared` re-export 所有 hook/定义类型 + `filterMethodsByVisibility` 纯函数。
 *
 * 使用迁移指引：
 * - Builtin 注册：import { builtinRegistry } from "./registry.js"; builtinRegistry.registerObjectType(...)
 * - 运行时查找：通过 WorldRuntime.objects（per-world registry）或 WindowManager.registry
 * - 测试/独立场景：const reg = createObjectRegistry(); reg.registerObjectType(...)
 */

export type {
  OnCloseContext,
  OnCloseHook,
  RenderContext,
  RenderHook,
  ReadableFn,
  CompressViewHook,
  ObjectDefinition,
  MethodVisibilityContext,
} from "../../../_shared/types/registry.js";
export { filterMethodsByVisibility } from "../../../_shared/types/registry.js";

export type { ObjectMethod } from "../../../_shared/types/method.js";
export type { ContextWindow, ObjectType, ContextObject } from "./types.js";

export {
  builtinRegistry,
  createObjectRegistry,
  ObjectRegistry,
} from "../../../runtime/object-registry.js";
export type { ObjectRegistry as ObjectRegistryType } from "../../../runtime/object-registry.js";
