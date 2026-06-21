# OOC 对象激活生命周期：`active` / `unactive` 经引用计数

> 设计 spec（docs/ 工作稿）。日期 2026-06-21。
> 设计权威最终回流 `.ooc-world-meta/.../children/object/self.md`（对象模型）+ `children/thinkable/knowledge/thread.md`（thread 的 close/cancel）——见 §9。
> 状态：核心方向已敲定 → 过 4-lens 对抗 review（§10 修订一）→ 用户细化轮（§10 修订二：canceled 状态 / 删 close 逻辑 / construct 标记不可关窗）。**本稿只设计，不实现。** 开放点已清：D1（failed 同 done/canceled 排除）用户 2026-06-21 确认 yes；R5（object self.md 生命周期核心项）已落草案待 review。

## 1. 背景与问题

两条线索在同一处汇合：

1. **`close` 现状是一处半成品退潮。** `close` 同时是顶层 3 原语之一（`OOC_TOOLS=[exec,close,wait]`，`tools/close.ts`）**和** thread 的一个 object method（`thread/.../session-methods.ts`，经 readable 投影仅挂在 `talk`（other-view）窗 `object_methods:["say","close"]`，`readable/index.ts:99`）。两者行为分叉：原语 `handleCloseTool` 只移除窗 + 级联关子窗，无 fork-archive 副作用；方法 `closeMethod` 条件性 `archiveForkChild`（关 fork 窗时把子线程标 paused），再 fire-and-forget 委托原语移除。走原语就漏掉副作用。且与设计权威矛盾——`thread.md` §3 明写「`close` 是 tool 原语、**不是** thread object method」。

2. **系统早有一个 dead `destruct` 槽。** `contract.ts:192` 定义了 `ObjectDestructor`，`ooc-class.ts:49` 有 `destruct?` 槽，但 `contract.ts:190` 自陈：「**暂仅接口定义**——runtime 何时调用 destruct 的机制待实现」。旧 `onClose` hook 是 Wave-4 砍掉的「deferred 承重墙 hook」，只留占位槽。

**核心洞察（用户）**：thread 的 close 逻辑本质对应 OOP 的对象析构，但 OOC 不需要「析构」——OOC object 是持久身份。把 dead `destruct` 重新构想为：**`ContextWindow` 是对 object 的引用；`close` 移除一个引用；引用计数清空触发可选的 `unactive`——thread 的 `unactive` 即把自己切到新状态 `canceled`（停用、磁盘身份留存，非销毁）。** refcount 在 **session 范围、非终态线程**内统计；对称地有 **`active`**。

退潮（删 close 方法 + 复用 dead 槽 + 修文档）≥ 涨潮（一个泛型 unactive 派发 + canceled 状态 + 可关标记）。

## 2. 生命周期模型

`OocClass` 上三个钩子，**全部可选**：

| 钩子 | 触发 | 基数 | v1 状态 | thread 的 body |
|---|---|---|---|---|
| `construct` | 身份诞生（新实例） | 每身份**一次** | 已有 | 造会话窗 Data；**并标记初始 context 中结构窗为不可关**（§5） |
| `active`（新增，**v1 仅类型槽**） | session refcount **0 → 1** | 每次激活 | 不接派发（§6） | —（v1 无 body） |
| `unactive`（新增，复用 dead `destruct?`） | session refcount **1 → 0** | 每次停用 | v1 仅 thread | **把（fork 子）线程切到 `canceled`，并级联停用其子树**（§3.3） |

- `construct` 一次；`active`/`unactive` 重复。**无 `destruct`**——OOC object 是持久身份；「从磁盘删除」是另一件、不在本设计范围的事。
- **签名（非「与 construct 完全同构」）**：生命周期钩子作用于**既有**对象、不产 Data。v1 定 `exec(ctx)`，`ctx` 携带 `thread`（解引用发生处的线程）+ `targetId`（refcount 变动的对象 id）+ `runtime`；**钩子 body 自解析它要操作的对象**（§3.3）。core 派发器保持泛型、零 class policy。

### 2.1 自引用不计数

thread 自己的 self 门面窗 / creator 窗指向自身——**自引用不计入 refcount**（否则只要线程活着就恒 ≥1，永不停用）。refcount 只数**外部引用**。

### 2.2 `canceled` 状态 = 停用态，启用级联（用户细化）

thread 的 `unactive` 不再标 `paused`，而是切到新状态 **`canceled`**：

