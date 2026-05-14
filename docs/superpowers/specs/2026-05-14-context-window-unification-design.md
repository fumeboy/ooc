# Context Window Unification Design

**日期：** 2026-05-14

## 目标

把当前彼此独立的 `ActiveForm`、`thread.windows`、`thread.inbox/outbox` + 由 `do/talk` 隐式派生的"子线程对话感知"统一到同一个抽象——**ContextWindow**——之下。

收益：

- LLM 只需理解一种"持续占 context 的实体"，而不是"form / window / inbox / outbox / 子线程"五个并列概念
- knowledge 渐进式披露规则在 root command 与 window-level command 上语法一致
- 5 原语（open/refine/submit/close/wait/compress）的语义在新模型下退化得更干净
- close 的释放语义（context + knowledge + 资源归属）在所有窗口上对齐
- 跨 window 类型的渲染、持久化、唤醒规则可以共用一套基础设施

## 术语

| 术语                    | 含义                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **window**            | 持续占 context 的实体；root / do\_window / talk\_window / program\_window / todo\_window / file\_window / knowledge\_window / **command\_exec** |
| **command**           | 挂在某个 window 上、LLM 可调用的动作（不是 object  method， 是 context window 的 method）                                                                   |
| **command exec form** | `type=command_exec` 的 window；调用某 command 时的临时 sub-window，承载 args 累积与 knowledge 渐进激活                                                      |
| **root window**       | 每个 thread 隐含的根 window；注册一组全局 command（约等于今天 `commands/` 目录）                                                                               |
| **C 规则**              | "open 时携带 args 即可触发自动 submit" 的协议级行为：当 `open(args)` 后该 command 的 `match(args)` 与 `match({})` 完全一致、且 `knowledge(args)` 没有追加任何新 entry，意味着这次 args 已经"无歧义、无新知识需披露"，open tool 会自动调一次 submit，省掉 LLM 一次往返。详见后文"C 规则的判定算法"。 |

## 模型骨架

### 一个 thread 持有的状态

```ts
type ThreadContext = {
  id: string;
  status: "running" | "waiting" | "done" | "failed" | "paused";
  events: ProcessEvent[];
  // 不变：
  parentThreadId?: string;
  creatorThreadId?: string;
  childThreadIds?: string[];
  childThreads?: Record<string, ThreadContext>;
  inbox?: ThreadMessage[];   // 底层数据，window 视图按 windowId 过滤
  outbox?: ThreadMessage[];  // 同上
  plan?: string;
  // 替换：
  contextWindows: ContextWindow[];   // 取代 activeForms + windows
  // 新增：
  threadLocalData?: Record<string, unknown>;  // program_window 跨 exec 的 ts/js 共享数据
  // 调度相关：status="waiting" 即表示该 thread 正等待 inbox 新消息；不再细分 waitingType
  // end 相关 / 持久化 / lastExecutedAt 不变
};
```

### ContextWindow 抽象

```ts
interface ContextWindow {
  id: string;             // 全局唯一稳定 ID
  type: WindowType;       // "root" | "command_exec" | "do" | "talk" | "program" | "todo" | "file" | "knowledge"
  parentWindowId?: string; // command_exec 总有 parent；其他类型默认为 root
  /**
   * LLM 可见的简短标题，**所有 window 类型必填**。
   *
   * 强制 title 的目的：context 渲染时每个 `<window>` 都能在不展开 sub-window / transcript / history
   * 的前提下，让 LLM 一眼看出"这个槽位在做什么"，避免 LLM 在多 window 并存时迷失。
   *
   * 来源：
   * - command_exec：`open` 时由 `title` 参数显式提供；缺失时由 command 名 + description 派生
   * - do_window / talk_window / program_window / todo_window：由触发命令的 args 提供（详见各类型）
   * - file_window / knowledge_window：默认取 path 末段，可被 args.title 覆盖
   * - root：thread 自身的标题（一般来自 thread.creator 给出的初始任务）
   */
  title: string;
  status: WindowStatus;   // 见各 type 的状态机
  createdAt: number;
  // type-specific data 通过 narrow 区分；下文每个 type 单独说
}
```

`thread.contextWindows` 是 flat 数组，层级关系通过 `parentWindowId` 表达。渲染时按层级折叠。

### 5 原语在新模型下的精确语义

