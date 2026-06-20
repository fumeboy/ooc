# OOC 对象激活生命周期：`active` / `unactive` 经引用计数

> 设计 spec（docs/ 工作稿）。日期 2026-06-21。
> 设计权威最终回流 `.ooc-world-meta/.../children/object/self.md`（对象模型）+ `children/thinkable/knowledge/thread.md`（thread 的 close/unactive）——见 §9。
> 状态：已与用户敲定核心方向；已过 4-lens 对抗 review（见 §10 修订记录），v1 已按 review 瘦身。**本稿只设计，不实现。** 一个决策点待用户拍板（§5，P1-3）。

## 1. 背景与问题

两条线索在同一处汇合：

1. **`close` 现状是一处半成品退潮。** `close` 同时是顶层 3 原语之一（`OOC_TOOLS=[exec,close,wait]`，`tools/close.ts`）**和** thread 的一个 object method（`thread/.../session-methods.ts`，经 readable 投影仅挂在 `talk`（other-view）窗 `object_methods:["say","close"]`，`readable/index.ts:99`）。两者行为分叉：原语 `handleCloseTool` 只移除窗 + 级联关子窗，无 fork-archive 副作用；方法 `closeMethod` 条件性 `archiveForkChild`（关 fork 窗时把子线程标 paused），再 **fire-and-forget**（`void ctx.runtime?.close?.()`）委托原语移除。走原语就漏掉 pause 子线程。且与设计权威矛盾——`thread.md` §3 明写「`close` 是 tool 原语、**不是** thread object method」。

2. **系统早有一个 dead `destruct` 槽等着这次设计。** `contract.ts:192` 定义了 `ObjectDestructor`，`ooc-class.ts:49` 有 `destruct?` 槽，但 `contract.ts:190` 自陈：「**暂仅接口定义**——runtime 何时调用 destruct（close 原语 / world 关停 / GC）的机制待实现」。旧 `onClose` hook 是 Wave-4 砍掉的「deferred 承重墙 hook」（`object-registry.ts:20`），只留了这个占位槽。

**核心洞察（用户提出）**：thread 的 close 逻辑本质对应 OOP 的对象析构，但 OOC 不需要「析构」——OOC object 是持久身份，不会被销毁。把这个 dead `destruct` 重新构想为：**`ContextWindow` 是对 object 的引用；`close` 移除一个引用；引用计数清空触发可选的生命周期函数 `unactive`（停用，不是销毁——磁盘身份留存）。** 用户进一步定下：refcount 在 **session 范围、非终态线程**内统计；且对称地应有 **`active`**。

于是这次工作既是**退潮**（删 `close` 方法 + 复用 dead `destruct` 槽 + 修正 `thread.md` §3），也是受控**涨潮**（补 `unactive` 派发机制）。**对抗 review 后 v1 涨潮面已收敛到真实 driver（fork-pause）的尺度**——见 §6/§10。

## 2. 生命周期模型

`OocClass` 上三个钩子，**全部可选**：

| 钩子 | 触发 | 基数 | v1 状态 | 典型 body |
|---|---|---|---|---|
| `construct` | 身份诞生（新实例） | 每身份**一次** | 已有 | 产出初始 data；一次性创建副作用 |
| `active`（新增，**v1 仅类型槽**） | session refcount **0 → 1** | 每次激活 | **v1 不接派发**（见 §6） | 获取可重获的运行时资源 |
| `unactive`（新增，复用 dead `destruct?`） | session refcount **1 → 0** | 每次停用 | v1 仅 thread 实现 | 释放运行时资源；**磁盘身份留存** |

- `construct` 一次（身份）；`active`/`unactive` 在对象一生中**重复**。
- **没有 `destruct`**——OOC object 是持久身份；「从磁盘删除」是另一件、不在本设计范围的事。
- **签名（对抗 review 修正，非「与 construct 完全同构」）**：生命周期钩子作用于**既有**对象、不产出 Data，故签名与 construct 不同。v1 定为 `exec(ctx)`，`ctx` 携带 `thread`（解引用发生处的线程）+ `targetId`（refcount 变动的对象 id）+ `runtime`；**钩子 body 自行解析它要操作的对象**（见 §3.3）。这样 core 派发器保持泛型、不内嵌任何 class policy。

### 2.1 不变量：自引用不计数

一条 thread 自己的 self 门面窗 / creator 窗指向自身——**这种自引用不计入 refcount**（否则只要线程活着就恒 ≥1，`unactive` 永不触发）。refcount 只数**外部引用**。

### 2.2 paused 线程仍是 referrer

被 `unactive` 停用的 thread 状态变 `paused`，它**仍算它所持有引用的 referrer**（只有 `done`/`failed` 退出计数）。停用一条线程**不释放它持有的引用**——那是 phase-2（§6）。此条预防「为什么 unactive 没级联」的困惑。