- **`canceled` 与 `done`/`failed` 同属终态**——`canceled` 线程**持有的 context window 不计入 refcount**（与 `done`/`failed` 一样退出计数）。语义：fork 子任务被放弃，非「暂停可恢复」（`paused` 才是可恢复的活动态）。
- **由此天然级联**：父关掉指向子线程的 fork 窗 → 子线程 refcount 0 → `canceled` → 子线程持有的窗不再计数 → **只被该子线程引用的孙线程 refcount 也归 0 → 一并 `canceled`**。这是引用计数 GC 的自然结果，避免嵌套 fork 留下「running 但无人引用」的孤儿线程。
- refcount 活动态 = **{running, waiting, paused}**；退出态 = **{done, failed, canceled}**。

## 3. 引用计数机制（core）

### 3.1 什么是「引用」（v1 = fork only）

内存里的 `ContextWindow`（=`OocObjectInstance`，`ooc-class.ts:75-84`）只有 `{id,class,parentObjectId,title,status,createdAt,data,win}`——**没有** `_ref`/`refObjectId`（那只活在 `thread-context.json` 磁盘 entry，hydrate 时丢弃）。故 v1 `referencedObjectId(window)` **只解析 fork**：

- **fork 子线程窗**（`isTalkLikeClass(class)` + `data.isForkWindow` + `data.targetThreadId` + `!isSelfThreadWindow(id)`）→ `targetThreadId`。
- **其余一切**（self / peer 跨对象 / 独立成员 / root）→ `undefined`（v1 不派发）。

> 独立成员对象（filesystem/terminal）的生命周期推 **phase-2**：从真实标记 `win.isMemberWindow` 派生，对照 `init.ts` 成员注入核验——不用 `_ref`。

### 3.2 session refcount（v1 = 内存树）

`refcount(targetId)` = session 内 status ∈ **{running, waiting, paused}** 的线程中，`referencedObjectId(W) === targetId` 的外部引用窗数。退出态 **{done, failed, canceled} 排除**。

- **v1 只数内存线程树**（当前线程 + 沿 `_parentThreadRef` 的根 + 各自 `childThreads` 递归）。fork driver 全程在内存树内（`index.ts:99-105`），无需盘扫。
- **session 全范围盘扫推 phase-2**（路径 `flows/<sid>/objects/<nestedObjectPath>/threads/<tid>` 含 `children/` 嵌套，`common.ts:61-73`；v1 无消费者）。

### 3.3 派发（v1 = 仅 unactive，仅 close 触发，含级联）

新增 core 侧泛型模块 `object-lifecycle.ts`：

- `referencedObjectId(window)`（§3.1）。
- `countSessionReferences(ctxThread, targetId)`（§3.2，内存树）。
- `dispatchUnactiveIfZero(ctxThread, targetId, targetClass, registry)`：
  1. `hook = registry.resolveUnactive(targetClass)`；**无则 return（fast-path）**——refcount 成本只在被解引用对象 class 真声明 unactive 时付（v1 仅 fork-close）。
  2. `countSessionReferences > 0` 则 return。
  3. 否则 `hook.exec({ thread: ctxThread, targetId, runtime })`——**单次调用**，body 自解析目标。core **不** import 任何 thread 符号、不 special-case `THREAD_CLASS_ID`。

**thread 的 `unactive` body（thread builtin 内，含级联）**：把 `findChild(ctx.thread, ctx.targetId)` 定位的子线程切 `canceled`，再遍历该子线程持有的窗、对每个 `referencedObjectId` 重算 refcount，归 0 的递归停用——**有界 DFS、visited 集去重**（在 body 内 per-call，不用模块级 mutable）。core helper（`referencedObjectId`/`countSessionReferences`）被 thread builtin import；**级联是 thread policy、不在 core dispatcher**（core 与 construct dispatch 同构、保持单次泛型）。

持久化沿用既有线程 save（worker tick 落盘；旧 archiveForkChild 也只置 status）。

### 3.4 v1 派发边界：仅 intra-object fork

v1 unactive **只对 fork 子线程**派发（§3.1 只认 fork）。**不**对 peer 跨对象窗指向的对端线程派发——对端是独立对象、有自己的生命周期。由 `referencedObjectId` 直接保证。

## 4. 改动面（v1）

