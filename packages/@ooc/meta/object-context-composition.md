# OOC Object 的 Context 是如何组成的

> 文档位置：`packages/@ooc/meta/object-context-composition.md`
> 关联文档：`object.doc.ts`（概念权威，§thinkable.children.context）、`ooc-object-oriented-philosophy.md`（设计哲学 §2.2）
> 源码锚点：
> - `packages/@ooc/core/thinkable/context/index.ts`（ThreadContext 类型 + buildInputItems 入口）
> - `packages/@ooc/core/thinkable/context/render.ts`（XML context 渲染调度器）
> - `packages/@ooc/core/thinkable/knowledge/synthesizer.ts`（knowledge 合成 + peer Object 自动注入）
> - `packages/@ooc/core/thinkable/thinkloop.ts`（think 单轮：decay → budget → buildContext → LLM）
> - `packages/@ooc/core/executable/windows/_shared/types.ts`（ContextObject / OOCObject 类型定义）
> - `packages/@ooc/core/persistable/flow-thread-context.ts`（thread-context.json 持久化）

---

## 0. 一句话概括

**一个 OOC Object 在某一轮 LLM 思考时看到的 Context，是「它当前 thread 的对象引用表（`thread.contextWindows`）+ 每轮派生的合成窗口（knowledge / skills / peers）+ 身份 + 环境路径 + 过程事件历史」这五部分按顺序拼成的 LLM 输入。**

用面向对象的语言重述：
- **实例数据**：`ThreadContext` 对象（持久化在 `thread.json` + `thread-context.json`）
- **类级方法**：每轮 `buildInputItems(thread)` 把实例数据 + 派生数据渲染成 LLM 输入
- **Observer 是 LLM**：渲染产物是 XML system message + Responses-first items

---

## 1. 整体数据流：从 thread 到 LLM 输入

ThinkLoop 单轮的顺序（`thinkable/thinkloop.ts:think`）：

```
think(thread)
  │
  ├─ 1. processDecidedPermissionAsks          # 消费上一轮 HITL 审批决议
  ├─ 2. applyNaturalDecay(thread)              # 推进 _decayMeta 计数器，必要时切 compressLevel
  ├─ 3. applyEmergencyGuard(thread)            # token 估算超阈值则强制降级
  ├─ 4. buildInputItems(thread)                # ⭐ 构造 LLM 输入（本文主体）
  │     │
  │     ├─ 4a. collectExecutableKnowledgeEntries(contextWindows, thread)
  │     │     ├─ protocol entries（basic/root/reflectable/type-level/creator-reply/end-reflection）
  │     │     ├─ activator entries（stone seed + pool sediment，按 trigger 命中）
  │     │     ├─ skill_index window（branch + object + external skills）
  │     │     ├─ peer / children Object 自动注入
  │     │     └─ form knowledge（method_exec 的 knowledge() 派生）
  │     │
  │     ├─ 4b. renderContextXml(thread, enrichedWindows)  →  <context>...</context> XML
  │     ├─ 4c. loadSelfInstructions(thread)               →  instructions (self.md)
  │     ├─ 4d. buildPathsItem(thread)                     →  [ooc:paths] system message
  │     └─ 4e. processEventToItems(thread.events)         →  transcript messages
  │
  └─ 5. llmClient.generate(instructions, input, tools)    # 发起 LLM 调用
```

`buildInputItems` 返回的结构（Responses-first item 模型）：

```
{
  instructions?: string            // self.md 正文（Object 对内身份）
  input: LlmInputItem[]            // 顺序见下一节
}
```

---

## 2. LLM 输入的最终顺序

`buildInputItems` 产出的 `input` 数组按以下顺序排列（`thinkable/context/index.ts:buildInputItems`）：

| 位置 | 条目 | 来源 | 角色 |
|------|------|------|------|
| 1 | `<context>...</context>` XML | `renderContextXml` | **稳定状态层**：描述 Object 当前持有的全部世界快照 |
| 2 | `[ooc:paths]` system message | `buildPathsItem` | 环境路径锚点（world_root / stone_dir / flow_dir / thread_dir） |
| 3+ | transcript（过程事件） | `processEventToItems(thread.events)` | **过程事件层**：描述该 thread 经历过什么 |