```
open(parent_window_id?, command, args?, title?, description?)
  - 在 parent_window_id 下创建一个 type=command_exec 的 sub-window
  - parent_window_id 缺省 = root
  - command 必须是 parent window 注册的 command 名
  - 若 args 不为空：等价于 open + 立即 refine(args)
  - 自动 submit 规则：
      若 (open+args) 后 commandPaths 与 open(空 args) 时一致
      且 command.knowledge(args) 不再追加任何新 entry
      则自动触发 submit，无需 LLM 再发 submit tool call

refine(form_id, args)
  - 仅作用于 type=command_exec window
  - 累积 args、重算 commandPaths、重算 knowledge 激活
  - form.status 必须是 "open"

submit(form_id)
  - 仅作用于 type=command_exec window
  - status: open → executing → executed
  - command.exec(args) 跑完后写入 form.result
  - 若该 command 产物是新 window（do/talk/program/todo），新建 window 挂在 root 下
    （不挂在 form 内部；form 与产物是兄弟，互不依赖）
  - **executed && success 后该 command_exec form 自动从 contextWindows 移除**
    （LLM 不需要主动 close 成功 form；产物 window 已经独立挂在 root 下）
  - 失败时（command.exec 抛异常或显式返回失败）form 保留为 executed 状态、result 写错误信息，
    需要 LLM 显式 close 释放（这样 LLM 有机会读完报错再决策）

close(window_id)
  - 关闭任意 window
  - 级联：parent 关闭 → 所有 sub-window 强制关闭
  - 各 type 的 close 副作用见下方"各 window 类型详述"
  - 释放该 window 引入的 knowledge 引用计数

wait
  - 把当前 thread.status 置为 waiting
  - 唤醒条件：thread.inbox 收到任意新消息；scheduler 一律按 inbox 长度变化检查

compress
  - 不变（与 window 模型正交）
```

#### 等待语义的简化

旧实现中 `waitingType` 区分了 `explicit_wait` / `talk_sync` / `await_children` 三种"等待原因"。新模型下这三者本质相同——都是"等 thread.inbox 出现新消息"——所以 **`waitingType` 字段被取消**，scheduler 只看 `status === "waiting"`：

- 子线程结束时由系统向父 inbox 写一条 system 消息（"子线程 X 已完成 / failed"），父被唤醒
- talk 对端回复消息进 inbox，唤醒
- 任意外部事件以 inbox 形式投递，唤醒

scheduler 唤醒规则收敛为单条：`status === "waiting"` 且 inbox 在入眠后出现新消息 → 状态翻回 `running`。

## 各 window 类型详述

### root window

- 隐含存在，不在 `contextWindows` 数组里显式出现（或以哨兵记录）
- 注册的 command（≈今天 `commands/` 目录）：
  - `do`     → submit 后产生 `do_window`
  - `talk`   → submit 后产生 `talk_window`
  - `program`→ submit 后产生 `program_window`
  - `plan`   → 副作用，不产生 window
  - `end`    → 副作用，不产生 window
  - `todo`   → submit 后产生 `todo_window`（也常通过 C 规则在 open 时直接 submit）
  - `open_file` / `open_knowledge`（建议命名待定）→ 产生 `file_window` / `knowledge_window`
- close(root) 不存在；root 与 thread 同生命周期

#### 初始 creator 对话 window（必有）

每个 thread 启动时，系统**必须自动创建一个特殊的 do_window**，用于展示与该 thread creator 的对话过程：

- `id` 固定派生自 thread.id（如 `w_creator_${threadId}`），方便 LLM 引用
- `title` = 该 thread 的初始任务标题（来自 creator 给出的 fork msg 或外部 session 任务）
- `targetThreadId` = `thread.creatorThreadId`（root thread 的 creator 是外部 session，targetThreadId 用约定值如 `"__session__"`）
- 系统注入的初始任务消息直接以这个 window 的视角进 inbox/transcript，LLM 一打开 thread 就能看到"是谁让我做什么"
- LLM 通过该 window 注册的 `continue` command 向 creator 反馈进度 / 结果，而无需另起 talk_window
- 该 window **不可被 LLM `close`**——它代表 thread 与 creator 的恒在通道；只有 thread 自身 end 时才一并销毁

工程意义：消除"thread 创建后第一轮该看哪儿、向谁汇报"的歧义；所有 thread 都从同一个稳定锚点出发。

### do\_window

```ts
type DoWindow = ContextWindow & {
  type: "do";
  targetThreadId: string;   // fork 出的 child thread id
  topic: string;            // open do 时 description / msg 派生
};
```

