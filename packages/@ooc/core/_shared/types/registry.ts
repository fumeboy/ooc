/**
 * ObjectRegistry 相关类型 + filterMethodsByVisibility 纯函数 —— canonical 源。
 *
 * Wave 4 对象模型重构：registry 从存旧 `ObjectDefinition`（methods Record + 旧 readable +
 * onClose/compressView/consumedMessageIds 等 deferred hook）改为存新契约 `OocClass`
 * （construct / executable / readable / persistable 四维度模块）。
 *
 * **本文件只留两样东西**：
 * - `RegisteredClass`：registry store 的元素类型 = `OocClass` + 继承元信息（parentClass / isBuiltinFeature）。
 * - `filterMethodsByVisibility`：按可见性档位过滤 object method（纯函数，无可变状态）。
 *
 * 旧 hook 类型（OnCloseHook / CompressViewHook / ReadableFn / RenderContext / ConsumedMessageIdsHook）
 * 在 Wave 4 直接丢弃——它们是 Wave 4 之后 re-home 的，不为兼容保留。
 */

import type { OocClass } from "../../runtime/ooc-class.js";
import type { ObjectMethod } from "../../executable/contract.js";

/**
 * registry store 的元素 —— 一个已注册 class 的全部信息。
 *
 * = `OocClass`（construct/executable/readable/persistable）+ 继承/可见性元信息：
 * - parentClass     : 单链继承父类 id（`undefined` → 隐式继承 root；`null` → 无父=继承链终点）。
 * - isBuiltinFeature : 标记 Object 内置特性类（method_exec 等临时载体），影响 ownerRef 解析。
 */
export interface RegisteredClass<Data = any> extends OocClass<Data> {
  parentClass?: string | null;
  isBuiltinFeature?: boolean;
}

// ——— Method Visibility Filtering（纯函数，不依赖状态）———

export type MethodVisibilityContext =
  | { kind: "self" }
  | { kind: "peer"; viewerObjectId: string }
  | { kind: "ui" };

/**
 * 按可见性档位过滤 object method 列表。纯函数，canonical 源。
 *
 * - self → 全部可见
 * - peer → 仅 public=true
 * - ui   → 仅 for_ui_access=true
 */
export function filterMethodsByVisibility(
  methods: ObjectMethod[],
  ctx: MethodVisibilityContext,
): ObjectMethod[] {
  return methods.filter((method) => {
    switch (ctx.kind) {
      case "self":
        return true;
      case "peer":
        return method.public === true;
      case "ui":
        return method.for_ui_access === true;
    }
  });
}
