/**
 * ObjectRegistry store 元素类型 `RegisteredClass` —— canonical 源。
 *
 * Wave 4 对象模型重构：registry 从存旧 `ObjectDefinition`（methods Record + 旧 readable +
 * onClose/compressView/consumedMessageIds 等 deferred hook）改为存新契约 `OocClass`
 * （construct / executable / readable / persistable / visibleServer 模块）。
 *
 * 旧 hook 类型（OnCloseHook / CompressViewHook / ReadableFn / RenderContext / ConsumedMessageIdsHook）
 * 在 Wave 4 直接丢弃——它们是 Wave 4 之后 re-home 的，不为兼容保留。
 */

import type { OocClass } from "../../runtime/ooc-class.js";

/**
 * registry store 的元素 —— 一个已注册 class 的全部信息。
 *
 * = `OocClass`（construct/executable/readable/persistable）+ 继承元信息：
 * - parentClass : object 经 ooc.class 单跳继承的那**一个**父类 id（`undefined` / `null` → 无父，
 *   自身即终点；class 不继承 class，无「万物之根」回退）。
 *
 * 注：旧 `isBuiltinFeature` 标志（标记 inline 持久化的运行态自有窗）已退役——inline 持久化策略
 * 现由 class 自己的 `persistable.mode === "inline"` 声明（见 persistable/contract.ts），
 * registry 经 `isInlinePersisted(class)` 沿继承链解析，不再硬编码标志位。
 */
export interface RegisteredClass<Data = any> extends OocClass<Data> {
  parentClass?: string | null;
}