- 创建：`open(root, "do")` → submit(args={msg, wait?, knowledge?, threadId?})
- 注册的 command：
  - `continue` (args: msg, wait?) — 写 child inbox + parent outbox + 记 inbox\_message\_arrived 事件；wait=true 则父进 await\_inbox
  - `wait` (args: 无) — 不发消息，仅父进 await\_inbox（等子线程下次回写消息）
  - `close` — **archive 语义（B=ii）**：标记 child thread 为 paused（若 running）或保持 done/failed 状态；window 释放
- 渲染：`<window type=do target_thread=...><transcript>` 内含按 targetThreadId 过滤的 inbox+outbox 消息时间线
- 持久化：do\_window 创建时同步派生 child 的 persistence ref（baseDir/sessionId/objectId 沿用父，threadId=childId），让 scheduler 落 child 的 thread.json
- 与初始 creator window 的关系：fork 出的 child thread 在它自己的视角下，会自动拥有"指向父 thread 的初始 creator do_window"作为锚点；父 thread 这边持有的"指向 child 的 do_window"则是普通 do_window，可被 close（archive）

### talk\_window

```ts
type TalkWindow = ContextWindow & {
  type: "talk";
  target: "user";           // 本阶段唯一允许的 target
  conversationId: string;   // 同 target 多窗口时区分用，一般等于 windowId
  title: string;            // open 时强制要求
};
```

- 创建：`open(root, "talk")` → submit(args={target:"user", title, msg, wait?})
- **同 target 可多开**——LLM 可以并行维护多个对 user 的会话主题
- `title` 在 open 时由 args.title 提供；缺失时 C 规则不命中，knowledge 提示补 title
- 注册的 command：
  - `say` (args: msg, wait?) — 把消息写入 thread.outbox，标记 toThreadId="user", source="talk", windowId=本 window
  - `wait` — 父 thread 进 await\_inbox
  - `close` — 释放 window；不影响 user 端（user 端无对应运行实体）
- 渲染：`<window type=talk title=... target=user><transcript>` 按本 windowId 过滤 inbox+outbox
- user 回复路由：control plane 的 user-reply API 必须带 `target_window_id`（语义等同 talk.continue：user 选择回复到具体的 talk\_window）；消息进入 thread.inbox 时携带 `replyToWindowId` 字段，渲染时归入对应 window

### program\_window

```ts
type ProgramWindow = ContextWindow & {
  type: "program";
  history: ProgramExecRecord[];  // 仅渲染聚合，每次 exec 是独立 sandbox
};

type ProgramExecRecord = {
  execId: string;
  language: "shell" | "ts" | "js" | "function";
  code?: string;
  function?: string;
  args?: unknown;
  output: string;
  ok: boolean;
  startedAt: number;
};
```

- 创建：`open(root, "program")`
  - C 规则不命中（program 至少要 language+code 才能 exec）→ 必须 refine→submit 走完
- 注册的 command：
  - `exec` (args: language, code 或 function, args)
    - language=shell → 起独立 shell sandbox
    - language=ts/js → 起独立 ts/js sandbox；可读写 `thread.threadLocalData`（跨 exec 共享数据的唯一通道）
    - 含 function → 调 server 方法
    - 每次 submit 起新 sandbox，结果追加到 `history`
  - `inspect` (args: execId) — 当 result 被前序渲染截断时回看完整输出
  - `close` — 释放 window
- 渲染：`<window type=program><history>` 按时间倒序展示最近 N 条 exec 摘要 + 最新一条全文
- 跨 exec 数据传递：仅 ts/js 通过 `self.getThreadLocal(key)` / `self.setThreadLocal(key, value)` 写入 `thread.threadLocalData`；shell 之间不共享（OS 进程隔离），需要时由 LLM 自行写入 stone 目录

### todo\_window

- 创建：`open(root, "todo", args={content, on_command_path?})`
  - C 规则**总是命中**（无新 knowledge、match 已稳定）→ 自动 submit → 直接形成 todo\_window
- 没有需要 LLM 调用的 command；唯一动作是 `close`（待办完成）
- 渲染：`<window type=todo>` 显示 content + on\_command\_path 提醒条件
- 替换今天 fork 子线程时自动建 "处理初始消息" 的 todo form：新机制下子线程一旦创建就自带"指向父 thread 的初始 creator do_window"，初始任务消息直接进该 window 的 transcript，不再需要 todo 兜底