| 层 | 改动 | 锚点 |
|---|---|---|
| executable 契约 | 删 `ObjectDestructor`；加 `ObjectLifecycleHook`（`exec(ctx)`）+ `LifecycleContext`（带 targetId） | `core/executable/contract.ts:192` |
| OocClass | `destruct?` → `active?`(仅声明) + `unactive?`；**`OocObjectInstance` 加 `closable?: boolean`** | `core/runtime/ooc-class.ts:49,75-84` |
| thread status | **`ThreadStatus` 加 `"canceled"`**；UI status union 同步；consumer 把 canceled 同 done/failed 当终态/不可运行 | `_shared/types/thread.ts:398`、`flows/model.ts:71`、`worker.ts:298` 等 |
| registry | 加 `resolveActive`/`resolveUnactive`（`selfThenChain` for 循环，同 `resolveConstructor`）；merge 块补 active/unactive 保留 | `core/runtime/object-registry.ts:117-165` |
| object-lifecycle | 新增泛型模块：`referencedObjectId` + `countSessionReferences`（内存树）+ `dispatchUnactiveIfZero`（单次泛型）。**零 thread import** | 新文件 `core/runtime/object-lifecycle.ts` |
| close 原语 | ①移除窗前查 `inst.closable===false` → 报错不关（§5）；②移除窗后算 `referencedObjectId`，非空则 `dispatchUnactiveIfZero` | `core/executable/tools/close.ts` |
| thread init | `initContextWindows` 给 creator/self 结构窗标 `closable:false`（construct 环节） | `core/thinkable/context/init.ts` |
| **thread** | **删 `close` 方法**；加 `Class.unactive`（cancelSubtree 级联）；readable `talk` 去 `"close"` | `thread/.../session-methods.ts`、`index.ts`、`readable/index.ts:99` |

**不在 v1**：`active` 派发（仅类型槽）；session 盘扫；独立成员 unactive；peer/独立对象的 canceled。

## 5. 不可关窗 = construct 标记 + 原语 honor（用户细化，原 §5 A/B 已解）

删 thread 旧 close 逻辑后，「creator/结构窗不可关」由**数据驱动**实现，而非旧的 type-registered onClose hook：

1. **construct 标记**：thread 构造初始 context 时（`initContextWindows` 等 construct 环节），给**结构窗**（v1：creator/self 门面窗）标 `closable: false`（落 `OocObjectInstance.closable`）。机制通用——任何 class 的 construct 都可标自己的结构窗不可关。
2. **原语 honor**：`close` 原语关窗前查 `inst.closable === false` → 返回错误提示（如「该 window 不可关闭（thread 与 creator 的恒在通道）」）、不关。
3. **这不是复活退役 hook**：旧 onClose 是 per-class 回调（可跑任意逻辑/拒绝/归档）；本方案是 per-instance 静态布尔 + 原语一处读取，简单、声明式。
4. **它顺带补严了原 smell**：旧实现「creator 不可关」只靠 readable 不 surface 方法、**挡不住原语**（`tools.test.ts:99` 证实原语当前能关 creator）；新 `closable` 标记被原语 honor，**原语路径也挡住**。
5. **是一次有意的行为变更**：`tools.test.ts:99`「close 释放任意 window（含 creator）」断言反转——creator 窗现 `closable:false`、关之报错。实现时**显式改该测试 + 注明**（不夹带）。fork 子窗、普通成员窗仍 closable。

## 6. 范围与分期

- **v1 = `close` + 级联 `close` 触发 unactive；仅 fork 子线程；内存树 refcount；canceled + 子树级联；construct 标记不可关窗。**
- **`active`**：v1 仅在契约/OocClass 定义 `active?` 类型槽，不接派发（v1 零 active body；强接=再造无消费者死机制）。首个 active body 出现时再 demand-driven 接，seam = `WindowManager.instantiate`（OOC 无 open tool）。
- **phase 2**：① session 盘扫 refcount；② 独立成员对象 unactive；③ peer/跨对象的引用与停用（与 `context.md` core-11「thread 终止钩子」方向合并，不另起）；④ `active` 派发；⑤ 跨进程/重载的 canceled 一致性。
- v1 缺口：仅被某条已终态线程（含 canceled）引用的对象，留活到后续某次 close 重算才停用——最终一致、非永不泄漏。

## 7. 风险与待确认点

- **D1（已确认 yes，2026-06-21）**：`failed` 线程同 `done`/`canceled` **排除**出 refcount（三者皆终态）。`ACTIVE_STATUS = {running, waiting, paused}`。
- **R-canceled（新增 surface）**：`canceled` 是新终态，consumer 面要扫全：`ThreadStatus` 枚举（`thread.ts:398`）、UI status union（`flows/model.ts:71`）、worker 跨对象 end 同步（`worker.ts:298` 现判 `!=="done" && !=="failed"`，须补 canceled）、scheduler 不调度 canceled、thread-query 活动扫描（`thread-query.ts:37` 仅列 running/waiting，天然排除）。统一「canceled 同 done/failed 当终态/不可运行」。
- **R-fork-self-exclusion**：子线程自己的 self 窗（`isSelfThreadWindow`）不计数（§2.1），故运行中的 fork 子线程在父关 fork 窗后 refcount 归 0。**characterization test 锁死**（删 closeMethod 前先加当前行为测试）。
- **R-cascade 有界**：级联 DFS 用 per-call visited 集去重，防环；不用模块级 mutable（对抗 review P1-5）。
- **R-register-merge**：`object-registry.ts:117-121` merge 块须补 active/unactive 保留行。
- **R-sibling-close**（实现期核）：删 thread close 方法后，grep 有无其它 class 注册 close object method（避免 thread 成孤例）。
- **R-object-authority 听写锁定**：object self.md 核心 9 条逐条与用户敲定；新增「生命周期」核心项须走用户听写/grill，§9 标待用户敲定。