其中第 1 项 `<context>` XML 是主体，内部结构见下一节。

两层严格分离（`object.doc.ts:thinkable.children.context`）：
- system prompt（XML + paths）表达「我现在拥有什么」
- transcript（messages）表达「我之前经历了什么」

---

## 3. `<context>` XML 的内部结构

渲染入口：`thinkable/context/render.ts:renderContextXml`。

```xml
<context>
  <self object_id="supervisor"/>              <!-- 3.1 self 标记 -->

  <thread id="t_xxx" status="running">
    <creator_thread_id>...</creator_thread_id>
    <parent_thread_id>...</parent_thread_id>

    <!-- context_windows: 所有当前打开的窗口（持久 + 每轮合成） -->
    <context_windows>
      <window id="root" type="root" status="active">...</window>
      <window id="w_talk_1" type="talk" status="open">...</window>
      <window id="w_plan_1" type="plan" status="open">...</window>
      <window id="kn_xxx" type="knowledge" status="open">...</window>
      <window id="skill_index" type="skill_index" status="active">...</window>
      <window id="agent_of_think" type="agent_of_think" status="open">...</window>
      ...
    </context_windows>

    <!-- 顶层 inbox/outbox：仅展示未被任何 talk/do window 收纳的兜底消息 -->
    <inbox>
      <message id="..."><from_thread_id/><to_thread_id/><content/><source/><created_at/></message>
    </inbox>
    <outbox>...</outbox>
  </thread>
</context>
```

### 3.1 `<self object_id="..."/>`

由 `renderSelfNodes` 输出。只暴露 `objectId` 标记，让 LLM 在顶部一眼知道「我是谁」。

详细的身份说明（`self.md` 正文）走 `instructions` 字段（LLM provider 的专门字段，权重高于 system message），不塞进 XML。

### 3.2 `<context_windows>` — context 的主体

这是 context 最核心的部分。每个 `<window>` 对应一个 **ContextObject**（Object 在当前 thread context 中的形态，详见 `executable/windows/_shared/types.ts`）。

每个 window 的通用结构：

```xml
<window id="w_file_abc" type="file" status="open">
  <title>packages/@ooc/core/thinkable/context/index.ts</title>

  <!-- ↓ 由 type 的 readable / renderXml / compressView 提供，type-specific -->
  <readable>...</readable>          <!-- 或 <compressed level="1"/> -->

  <!-- ↓ 该 window 上可调用的方法面（R2 #5 / #10） -->
  <methods hint="通过 exec(window_id=..., method=..., args={...}) 调用">
    <method name="set_viewport">set_viewport: 通过 exec(...) 调用</method>
    <method name="close">close: ...</method>
  </methods>

  <!-- ↓ 子 window 折叠（parentWindowId = 本 window.id 的那些） -->
  <sub_windows>
    <window id="f_xxx" type="method_exec" status="open">...</window>
  </sub_windows>
</window>
```

关键字段：
- `id`：稳定唯一 ID；root 固定为 `"root"`
- `type`：ObjectType（`file` / `plan` / `talk` / `todo` / 自定义 objectId 等）
- `status`：`open` / `running` / `active` / `archived` / `done` / `closed` / `executing` / `success` / `failed`
- `sharing` / `read_only`：跨 thread 共享状态（`ref` 只读引用 / `lent_out` 已借出）

### 3.3 顶层 `<inbox>` / `<outbox>`

渲染逻辑：先收集已被 talk/do window 收纳的消息 id，剩下的未被收纳的消息作为兜底展示在顶层，避免重复。

---

## 4. `<context_windows>` 的具体来源

contextWindows 并不是纯持久化数据。每轮渲染时，`collectExecutableKnowledgeEntries`（`thinkable/knowledge/synthesizer.ts`）会把持久化 window 与多组合成 window 拼接在一起。最终渲染的 window 列表包含以下六大来源：