## 3. 引用计数机制（core）

### 3.1 什么是「引用」（v1 = fork only）

`ContextWindow` 即对某 object 的引用。一个窗解析到它引用的对象 id（helper `referencedObjectId(window)`）。

**对抗 review 关键修正**：内存里的 `ContextWindow`（=`OocObjectInstance`，`ooc-class.ts:75-84`）**只有** `{id,class,parentObjectId,title,status,createdAt,data,win}`——**没有** `_ref`/`refObjectId`（那两字段只活在 `thread-context.json` 磁盘 entry，`flow-thread-context.ts:37`，hydrate 时被丢弃）。故 v1 `referencedObjectId` **只解析 fork**：

- **fork 子线程窗**（`isTalkLikeClass(class)` + `data.isForkWindow` + `data.targetThreadId` + `!isSelfThreadWindow(id)`）→ `targetThreadId`（被引用的子线程）。
- **其余一切**（self 门面窗 / peer 跨对象窗 / 独立成员窗 / root）→ `undefined`（v1 不派发 unactive）。

> 独立成员对象（filesystem/terminal）的生命周期推 **phase-2**：届时从真实标记（`win.isMemberWindow`，`context-window.ts:131`）+ `inst.id` 派生，并对照 `thinkable/context/init.ts` 的成员窗注入核验——**不**用 `_ref`（内存窗无此字段）。

### 3.2 session refcount（v1 = 内存树）

`refcount(targetId)` = session 内 status ∈ **{running, waiting, paused}**（非终态）的线程中，`referencedObjectId(W) === targetId` 的外部引用窗数。

- 终态 **{done, failed} 排除**（用户：「不包括 done」；`failed` 同属终态——见 §7 D1）。
- **对抗 review 修正：v1 只数内存线程树**（当前线程 + 沿 `_parentThreadRef` 的祖先 + 各自 `childThreads` 递归）。fork driver 全程在内存树内（`index.ts:99-105` 父 `childThreads` 持子 + `_parentThreadRef` 反链），无需盘扫。
- **session 全范围盘扫推 phase-2**：盘上线程的引用计数（路径 `flows/<sid>/objects/<nestedObjectPath>/threads/<tid>`，含 `children/` 嵌套——`common.ts:61-73`）形态复杂，v1 无消费者（唯一 unactive body=fork 全在内存），故不做。

### 3.3 派发（v1 = 仅 unactive，仅 close 触发）

`WindowManager` 是 per-thread；refcount 是 session 级；故新增一个 core 侧泛型模块 `object-lifecycle.ts`：

- `referencedObjectId(window)`（§3.1）。
- `countSessionReferences(ctxThread, targetId)`（§3.2，内存树）。
- `dispatchUnactiveIfZero(ctxThread, targetId, targetClass, registry)`：
  1. `hook = registry.resolveUnactive(targetClass)`；**无则直接 return（fast-path）**——成本（refcount 计算）只在「被解引用对象的 class 真声明了 unactive」时付，即 v1 仅 fork-close。
  2. `countSessionReferences > 0` 则 return。
  3. 否则 `hook.exec({ thread: ctxThread, targetId, runtime })`——**body 自解析目标**。core **不** import 任何 thread 符号、不 special-case `THREAD_CLASS_ID`。

thread 的 `unactive` body（在 thread builtin 内）用 `findChild(ctx.thread, ctx.targetId)` 定位子线程 → running/waiting 则置 paused。持久化沿用既有线程 save（worker tick 落盘，与旧 `archiveForkChild` 同——它也只置 status、不自持久化）。

**无重入守卫**（对抗 review：v1 唯一 unactive body 只置 status、不再 close 窗，无递归；重入留 phase-2 当出现会级联的 body 时再处理，方案 = 「级联前一次性算好目标」而非模块级 mutable Set）。

### 3.4 v1 派发边界：仅 intra-object fork

v1 的 unactive **只对 fork 子线程**派发（§3.1 referencedObjectId 只认 fork）。**不**对 peer 跨对象会话窗指向的对端线程派发——对端是独立对象、有自己的生命周期。这既是 review 确认的正确现状（peer-exclusion），也由 `referencedObjectId` 直接保证。

## 4. 改动面（v1）