## 8. 反过度机制化自检

- **不是新维度/子系统**：补全 `construct` 的镜像钩子，dead 槽已预留。
- **退潮 ≥ 涨潮**：删 1 撞名方法 + 1 dead 接口 + 1 文档谎 + `archiveForkChild` 死路；净加 = 一个 lifecycle 钩子接口 + 一个**泛型** dispatch + 一个 `canceled` 状态 + 一个 `closable` 布尔。对抗 review 已砍 disk-scan/active-dispatch/`_ref`/旧 closable 守卫四处投机面。
- **按需、无状态**：refcount 当场算（内存树），不建持久引用索引；fast-path 把成本钉在 fork-close。
- **canceled 级联是引用计数 GC 的直接结果**，非新机制：canceled 不计数 → 孤儿子树自然归 0 → 有界 DFS 收尾。
- **closable 是 per-instance 数据 + 原语一处读**，不是复活 per-class onClose 回调（§5.3）。
- **boundary 正交（已落实）**：`object-lifecycle.ts` 泛型零 thread import；级联/canceled 是 thread builtin 的 unactive policy。与 construct dispatch（`WindowManager.instantiate` 纯泛型）同构。
- **可选、加性、零强制迁移**：现存 builtin 不动；新 `canceled` 状态只在 consumer 面补「同 done/failed」。

## 9. 文档回流目标（实现期落，不在本稿）

- `children/object/self.md`：核心增「对象生命周期 = construct（一次）/ active / unactive（按 refcount 0↔1，可选）；无 destruct；构造可标结构窗不可关」一项 —— **待用户听写敲定**。
- `children/thinkable/knowledge/thread.md` §3（**agent-facing 行为口吻、不写机制词**）：close 是原语（移除一个引用）；关 fork 子线程窗会使该子线程**取消（canceled）**、其子树一并取消；creator/结构窗不可关，close 之报错；`end` 仍归 agent（正交）。**不写** refcount/dispatch/closable 内部词。
- `children/thinkable/knowledge/context.md`：`context.md:139`「关窗清理钩子」与新 unactive 对账；`context.md:193` core-11「thread 终止钩子」与本 phase-2 ③ 交叉引用、合并方向。
- `children/readable/self.md:84` 退役表：加 `destruct`/`ObjectDestructor`。
- `core/executable/tools/close.ts` 头注：改指向 class `unactive` 钩子 + `closable` 标记。
- `check:doc-drift`/`check-no-deprecated-symbols`：加退役符号 `destruct`/`ObjectDestructor`/thread `close` method/`archiveForkChild`。

## 10. 修订记录

### 修订一（2026-06-21，4-lens grounded 对抗 review）
- **P0**：① `referencedObjectId` 的 `_ref` 分支删除（内存窗无 `_ref`，原分支永不匹配、配套单测 false-green）→ v1 fork-only。② `registry.resolveClass()` 不存在 → 用 `selfThenChain` for 循环（同 `resolveConstructor`）。③ disk-scan 路径形态错 → 砍出 v1。
- **P1**：④ disk-scan 砍除（内存树）。⑤ `active` 派发不接（仅类型槽）。⑥ 旧 closable 守卫（硬编 isSelfThreadWindow）退场。⑦ core dispatcher 去 thread import、body 自解析。⑧ 删模块级 mutable `inFlight`。

### 修订二（2026-06-21，用户细化轮）
- **canceled 状态**：thread `unactive` 由「标 paused」改为「切 `canceled`」；`canceled` 同 done/failed 退出 refcount → **启用嵌套 fork 子树级联停用**（§2.2/§3.3）。
- **删 thread close 逻辑**：确认删 closeMethod，行为换为 refcount→canceled 机制（§3.3）。
- **construct 标记不可关窗**：§5 的 closable 决策由 A/B「待拍板」改为**定案**——per-window `closable` 标记于 construct 设、close 原语 honor。`tools.test.ts:99`「creator 可关」有意反转。
- **新增 surface**：`canceled` 终态的 consumer 扫描（§7 R-canceled）。
