# OOC-4 L5-6 设计：B 类 window 塌缩 + relation 删除 + registry 终结

**Date**: 2026-05-31
**Author**: Supervisor（Claude Code 主会话）
**Status**: Design spec — pending per-increment plans（执行分 B 类逐增量，建议各自 fresh 会话）
**Branch**: `ooc-4`
**Relation**: 落地伞 spec `docs/superpowers/specs/2026-05-30-ooc-4-incremental-object-unification-design.md` §5（A/B 分类与塌缩）/ §6（context 物理树）。前置 L2-L4.2c 已完成（原型链引擎 + A 类全上链 + 实现住 base）。

---

## §0 现状与目标（基于代码勘察）

**现状**：ooc-2 是完整的 **window-centric** 模型——talk/do/todo/plan **作为 ContextWindow 实例持久化在 `thread.contextWindows[]`**（随 thread.json 落盘）；relation **每轮 synthesizer 派生不落盘**。塌缩目标载体（talks/<peer>.jsonl、threads/<tid>/、todos.json、plan.md）**当前全不存在**；root 方法 talk/do 存在但**创建 window**，todo_add/plan_set **不存在**。

**目标**：把 5 个 B 类从「持久化 window」改为「**owner flow 字段（落文件）+ root 方法（写文件）+ 自视切片（ContextBuilder 每轮从文件渲染）**」；relation **删除**，改 siblings/children **自动注入**（各走自己 readable）；最终**删 per-type registry**。

**判据复述**（伞 spec §5）：实体（有自己数据/生命周期）→ 保留为 Object 原型（A 类，已 L4 处理）；**关系/状态（依附 owner）→ 塌缩为 owner 字段**（B 类，本层）。

---

## §1 塌缩总表（每 B 类：字段载体 / root 方法 / 自视切片）

| 旧 window | flow 字段载体（新建持久化） | root 方法（写文件） | 自视切片（ContextBuilder 从文件渲染） | 删除 |
|---|---|---|---|---|
| ~~todo~~ | `todos.json`（owner flow） | `todo_add/check/uncheck/remove/list` | 未完成 todos 列表 | todo_window type + renderTodoWindow |
| ~~plan~~ | `plan.md`（owner flow） | `plan_set/plan_update/plan_clear`（嵌套 step 待定，见 §4） | active plan 置顶 | plan_window type + 7 methods |
| ~~talk~~ | `talks/<peer>.jsonl`（owner flow，每 peer 一文件） | `talk(target, content)` 改为写 jsonl + 派送 | 最近 N 条 talks（按 peer 分组） | talk_window type + say/wait/close |
| ~~do~~ | `threads/<tid>/`（已部分存在：child thread；规整为 owner flow 字段） | `do(intent)` / `do_continue` / `do_close` | active child threads 列表 | do_window type + 5 methods |
| ~~relation~~ | 无（siblings/children 自动注入，各走 readable） | 无（read-only 自动派生） | siblings + stone children/ auto 注入 | relation_window type + deriveRelationWindow |

**注**：B 类切片是 owner 的**自视**（自己 context 看自己的状态），由 ContextBuilder 渲染，**不走 readable**（readable 只渲染出现在他者 context 中的对外脸）。

---

## §2 核心新机制：自视切片（self-view slice）

当前 context 组装：`thread.contextWindows[]`（含 A 类 + B 类 window）→ 每个 window 经 renderXml/链解析渲染。塌缩后：

- **A 类**（program/search/file/...）仍是 context 里的 window（运行时对象，L7 落 context/ 物理树）。
- **B 类不再是 window**——ContextBuilder 每轮额外从 owner flow 文件渲染**自视切片**（todos.json→todo 切片、plan.md→plan 切片、talks/→talk 切片、threads/→active-do 切片），拼进 `<context>` 的固定区（如 `<self_view>` 段），与 A 类 window 区并列。
- **relation 切片** = siblings + stone children/ 自动注入（discoverStoneHierarchicalPeers 已有），各 peer 走自己的 readable() 输出（L1 后半 readable.ts；当前 readable.md）。

**新增组件**：`ContextBuilder.renderSelfView(thread)` —— 读 owner flow 文件（todos.json/plan.md/talks/<peer>.jsonl/active threads）+ 发现 siblings/children，渲染成自视 XML 段。替代当前散在 synthesizer 的 deriveRelationWindow + B 类 window 的 renderXml。