### file\_window / knowledge\_window

- 创建：`open(root, "open_file", args={path, lines?, columns?})` / `open(root, "open_knowledge", args={path})`
  - C 规则总是命中 → 直接形成 window
- 注册的 command：
  - `set_range` (file\_window only, args: lines, columns) — 调整可见范围
  - `reload` — 重新读
  - `close`
- 渲染：file\_window 显示路径 + 当前行/列范围 + 内容；knowledge\_window 显示 path + 全文
- 替代今天 `pinnedKnowledge` / `thread.windows` 字段

## inbox / outbox 在新模型下的归属

**保持底层不动**：`thread.inbox` / `thread.outbox` 仍是 thread 的 SSoT 字段，所有跨 thread 消息都先写到这里。

**window 是视图**：

- do\_window 渲染时按 `targetThreadId` 过滤
- talk\_window 渲染时按 `replyToWindowId / windowId` 过滤
- 没有任何 window 命中的 inbox 消息，仍以"系统兜底注入"形式作为顶层事件渲染（确保 LLM 不漏看）

**消息字段扩展**：

```ts
type ThreadMessage = {
  id: string;
  fromThreadId: string;
  toThreadId: string;
  content: string;
  createdAt: number;
  source: "do" | "system" | "talk";  // 新增 "talk"
  windowId?: string;       // talk: 来源/目标 window；do: child thread id 关联到 do_window
  replyToWindowId?: string; // user 回复时由 control plane 填
};
```

## C 规则的判定算法

```
op_open(parent, command, args, title?):
  form = create_command_exec_window(parent, command, title)
  baselinePaths     = command.match({})
  baselineKnowledge = command.knowledge({}, "open")
  if args is non-empty:
    apply_refine(form, args)
    nextPaths     = command.match(args)
    nextKnowledge = command.knowledge(args, "open")
    if isSuperset(nextPaths, baselinePaths) and isSubset(nextKnowledge.keys, baselineKnowledge.keys):
      submit(form)  // 走与 LLM 显式 submit 相同的路径
```

判定语义：

- **paths 允许 superset（next ⊇ baseline）**：args 给出新维度（如 `wait=true` 触发 `do.wait`）是 LLM 自己有意为之，不是协议层带来的"惊喜"——可以放行
- **knowledge keys 必须 subset（next ⊆ baseline）**：command 不能借机引入新协议知识，否则 LLM 没机会读到就被自动 submit
- **args 必须非空**：空 args = LLM 想先看 form 状态再决定下一步，不该自动 submit

实现位置：`src/executable/tools/open.ts`，集中处理；各 command 不需要感知"是否被自动 submit"。

## 渲染示例

```xml
<context_windows>
  <window id=w_do_1 type=do target_thread=t_child_1 status=running>
    <topic>处理日志告警</topic>
    <transcript>
      <msg from=t_root to=t_child_1 source=do>请检查 ERROR 日志</msg>
      <msg from=t_child_1 to=t_root source=do>已找到 3 处 ERROR</msg>
    </transcript>
    <sub_windows>
      <window id=f_cont_1 type=command_exec command=continue status=open>
        <accumulated_args>{"msg":"再检查 WARN"}</accumulated_args>
        <command_knowledge>...progressive...</command_knowledge>
      </window>
    </sub_windows>
  </window>

  <window id=w_talk_1 type=talk target=user title="发布计划确认" status=open>
    <transcript>
      <msg from=t_root to=user source=talk window=w_talk_1>明天发布可以吗？</msg>
    </transcript>
  </window>

  <window id=w_prog_1 type=program status=open>
    <history>
      <exec id=e_1 language=shell ok=true>find src -name *.ts | wc -l → 137</exec>
    </history>
  </window>

  <window id=w_todo_1 type=todo status=open>
    <content>补充集成测试</content>
    <on_command_path>["program", "program.function"]</on_command_path>
  </window>
</context_windows>
```

## close 与 knowledge 引用计数

每个 window 在 open / refine 时记录"我引入了哪些 knowledge path"。

释放时机：

- **command_exec form**：
  - 成功执行（status → executed 且 result 非失败）→ **系统自动从 contextWindows 移除**，无需 LLM 显式 close；同步释放该 form 引入的 knowledge 引用
  - 失败 → 保留 executed 状态、result 写错误信息，等 LLM 显式 `close` 释放