| 层 | 改动 | 锚点 |
|---|---|---|
| executable 契约 | 删 `ObjectDestructor`；加 `ObjectLifecycleHook`（`exec(ctx)`，ctx 带 targetId） | `core/executable/contract.ts:192` |
| OocClass | `destruct?` → `active?`(仅声明) + `unactive?` | `core/runtime/ooc-class.ts:49` |
| registry | 加 `resolveActive`/`resolveUnactive`（照 `resolveConstructor` 的 `selfThenChain` 链解析，类内私有）；**register merge 块补 active/unactive 保留**（防增量 re-register 丢槽） | `core/runtime/object-registry.ts:117-165` |
| object-lifecycle | 新增泛型模块：`referencedObjectId` + `countSessionReferences`（内存树）+ `dispatchUnactiveIfZero`。**零 thread import** | 新文件 `core/runtime/object-lifecycle.ts` |
| close 原语 | 移除窗后：算 `referencedObjectId`，非空则 `dispatchUnactiveIfZero`。**不加 closable 守卫**（见 §5） | `core/executable/tools/close.ts` |
| **thread** | **删 `close` 方法**；加 `Class.unactive`（findChild→pause）；readable `talk` 投影去 `"close"` | `thread/.../session-methods.ts`、`index.ts`、`readable/index.ts:99` |
| thread builtin | `archiveForkChild` 逻辑并入 `unactive`（或保留供其调用） | `thread/.../talk-fork.ts:71` |

**不在 v1**：`active` 派发（仅留类型槽）；session 盘扫；`_ref` 成员对象 unactive；closable 守卫。

## 5. close 的不变量 —— 一个决策点待用户拍板（P1-3）

删 `close` 方法时：

1. **fork 子窗 close → 子线程 paused**：由 thread `unactive` 确定性接管（§3.3）。net 效果对 LLM 不变，但路径从「可绕过的方法」变「原语必经的派发」。✅ 本设计落地。

2. **creator / self 门面窗不可关 —— ⚠️ 这不是一个「现存不变量」，是一个行为反转，须你拍板。**
   对抗 review 查实：`tools.test.ts:99-112` 有具名测试「close 释放任意 window（含 creator——旧 onClose 拒绝 hook 已退役）」，断言关 creator 窗 `ok===true`。即**当前 close 原语故意允许关任何窗（含 creator）**，旧 reject hook 是 Wave-4 主动退役的。旧 `closeMethod` 路径的「不可关」只靠 readable 不 surface 方法表达，**从不挡原语**。
   - **方案 A（默认，本稿采用）**：v1 **不加** 原语级 closable 守卫——保持 close 原语「关任何窗」的退役后现状；creator 窗的「劝阻」仍只靠 readable 投影不 surface（与今天一致）。fork-pause 不需要这个守卫。
   - **方案 B**：若你要原语级禁止关 self/creator 窗，这是**新决策**（反转 Wave-4 退役），须显式改 `tools.test.ts:99-112` + 论证 creator-closable 为何是 bug，不作为本次重构隐形夹带。
   - **请拍板 A 还是 B。** 默认 A。

## 6. 范围与分期

- **v1 = `close` + 级联 `close` 触发 unactive；仅 fork 子线程；内存树 refcount。**
- **`active`**：v1 **仅在契约/OocClass 定义 `active?` 类型槽**（记录对称性），**不接派发、不动 call site**。理由（review P1-2）：v1 零 active body；强接 = 再造一个「预置无消费者」的死机制（正是被退役的 onClose 同形）。真正出现第一个 active body 时再 demand-driven 接，唯一正确 seam 是 `WindowManager.instantiate`（不是 exec.ts——OOC 无 open tool，`OOC_TOOLS=[exec,close,wait]`）。
- **phase 2**：① session 盘扫 refcount；② 独立成员对象（filesystem/terminal）的 unactive（从 `isMemberWindow` 派生）；③ thread→`done` 释放其持有引用（连带 unactive 被引对象，如孤儿 shell）——**与 `context.md` core-11「thread 终止钩子」方向重叠，须合并不另起**（§9）；④ `active` 派发；⑤ 重入守卫（当出现会级联的 unactive body）。
- v1 诚实缺口：仅被某条已 `done` 线程引用的对象，会留活到后续某次 `close` 重算才停用——最终一致、非永不泄漏。

## 7. 风险与待确认点

- **D1（待用户确认）**：`failed` 线程是否同 `done` 排除出 refcount？默认**排除**（终态、不会 resume）。
- **R1 过度机制化**：见 §8。对抗 review 已砍掉 disk-scan / active-dispatch / `_ref` 分支 / closable 守卫四处涨潮。
- **R2 fork self-exclusion 正确性**：子线程自己的 self 窗（`isSelfThreadWindow`）不计数（§2.1），故运行中的 fork 子线程在父关掉 fork 窗后 refcount 归 0。**须 characterization test 锁死**（§4 plan Phase 5）：删 closeMethod **前**先加「关 fork 窗 → 子 paused」当前行为测试，让重构是「验证等价」而非「断言等价」。
- **R3 register merge 丢槽**：`object-registry.ts:117-121` merge 块只显式保 construct/executable/readable/persistable；新槽须补保留行（§4）。
- **R4 sibling no-op close 方法**（待实现期核）：删 thread close 方法后，`exec(method="close")` 在 thread 上失败、在别的 class 上若有 no-op close 仍成功——实现期 grep 核有无其它 class 注册了 close object method，统一处置（删 no-op 或文档记保留理由），别让 thread 成孤例。
- **R5 对象模型权威听写锁定**：object self.md 核心 9 条逐条与用户敲定；新增「生命周期」核心项须走用户听写/grill，§9 标为**待用户敲定**、不自行落核心区。