---

## §3 do ↔ scheduler 解耦（最难，单列增量）

**现状**：child thread 作 `parent.childThreads[childId]` 树节点，scheduler（scheduler.ts）`collectRunningThreads` 扫树、`emitChildEndNotifications` 遍历 childThreads、`wakeWaitingThreadsOnInbox` 按 inbox 唤醒；do_window（父侧）+ creator do_window（子侧）是双向消息通道。

**塌缩**：do_window 不再是 window，但 **child thread 生命周期 + scheduler 耦合保留**（它是真实并发模型，不是「关系/状态字段」那么简单）。塌缩 do 的精确语义：
- `do(intent)` 仍 fork child thread（threads/<tid>/，规整持久化）；不再创建父侧 do_window，改为父的**自视切片「active child threads」**从 threads/ 渲染。
- `do_continue(tid, msg)` / `do_close(tid)` 作 root 方法（替代 do_window.continue/close），操作 threads/<tid>/。
- scheduler 的树遍历**基本不变**（child thread 树仍在）；改动面是「父怎么看到 child」——从 do_window renderXml 改为自视切片渲染 threads/ 的 active 列表。
- **关键风险**：do_window 当前还承载「父子双向 transcript 渲染 + viewport + share_windows」。塌缩须保证这些经自视切片/threads 持久化等价复现。**do 是 5 个 B 类里唯一深耦合并发模型的，建议最后做、单独增量、重 e2e（do-thread-tree/do-fork-and-collect/scheduler 测试全过）**。

---

## §4 各 B 类塌缩要点 + 开放问题

### todo（最简，先做）
- `todos.json`：`[{id, content, done, on_command_path?}]`（owner flow，复用 flow-data 或新 persistable helper）。
- root 方法：`todo_add(content, on_command_path?)` / `todo_check(id)` / `todo_uncheck(id)` / `todo_remove(id)` / `todo_list`。
- 自视切片：未完成 todos（+ on_command_path 命中时强提醒，复用现 renderTodoWindow 的 on_command_path 语义）。
- 删 todo_window type。**开放**：on_command_path「执行特定 method 时强提醒」如何在自视切片+method dispatch 时触发（现靠 window 在场；塌缩后靠 ContextBuilder 检查 todos.json）。

### plan（次简）
- `plan.md`：active plan 文本（描述 + steps）。**开放（重要）**：当前 plan_window 支持嵌套 sub-plan（expand_step → sub plan_window，parentPlanWindowId 软链）+ 7 个 method（add_step/update_step/expand_step/collapse_subplan/mark_done）。塌缩成单一 plan.md 是否保留嵌套？建议 **MVP：扁平 plan.md（plan_set 全量设置 + plan_update + plan_clear），嵌套 sub-plan 降级/延后**（嵌套是低频高复杂，YAGNI 评估）。
- 自视切片：active plan 置顶。删 plan_window type + 7 methods。

### talk（中）
- `talks/<peer>.jsonl`：每 peer 一文件，append 消息行。root `talk(target, content)` 改为 append jsonl + 派送（复用现 talk-delivery）。
- 自视切片：最近 N 条 talks（按 peer 分组）。删 talk_window type + say/wait/close。**开放**：talk 的 wait 语义（父进入 waiting 等 peer 回复）怎么在无 window 下表达——可能复用 do 的 waiting/inbox 唤醒机制（talk 与 do 共享并发原语？）。creator-window-不可关闭语义消失（无 window）。
- **开放**：talk 与 do 的并发模型关系——talk（peer 平等）vs do（parent-child）都涉及「派消息 + 等回复 + 唤醒」，塌缩后是否归一到一套 thread 消息原语。

### relation（删除，改 auto 注入）
- 删 relation_window type + deriveRelationWindow（synthesizer.ts:330-442）。
- siblings + stone children/（discoverStoneHierarchicalPeers）自动注入 context，各走自己 readable()。pool 长期 relations 知识（pools/.../knowledge/relations/<peer>.md）合并进自视 relations 切片。
- relation.edit（写 relations 文件）→ 改为普通 write_file（agent 写 pools/.../knowledge/relations/<peer>.md）。**开放**：现 relation.edit 的 scope=session/long_term + 写 long_term 时派 talk 给 super 的语义，塌缩后如何保留。

### do（最难，最后做，见 §3）

---

## §5 registry 终结（L6 尾）