### 4.1 持久化窗口（来自 thread-context.json）

这些是 `thread.contextWindows` 数组中持久化的窗口，由用户或 LLM 通过 exec / open 主动创建：

| 类型 | 说明 |
|------|------|
| `root` | 每个 thread 隐含的根 window，不可关闭 |
| `talk` | 与其他 Object / user 的对话窗口 |
| `do` | fork 子线程后的任务窗口 |
| `todo` | 待办 |
| `plan` | 计划 |
| `program` | 代码执行 REPL |
| `file` | 文件 |
| `knowledge`（source=`explicit`） | 用户通过 `open_knowledge` 显式打开的知识 |
| `search` | glob / grep 搜索结果 |
| `method_exec` | method 调用的渐进式表单 |
| `feishu_chat` / `feishu_doc` | 飞书扩展窗口 |
| 自定义 objectId | 用户 Stone Object（如 `agent_of_think`） |

持久化锚点：`packages/@ooc/core/persistable/flow-thread-context.ts` → `{baseDir}/flows/{sessionId}/{objectId}/threads/{threadId}/thread-context.json`。

持久化规则（state ≠ context 分离，P6.§6）：
- **内置特性**（talk / do / todo / method_exec）：完整 inline 存入 thread-context.json（它们没有独立 `state.json`）
- **独立 flow object**（plan / program / file / 自定义 Object）：只存轻量 ref `{ id, type, _ref: true, refObjectId }`，hydrate 时另读 `flows/<sid>/<refObjectId>/state.json`

### 4.2 Protocol Knowledge（source=`protocol`，合成）

每轮自动注入的全局知识窗口（source=`protocol`），来自代码常量：

| path | 内容 | 注入条件 |
|------|------|----------|
| `internal/basic` | 系统机制 / window 类型 / exec-close-wait 原语 / Skills 说明 / 跨 thread 共享协议 / 思考空间说明 | 每轮 |
| `internal/root/basic` | root method 清单与用法 | 每轮 |
| `internal/windows/<type>/basic` | 每种已出现 type 的基础命令说明（`def.basicKnowledge`） | 该 type 在 contextWindows 中出现 |
| `internal/reflectable/basic` | reflectable 反思协议知识 | `sessionId === "super"` |
| `internal/reflectable/metaprog` | 元编程 worktree 沙箱指引 | `sessionId === "super"` |
| `internal/windows/<type>/creator-reply/<window_id>` | 子→父 reply 协议（唯一合法回报通道是 creator window 的 continue / say） | thread 含 `isCreatorWindow=true` 的 do/talk window |
| `internal/end-reflection-reminder` | end 前提醒走 super flow 反思 | 业务 thread 开了 end form 且非 super session |
| `<form.method>/<form.status>` | 每个 method_exec form 派生的 knowledge() | form 存在且非 sharing |

代码锚点：`thinkable/knowledge/synthesizer.ts:collectExecutableKnowledgeEntries` 步骤 1 → 2。

### 4.3 Activator Knowledge（source=`activator`，合成）

基于 knowledge 文件 frontmatter 的 `activates_on` trigger map 渐进激活。来源双通道：

- **seed knowledge**：`stones/<branch>/objects/<self>/knowledge/*.md`（人类预置，进 git）
- **sediment knowledge**：`pools/<objectId>/knowledge/{memory,relations}/*.md`（运行时沉淀，不进 git）

trigger 格式：
```yaml
activates_on:
  "object::file": show_description      # 任意 file window open 时命中
  "method::root::program": show_content # root 上开 program form 时命中
  "object_id::agent_of_think": show_content  # 特定 objectId 出现时命中
  "super": show_content                 # 仅 super session 命中
```

多 trigger 命中取 `max(show_content > show_description)`；上限 20 篇。与显式 `open_knowledge` 同 path 时 activator 跳过（explicit 优先）。

