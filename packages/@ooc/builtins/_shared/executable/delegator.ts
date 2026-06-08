/**
 * Shared root-method delegator factory.
 *
 * Batch B3 (2026-06-04): the 10 root.* method files (grep/glob/open_file/
 * write_file/plan/todo/talk/program/do/open_knowledge) each carried a
 * near-identical thin delegator: look up the target constructor via the
 * registry, fail-loud if unregistered, optionally inject a form shim, then
 * forward to `ctor.exec`.
 *
 * `makeRootDelegator` collapses all 10 into one parameterised factory.
 */

import type {
  MethodExecutionContext,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";

/** root delegator 工厂的配置项。 */
export interface RootDelegatorSpec {
  /** root method 名——用于错误信息前缀 `[<method>]`。 */
  method: string;
  /** lookupConstructor 的目标 kind（被委托的 constructor method 名）。 */
  constructorKind: string;
  /**
   * 被委托对象的人类可读名（错误信息里 `<objectLabel> constructor 未注册`）。
   * 例：plan→"plan_window"、todo→"todo_object"、search→"search_window"。
   */
  objectLabel: string;
  /**
   * 若设置，则在 ctx 缺 form 时注入一个最小 form shim `{ method: formMethod }`，
   * 让 constructor 的 method 分发分支拿到正确名字（生产链路里 manager.submit 会
   * 传完整 form；只有直调路径需要这个 shim）。
   *
   * 多个 root method 共用同一 constructor 时（grep/glob→search，
   * open_file/write_file→file）必须用它消歧；一对一的 constructor 不需要。
   */
  formMethod?: string;
}

/**
 * 构造一个 root method 的 thin delegator exec。
 *
 * 行为：从 `ctx.manager?.registry ?? builtinRegistry` 取 `constructorKind` 对应的
 * constructor，未注册返回 fail-loud 错误串；否则（按需注入 form shim 后）转发
 * 到 `ctor.exec`。
 */
export function makeRootDelegator(
  spec: RootDelegatorSpec,
): (ctx: MethodExecutionContext) => Promise<MethodOutcome | string | undefined> {
  return async (ctx) => {
    // batch C 集成：ctx.manager 在零依赖层是 unknown；narrow 到带 registry 的结构类型
    // （runtime 注入的 WindowManager 保证 registry 存在），缺省回退 builtinRegistry。
    const manager = ctx.manager as { registry?: typeof builtinRegistry } | undefined;
    const ctor = (manager?.registry ?? builtinRegistry).lookupConstructor(spec.constructorKind);
    if (!ctor) {
      return `[${spec.method}] ${spec.objectLabel} constructor 未注册（registry 期望 kind="constructor" 的 ${spec.constructorKind} method）。`;
    }
    // 直调路径的最小 form shim：只携带 method 供 constructor 分发消歧；
    // 经 unknown 转换（partial form，runtime 链路才有完整 form）。
    const target =
      spec.formMethod && !ctx.form
        ? ({ ...ctx, form: { method: spec.formMethod } } as unknown as MethodExecutionContext)
        : ctx;
    return await ctor.exec(target);
  };
}
