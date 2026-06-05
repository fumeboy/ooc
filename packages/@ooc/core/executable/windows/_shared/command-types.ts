/**
 * Object Method 相关类型 —— canonical 源已于 batch C7 迁入
 * `@ooc/core/_shared/types/method.ts`；此处 re-export 保持旧 import 路径
 * (`executable/windows/_shared/command-types`) 可用。
 *
 * **契约决策（batch C7，见 docs/refactor_0604/shared-types.md §3.2）**：
 * `MethodExecutionContext` 的 `manager` 字段在零依赖层声明为 `unknown`、`form` 为 base
 * `ContextObject`——因为 `_shared` 不能引 WindowManager / MethodExecWindow 的 runtime 类型。
 * executable 内部与 builtins 的 method 实现在用到 `ctx.manager` / `ctx.form` 的具体能力时，
 * **在调用点 cast** 回 `WindowManager` / `MethodExecWindow`（runtime 保证类型成立）。
 * 这样 `ObjectMethod.exec` 的签名在所有层保持一致，避免函数逆变导致的类型分裂。
 */
export type {
  MethodKnowledgeEntries,
  MethodOutcome,
  ObjectMethod,
  MethodExecutionContext,
} from "../../../_shared/types/method.js";