代码锚点：
- `thinkable/knowledge/activator.ts:computeActivations`
- `thinkable/knowledge/triggers.ts:evaluateTrigger`

### 4.4 Skill Index（合成）

扫描三个目录，合并去重后若不为空则注入一个 `skill_index` window：

| scope | 路径 | 优先级 |
|-------|------|--------|
| external | `.world.json:externalSkillsDir` 指定目录 | 最低 |
| branch | `stones/<branch>/skills/<name>/SKILL.md` | 中 |
| object | `stones/<branch>/objects/<self>/skills/<name>/SKILL.md` | 最高（覆盖同名） |

代码锚点：`synthesizer.ts` 步骤 1.6。

### 4.5 Peer / Children Object 自动注入（合成）

Phase 6 替换原 `relation_window` 机制。peer OOC Object **本身**作为 context window 进入当前 Object 的 context，type = 其 `objectId`。

收集来源：
1. 从已有的 `talk_window(target=peerId)` 收集已交互过的 peer
2. 从 stone 层级结构自动收集默认可见的 **sibling** + 一级 **children**（`discoverStoneHierarchicalPeers`）

每个 peer window：
- `id = peerId`
- `type = peerId`（所以渲染会走 peer 自己的 readable / readme）
- `title` 取自 peer 的 readme frontmatter.title

系统会自动为每个 peer 从 stone 动态加载 window definition（executable/index.ts + methods + renderXml + readable）并注册到 registry，确保渲染不抛 "type not registered"。

代码锚点：`synthesizer.ts:derivePeerObjectWindows`（步骤 4）。

> 注：`relation_window` 机制（`deriveRelationWindow`）保留为 backward-compat，Phase 9 cleanup 移除。

### 4.6 Enrichment 字段（运行时派生，不持久化）

在合成过程中，每一个 window 都会被 enrichment：
- `effectiveVisibleType`：沿 `parentClass` 继承链回退到前端能渲染的首个 type（如 `my_custom_plan` → `plan`）。由 `resolveEffectiveVisibleType` 计算。
- `method_exec` 的 `methodKnowledgePaths`：按最新 form 状态重算派生知识的 key 列表。

这些字段运行时使用，`stripVolatileForPersist` 落盘前剥离。

---

## 5. 单 Window 的内容渲染链路

对一个 `<window>` 的具体内容渲染，优先级依次是（`render.ts:resolveObjectReadable` + `renderWindowNode`）：

### 5.1 compressLevel 分流

- `compressLevel >= 1`：优先走 `def.compressView(renderCtx, level)`；缺则输出 `<compressed level="N">` 通用占位
- `compressLevel = 0`（默认）：走 readable 渲染链路

### 5.2 Readable 解析（ooc-6 + P6.§7 parentClass 继承）

对自定义 Object type，按以下优先级找 readable（自身 type 先找；miss 后沿 parentClass 继承链逐个 ancestor 回退）：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `registry.def.readable` | builtin types 在注册时直接注入 |
| 2 | `ObjectWindowDefinition.readable` | stone 的 `executable/index.ts` 中 `export const window.readable` |
| 3 | stone 的 `readable.ts` | 动态渲染函数，可根据当前 thread state 决定输出 |
| 4 | stone 的 `readable.md` | 静态介绍文本 |
| 5 | stone 的 `readme.md` | 身份说明 fallback |
| 6 | `<readable source="placeholder">` | 整条链都 miss 的兜底 |

builtin types（root / talk / do / todo / file / knowledge / program / search / plan / skill_index / method_exec / feishu_chat / feishu_doc）走 `registry.def.readable` 或 `def.renderXml`，不读 stone。

### 5.3 methods 元数据

每个 window 末尾输出 `<methods>` 节点，列出该 type 上注册的所有 method 名 + 简要说明。压缩态 window 自动追加 `expand` method。

代码锚点：`xml.ts:renderMethodsNode`。

---

## 6. Context 的预算与压缩