- **其他类型 window**：由 LLM 显式 `close` 触发，释放该 window 自身关联的 knowledge（如 do_window 的 do.* path、program_window 的 program.* path）
- **初始 creator do_window**：豁免，不可 close（见上文）

引用计数：同 path 在多 window 引用时按引用计数减 1，归零时才真正从 context 移除。

## 工程质量基线（实施时强制遵守）

本设计涉及多个 SSoT 字段重构，实施过程中必须坚持：

1. **代码逻辑简洁优雅**：避免在 reshape 阶段引入临时字段或双轨字段，老字段一次性改名 / 改语义；不允许"既留旧字段又加新字段"的并存写法。
2. **职责清晰**：`ContextWindow` 抽象本身不挂业务逻辑；各 window 类型的 command 注册、knowledge 派生、render、close 副作用各自独立模块，不相互引用。
3. **注释详尽**：
   - 每个 window 类型的接口、状态机过渡都要在源码顶部 docstring 写清楚
   - 任何"为什么这样设计而不是另一种"的非显然抉择（如初始 creator window 不可 close、form 成功自动移除、waitingType 取消、C 规则归属在 open tool）必须有注释指向本 spec 对应章节
4. **测试同步**：
   - 每个新 window 类型至少有"创建—活跃—释放"3 个生命周期单测
   - 老的 do/talk/program 集成测试不允许退化；ActiveForm reshape 后的兼容性必须靠测试守住
5. **不留 TODO 的实现**：本设计的每条 bullet 在 step 1 完成后都应能在源码或测试里找到落点；不允许 step 1 半完成、把"剩下的"写成 TODO 留给 step 2。
6. **renderer 和 protocol 不混合**：渲染层只负责把 `ContextWindow` 投影成 XML，不做状态机判断；状态机判断在 window registry。

## 迁移节奏

### Step 1（本次工作范围）

1. 引入 `ContextWindow` 类型 + flat `contextWindows` 数组，`title` 在所有 window 上必填
2. 把现有 `ActiveForm` reshape 成 `type=command_exec` 的 window，行为完全保留（`accumulatedArgs`/`commandPaths`/`loadedKnowledgePaths`/`status`/`result` 全部纳入），并落地"成功自动移除 / 失败保留待 close"两条规则
3. 把 `do` command 按新模型重写：submit 产出 `do_window`，注册 continue/wait/close 三个 command；child thread persistence ref 派生
4. **每个 thread 启动时自动建立"指向 creator 的 do_window"**（含 root thread 的特殊 creator 约定值）；fork 子线程时同步注入这个初始 window；移除老的"fork 自动建处理初始消息 todo form"逻辑
5. `todo` 升级为 `todo_window`：open 即建 window，无 submit 阶段（C 规则总命中）
6. `open` tool 实现 C 规则
7. 渲染层 `<context_windows>` 替换 `<active_forms>` / `<windows>`
8. **取消 `waitingType` 字段**，scheduler 仅看 `status === "waiting"` + inbox 新消息触发唤醒
9. 新单元测试覆盖：do_window 生命周期 / C 规则触发 / todo_window 直建 / 创建 thread 时 creator window 自动出现 / form 成功自动消失 / form 失败保留待 close / 取消 waitingType 后原 await_children 场景仍 PASS

### Step 2（后续迭代）

- talk 升级为 talk\_window（含 title 强制 / conversationId / control plane 的 user-reply 路由扩展）
- program 升级为 program\_window（exec/inspect/close + threadLocalData 通道）
- file/knowledge 升级为 file\_window / knowledge\_window（替换 thread.windows + pinnedKnowledge）
- inbox/outbox 渲染按 window 视图重写（Step 1 仍走旧顶层渲染兜底）
- 旧 5 原语在 LLM 协议层完全切到 ContextWindow 语义；废弃 ActiveForm 命名

### Step 3

- 移除老的 `activeForms` / `pinnedKnowledge` / `windows` 字段（含持久化迁移脚本）
- meta 文档全量更新（commands/ 目录文档 + actions 目录文档）
- 集成测试套件按 ContextWindow 视角重写

## 不在本设计范围内的事

- 跨 object 的 talk（仍按现状："多 object 不属于当前阶段"）
- 跨 thread knowledge 自动继承
- ContextWindow 自身的元编程（让 Object 自定义 window 类型）
- ContextWindow 在 web/client 侧的可视化

