/**
 * ObjectRegistry —— 类型部分的 canonical 源已迁入
 * `@ooc/core/_shared/types/registry.ts`；此处 re-export 保持旧 import 路径
 * (`executable/windows/_shared/registry`) 可用，并桥接 runtime 的可变状态部分。
 *
 * 本文件 runtime 桥接：
 * - 从 `runtime/object-registry.ts` re-export `builtinRegistry` / `createObjectRegistry`
 *   / `ObjectRegistry`（含可变注册状态，不可下沉 `_shared`）。
 * - 从 `_shared` re-export 所有 hook/定义类型 + `filterMethodsByVisibility` 纯函数。
 *
 * 使用迁移指引：
 * - Builtin 窗类型注册：import { builtinRegistry } from "./registry.js";
 *   一处 builtinRegistry.registerWindowClass({ type, methods, parentClass, readable, ... })
 *   （seed-if-absent + executable + readable 两维度 + 可见性 flag 合一）。
 * - 运行时查找：通过 builtinRegistry（think/exec/render 默认）或 WindowManager.registry
 * - 测试/独立场景：const reg = createObjectRegistry()（已 seedFrom builtinRegistry）；
 *   要 seed 一个新测试类型走 reg.registerWindowClass(...)。
 */

export type {
  OnCloseContext,
  OnCloseHook,
  RenderContext,
  ReadableFn,
  CompressViewHook,
  ObjectDefinition,
  MethodVisibilityContext,
} from "../../../_shared/types/registry.js";
export { filterMethodsByVisibility } from "../../../_shared/types/registry.js";

export type { ObjectMethod } from "../../../_shared/types/method.js";
export type { ContextWindow } from "./types.js";

export {
  builtinRegistry,
  createObjectRegistry,
  ObjectRegistry,
} from "../../../runtime/object-registry.js";
export type { ObjectRegistry as ObjectRegistryType } from "../../../runtime/object-registry.js";