Context 不是无限膨胀的。ThinkLoop 在 buildContext 之前和之中做了三层节制：

### 6.1 自然衰减（P0d，每轮 buildContext 前）

`applyNaturalDecay(thread)` 推进每个 window 的 `_decayMeta` 计数器，达到阈值时自动切 `compressLevel`：

| 规则 | 默认阈值 | 触发条件 |
|------|----------|----------|
| idle-fold | N=3 轮 | status ∈ {done, archived, closed} 持续 N 轮 |
| age-fold | M=10 轮 | 自上次 exec/close 起 M 轮无访问 |
| double-fold | K=8 轮 | compressLevel=1 再持续 K 轮 → 1→2 |
| cascade | — | parent 被 fold ≥1 时，所有 child 同档对齐 |

豁免：`root` 永远不衰减；`method_exec` 且 status ∈ {open, executing} 不衰减。

每次档位切换写一条 `context_compressed` ProcessEvent（LLM 可见）。

代码锚点：`thinkable/context/budget.ts`。

### 6.2 Emergency Guard（P0e，每轮 buildContext 前）

`applyEmergencyGuard(thread)` 估算当前 XML + transcript 的 token（粗估字符数），超阈值时：
- `soft`（默认 100K 字符）：给 LLM 一条 `<context_budget_warning>` system message，让 LLM 自行决定是否 compress
- `hard`（默认 180K 字符）：系统强制按 LRU 策略把 window 从 0→1→2，最后折叠 events

代码锚点：`thinkloop.ts:think` 步骤 3；`thinkable/context/budget.ts`。

### 6.3 Events 主动折叠（P0f）

LLM 可以显式调用 `compress(scope="events", target_event_ids=[...], summary="...")`，系统生成一条 `events_summary` ProcessEvent。被折叠的原 events 带 `_foldedBy` 标记，渲染层跳过（但数据仍保留在 `thread.events`）。

折叠后的 summary 以 `<context_change:events_summary>` system message 形式进入 transcript，替换原序列。

代码锚点：`context/index.ts:processEventToItems` 中 `events_summary` 分支。

---

## 7. Instructions、Paths 与 Transcript

除 XML context 之外，LLM 输入还有三块独立信息：

### 7.1 Instructions（self.md）

由 `loadSelfInstructions` 读取 stone 中的 `self.md`，作为 LLM provider 的 `instructions` 顶层字段（权重高于 system message）。

- 描述 Object 的对内身份（目标、风格、行为偏好）
- 与 XML 中 `<self object_id/>` 的对外标记互补
- `self.md` 不存在 / 空 / 内存模式 → 不注入

### 7.2 `[ooc:paths]` System Message

由 `buildPathsItem` 每轮注入，包含：
```
[ooc:paths]
world_root: /path/to/world
object_id: supervisor
object_stone_dir: /path/to/world/stones/ooc-6/objects/supervisor
object_flow_dir:  /path/to/world/flows/s_abc/supervisor
session_id: s_abc
current_thread_id: t_xyz
current_thread_dir: /path/to/world/flows/s_abc/supervisor/threads/t_xyz
```

用途：元编程动作（写 stone / 写 server method / 写 knowledge）能落到正确路径。

### 7.3 Transcript（过程事件）

`thread.events` 经 `processEventToItems` 逐事件转换成 Responses-first items：

| ProcessEvent kind | 输出 item |
|-------------------|-----------|
| `llm_interaction.text` | `{ role: "assistant", content }` |
| `llm_interaction.function_call` | `{ type: "function_call", call_id, name, arguments }` |
| `tool_runtime.function_call_output` | `{ type: "function_call_output", call_id, name, output }` |
| `context_change.inject` | `{ role: "system", content: "[context_change:inject]\n<text>" }` |
| `context_change.inbox_message_arrived` | `{ role: "system", content: "[context_change:inbox_message_arrived] ...\n<body>" }` |
| `context_change.context_compressed` | system message（LLM 可见档位变化） |
| `context_change.scheduler_yielded` | system message（worker 切片提醒） |
| `context_change.events_summary` | system message（折叠摘要占位，替换原 events） |
| `permission.permission_ask` | system message（pending / approved / rejected 三态） |
| `permission.permission_denied` | system message（拒绝提示） |
| `llm_interaction.thinking` | **不进 transcript**（只记录，不复喂） |
| `llm_interaction.call_started` | **不进 transcript**（recovery 磁盘锚点） |
| `llm_interaction.tool_use` | **不进 transcript**（旧格式，被 function_call 替代） |