B 类塌缩后 registry 剩：command_exec / custom / root / feishu_chat / feishu_doc + A 类薄壳（仅 onClose/compressView/mark）。删 registry 的前提：
- onClose/compressView 也沿链解析（当前 L4 排除项）——需把这两个 aspect 也接 behavior.ts（resolveOnClose/resolveCompressView）。
- command_exec：form 机制内联（refine/submit 是 manager API，不需 type registry 持有，可改 manager 内联识别）。
- custom：吸收为 prototype 链特例（custom window prototype = object canonical id；当前无消费者，届时若有 world 对象声明 extends 再做）。
- feishu_*：extendable 插件，改为 base proto 或独立注册机制。
- root：成 base/root/ 原型（收编通用方法 + B 类塌缩后的 root 方法 talk/do/todo/plan）。

删 `getWindowTypeDefinition` + `WindowRegistry` + `assertAllRenderHooksRegistered`（chain 全覆盖后）。

---

## §6 持久化迁移（不可忽视）

现有 thread.json 的 `contextWindows[]` 含已持久化的 talk/do/todo/plan window。塌缩后这些不再是 window。**dev 分支 world 可重生**（gitignored 运行时数据），但：
- 加载旧 thread.json 时含 B 类 window → 需迁移（读出转成 flow 文件）或 fail-loud（dev 可接受重生）。
- 建议：**fail-loud + 文档说明 world 重生**（与 L4.0 loader 硬切同哲学），不写复杂迁移器（YAGNI，无生产数据）。

---

## §7 分解（执行顺序，按风险升序；每增量 plan→对抗 review→执行→harness 回归）

| 增量 | 内容 | 风险 | gate |
|---|---|---|---|
| L5a | **自视切片机制**（ContextBuilder.renderSelfView 骨架 + `<self_view>` 段）+ **todo 塌缩**（todos.json + root.todo_* + 切片 + 删 todo_window） | 中（动 context 组装，但 todo 最简） | todo 落盘 + 自视注入 e2e；现 todo 测试迁移 |
| L5b | **plan 塌缩**（plan.md + root.plan_* + 切片 + 删 plan_window；MVP 扁平） | 中 | plan 落盘 + 自视 e2e |
| L5c | **talk 塌缩**（talks/<peer>.jsonl + root.talk 改写 + 切片 + 删 talk_window） | 中高（跨 object 派送 + wait 语义） | talk 落盘 + 跨 object e2e |
| L6a | **relation 删除**（删 type + deriveRelationWindow；siblings/children auto 注入走 readable） | 中 | relations 切片 e2e |
| L6b | **do 塌缩**（threads/ 规整 + root.do_* + active 切片 + 删 do_window；保 scheduler 耦合） | **高**（并发模型核心） | do-thread-tree + do-fork-and-collect + scheduler 测试全过 |
| L6c | **registry 终结**（onClose/compressView 接链 + command_exec/custom/feishu/root 收编 + 删 getWindowTypeDefinition） | 高 | 全 harness + 启动 |

每增量独立 commit、bun test 绿、可回滚。**强烈建议各自 fresh 会话**（深核心循环改动不在长上下文做——项目纪律 [[project_ooc4_direction_increment1]]）。

---

## §8 不变量与测试 gate

1. B 类塌缩落盘：todo_add→todos.json；plan_set→plan.md；talk→talks/<peer>.jsonl；do→threads/<tid>/。下轮自视切片注入。
2. 自视 vs 对外边界：B 类切片是 owner 自视（ContextBuilder 渲染），不走 readable。
3. relation 删除：siblings + children auto 注入，各走自己 readable。
4. do 并发模型不破：fork/continue/close/wait + scheduler 唤醒/child-end 通知全过。
5. registry 删除：getWindowTypeDefinition 无残留消费者。
6. 持久化：旧 thread.json B 类 window fail-loud（world 重生，dev 可接受）。
7. bun test src/ 全绿 + tsc 0 + route-audit + 各 B 类 e2e。

---

## §9 meta 文档更新（落地后）

`object.doc.ts:ooc4_object_model.children.ab_classification`（B 类塌缩 todo→已落地）+ `context_tree`（自视切片）；`engineering.testing.doc.ts`（B 类塌缩 e2e）；`cookbook.add-new-agent.doc.ts`（B 类不再是 window）。每改 .doc.ts 立刻 tsc。