## 8. 反过度机制化自检（对照用户标定的 bias）

- **不是新增维度 / 新子系统**：补全 `construct` 的镜像钩子，dead 槽已预留。
- **退潮 ≥ 涨潮**：删 1 撞名方法 + 1 dead 接口 + 1 处文档谎 + `archiveForkChild` 死路；净加 = 一个 lifecycle 钩子接口 + 一个**泛型** dispatch 函数（约 40 行）。对抗 review 已砍掉 disk-scan/active-dispatch/`_ref`/closable 四处投机面。
- **按需、无状态**：refcount 当场算（内存树），不建持久引用索引；fast-path 让成本只落在 fork-close。
- **可选、加性、零强制迁移**：现存 builtin 不动。
- **boundary 正交（已落实，非仅声称）**：`object-lifecycle.ts` 泛型、零 thread import；thread policy（findChild/pause）只在 thread builtin 的 unactive body。与 construct dispatch（`WindowManager.instantiate` 纯泛型）真正同构——**对抗 review 专门 verify 了这一点**（原稿曾在 core dispatcher 硬编 `THREAD_CLASS_ID`，已修）。

## 9. 文档回流目标（实现期落，不在本稿）

- `children/object/self.md`：核心增「对象生命周期 = construct（一次）/ active / unactive（按 refcount 0↔1，可选）；无 destruct」一项 —— **待用户听写敲定**（R5）。
- `children/thinkable/knowledge/thread.md` §3：close 改述为原语（**agent-facing 行为口吻**：「close 移除一个引用；关 fork 子线程窗会使该子线程暂停 paused，身份留存可再被引用」），**不写 refcount/dispatch/closable 机制词**（那些归 designer-facing self.md/spec；memory: agent-facing voice）。
- `children/thinkable/knowledge/context.md`：`context.md:139`「关窗清理钩子」与新 `unactive` 对账（关窗清理现 = class unactive）；`context.md:193` core-11「thread 终止钩子」与本 spec phase-2 ③ 交叉引用、合并方向。
- `children/readable/self.md:84` 退役表：加 `destruct`/`ObjectDestructor`（与 onClose 并列）。
- `core/executable/tools/close.ts` 头注：去掉「副作用由方法层自理」悬空说法，改指向 class `unactive` 钩子。
- `check:doc-drift` / `check-no-deprecated-symbols`：把退役符号 `destruct` / `ObjectDestructor` / thread `close` method / `archiveForkChild`（若删）加入扫描。

## 10. 对抗 review 修订记录（2026-06-21，4-lens grounded review）

原稿 → 本稿的实质修订（全部 grounded，详见 plan 自审 + review 产物）：

- **P0**：① `referencedObjectId` 的 `_ref` 分支删除——内存窗无 `_ref`/`refObjectId`（仅磁盘 entry 有），原分支永不匹配、配套单测是 false-green。v1 fork-only。② `registry.resolveClass()` 不存在——改用 `resolveConstructor` 同款 `selfThenChain` 链解析。③ disk-scan 路径形态错（漏 `objects/` 段 + `children/` 嵌套）→ 静默 no-op，连同整个 disk-scan 砍出 v1。
- **P1**：④ disk-scan 砍除，refcount 收敛内存树。⑤ `active` 派发不接，仅留类型槽。⑥ closable 守卫不加（是退役行为反转，升级为用户决策 §5）。⑦ core dispatcher 去 `THREAD_CLASS_ID` 分支 + 去 thread import，改 body 自解析（boundary 正交真正落实）。⑧ 删模块级 mutable `inFlight`（v1 无重入）。
- **P2**：⑨ register merge 补 active/unactive 保留。⑩ thread.md 回流用行为口吻。⑪ doc 回流补 context.md:139/193、readable/self.md:84。⑫ 删 closeMethod 前加 characterization test。⑬ spec 补「paused 仍计数」（§2.2）。⑭ R4 sibling no-op close 实现期核。
- **驳回**（review 自身或我守门判为无活问题）：thread dual-nature（无 bug，已被 ⑦ 覆盖）、cascade double-dispatch（phase-2 caveat 足够）、peer-exclusion（现状正确）、done/failed 处理（无 bug，D1 开放）。