带 `_foldedBy` 标记的 event 被跳过（其位置由 events_summary 占位）。

---

## 8. ThreadContext 数据结构一览

`thinkable/context/index.ts:ThreadContext` 是所有渲染的输入源：

| 字段 | 说明 |
|------|------|
| `id` | thread 唯一标识 |
| `status` | running / waiting / done / failed / paused |
| `events` | ProcessEvent[]，过程事件流 |
| `contextWindows` | ContextObject[]，当前持有的全部窗口（不含合成 knowledge/skills/peers） |
| `inbox` / `outbox` | ThreadMessage[]，协作消息 |
| `parentThreadId` / `creatorThreadId` / `creatorObjectId` / `creatorSessionId` | Thread Tree 拓扑 |
| `childThreadIds` / `childThreads` | 子线程表 |
| `threadLocalData` | program exec 之间传值用 |
| `endReason` / `endSummary` / `statusReason` / `lastError` | 终态信息 |
| `llmTimeoutMs` | 任务级 LLM 超时覆盖 |
| `lastExecutedAt` / `inboxSnapshotAtWait` / `waitingOn` | 调度器辅助字段 |
| `persistence` | ThreadPersistenceRef（baseDir / sessionId / objectId / threadId），缺 = 内存模式 |

---

## 9. Context = 视角（Point-of-View），不是归属

设计哲学层面的关键洞见（`ooc-object-oriented-philosophy.md` §2.2）：

> **Context 不是一个归属（belongs-to），而是一个视角（point-of-view）。**

这意味着：
1. 同一个 Object（如一场跨 Agent 的 talk）可以同时出现在多个 thread 的 context 中
2. 每个 thread 对它有自己的视角参数（`compressLevel`、`_decayMeta`、`sharing` snapshot）
3. Object 本身的状态只存一份（在 `flows/<sid>/<oid>/state.json`），context 只持有引用
4. `thread-context.json` 就是 OOC 的「指针表」

工程上这就是为什么独立 flow object 在 thread-context.json 中只存 `{ _ref: true, refObjectId }` 而不是 inline 整个 state——引用语义，和 OO 世界中对象的指针完全对应。

---

## 10. 关键约束 / 不变量

1. **silent-swallow ban**：任何上下文变化（压缩、审批拒绝、inject 提醒等）必须对 LLM 可见；不能静默吞掉。
2. **thinking 不复喂**：LLM 的 reasoning 只记录不回灌，避免 meta-thinking 和 transcript 膨胀。
3. **call_started 不落 transcript**：只作为 crash recovery 的磁盘锚点。
4. **state ≠ context 分离**（P6.§6）：Object 自身状态（跨线程共享）存在 `state.json`；Thread 视角存在 `thread-context.json`。两者互不嵌套。
5. **volatile 字段不持久化**：`_decayMeta`、`_parentThreadRef`、`_foldedBy`（保留）、`effectiveVisibleType` 等运行时辅助字段，落盘前由 `stripVolatileForPersist` 剥离（`_foldedBy` 除外——它是 fold 状态的唯一持久化锚点）。
6. **peer Object 动态注册**：自定义 Object type（self / peers）在渲染前由 `ensureSelfObjectTypeRegistered` / `derivePeerObjectWindows` 从 stone 动态加载并注册到 WindowRegistry，idempotent。
7. **knowledge 双源扫描**：stone seed + pool sediment 统一激活协议；同名冲突 sediment 胜出（运行时沉淀覆盖设计时初始值）。
