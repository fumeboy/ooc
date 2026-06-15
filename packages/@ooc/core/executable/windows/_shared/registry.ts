/**
 * ObjectRegistry 旧 import 路径桥（`executable/windows/_shared/registry`）。
 *
 * canonical 源：
 * - 类型/纯函数（`RegisteredClass` / `MethodVisibilityContext` / `filterMethodsByVisibility`）
 *   在 `@ooc/core/_shared/types/registry.ts`。
 * - 可变注册状态（`builtinRegistry` / `createObjectRegistry` / `ObjectRegistry`）在
 *   `@ooc/core/runtime/object-registry.ts`。
 *
 * Wave 4 对象模型重构丢弃的旧 hook 类型（OnCloseHook / OnCloseContext / RenderContext /
 * ReadableFn / CompressViewHook / ObjectDefinition）已不再 re-export——它们随旧
 * `ObjectDefinition` 契约一并废弃，不为兼容保留。
 */

export type {
  RegisteredClass,
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
