# C9/C10 集成：消费方 narrowing 范式

> batch C 把 ContextWindow 家族的 base 类型迁入零依赖 `_shared`。`_shared` 导出的是
> **base 超类型**（`BaseContextWindow` / base `ContextObject` / `MethodExecutionContext.manager: unknown`）。
> 完整 discriminated union（`RootWindow | MethodExecWindow | …`）与 `WindowManager` 留在 executable 层。
> 消费方在需要具体字段处 **narrow 回具体类型**——这就是 C9/C10 的集成债（~126 个 tsc 错误）。

## 两个 ContextObject（关键陷阱）

| 来源 | `ContextObject` 含义 |
|------|---------------------|
| `@ooc/core/_shared`（base 版） | `= BaseContextWindow`（超类型，只有共通字段） |
| `@ooc/core/executable/windows/_shared/types`（union 版，覆盖同名 export） | `RootWindow \| MethodExecWindow \| …`（完整 union） |
| `@ooc/core/extendable/_shared/types`（re-export executable union） | 同 union 版 |

- `ObjectMethod.exec` / `onFormChange` 的契约参数（`ctx.form` / `ctx.self`）= **base 版**。
- 工作在契约层的共享 helper（guidance/delegator）应从 `@ooc/core/_shared` 引 base 类型，**不要**引 union 版——否则 base 实参无法传入 union 形参。（已修，见 guidance.ts）

## narrowing 范式

### N1 — `ctx.form` / 回调 form → 具体 window
form 在契约层是 base。需要 `accumulatedArgs` / `command` 等具体字段时，在 exec/onFormChange 顶部 **narrow 一次**：

```ts
import type { MethodExecWindow } from "@ooc/core/extendable/_shared/types.js";
exec: (ctx) => {
  const form = ctx.form as MethodExecWindow; // runtime 保证 form 即 method_exec form
  const args = form.accumulatedArgs;
  ...
}
```
do/talk/relation/file 等其它 window 同理（narrow 到对应类型）。

### N2 — `ctx.manager`（unknown）→ WindowManager
```ts
import type { WindowManager } from "@ooc/core/executable/windows/_shared/manager.js";
const manager = ctx.manager as WindowManager;
manager.upsertWindow(...);
```
若 builtins 无法直接引 manager，cast 到所需方法的最小结构类型（见 delegator.ts 的 `{ registry?: … }`）。

### N3 — 共享 helper 接受 base，内部 narrow（已应用）
`buildGuidanceWindows(form: ContextWindow /*base*/, …)`：只读 base `id` + 内部对 `command` narrow 一次。

### N4 — 传 base 到 union 形参 / base[] → union[]
manager/tools 把 `BaseContextWindow` 推入 union 形参时，在调用点 `as ContextObject`（union 版）或 `as ContextObject[]`。返回处同理。

## 规则
1. **只加 narrowing，不改运行时行为**：cast 是把"runtime 已保证、类型层丢失"的信息补回，不得改逻辑。
2. **narrow 一次，就近复用**：优先在函数顶部 narrow 出局部变量，避免每处访问重复 cast。
3. **就近注释**：每个 cast 旁一句话说明"为何 runtime 保证此类型成立"（参照 guidance.ts/delegator.ts 已有注释风格）。
4. **不碰 baseline**：`app/server/index.ts` 的 `./modules/pools`+`./modules/flows`（批次 F3 恢复）、`program/visible` 的 `@uiw/react-codemirror`（依赖问题）不在本轮范围。

## 验收
```
bun tsc --noEmit 2>&1 | grep -E '^packages/@ooc/(core|builtins)/' \
  | grep -vE '/web/|__tests__|/e2e/|\.test\.ts|_verify\.ts|storybook/' \
  | grep -vE 'modules/pools|modules/flows|react-codemirror'
```
输出为空（0 行）即通过。
