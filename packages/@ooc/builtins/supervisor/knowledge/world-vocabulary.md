---
title: World 系统术语权威表
description: ContextWindow / 持久层 / 维度 / 协议 / 状态相关的所有专有术语单点定义
activates_on:
  "window::root": "show_content"
---

# World 系统术语

我在其它知识文件、命令调用、错误信息中遇到的所有专有术语，这里给出**单点权威定义**。
其它文件不重复释义，直接以这里的语义使用。

---

## 1. ContextWindow 家族

我看到的"上下文"是一组 **ContextWindow** 对象的集合。每个 Window 既是信息展示单元，
也是可调用 `command` 的交互对象。打开新 Window 用 `open(type="<kind>", ...)`。

| Window kind | 用途 | 关键参数 |
|---|---|---|
| **talk** | 跨 Object 双向消息流；每条消息一个 turn | `target`（对方 objectId）+ `initial_text` |
| **do** | 派生子 thread 处理任务；子 thread 跑完会把结果交回 | `instruction`、可选 `share_windows`（让子线程复用父线程的某些 Window） |
| **program** | 调用某个 Object 的 server method（详见下文 §3） | `target`、`method`、`args` |
| **relation** | 读对方 Object 对自己的认知（readable + sediment 中的 relation 文件）；只读 | `target` |
| **command** | 调用全局命令（metaprog / write_file 等） | `command`、`args` |
| **file** | 读 / 写 / 浏览 World 文件 | `path` |

每个 Window 都有命令集：通用的 `open` / `refine` / `submit` / `close` / `wait`，
加上 Window 特定的 command（例如 talk 上有 `say`）。

我每轮思考都看到所有 Window 的当前状态。

### share_windows

`do` Window 可以传 `share_windows: ["<windowId>", ...]`，让派生出的子 thread 也看到这些
父 Window —— 用于把上下文（如某个 talk 或 file Window）下传给子任务，避免重复装填。

---

## 2. 持久层（四分：Builtin / Stone / Pool / Flow）

完整版见 `three-fold-persistence.md`。一句话总览：

| 层 | 路径前缀 | 性质 | 进 git？ |
|---|---|---|---|
| **Builtin** | `packages/@ooc/builtins/<id>/`（源码仓） | 运行时自带定义（supervisor、user 等）；不可被 Agent 改写 | ✓（随代码发布） |
| **Stone** | `packages/<id>/`（world 内） | 用户/Agent 创建 Object 的设计层（身份 + 源码 + schema + seed knowledge） | ✓ |
| **Pool**  | `pools/<id>/` | 事实层（data csv + sediment knowledge + files） | ✗ |
| **Flow**  | `flows/<sessionId>/` | 运行层（thread / session_data / 临时 relation） | ✗ |

`supervisor` 和 `user` 是 **Builtin Object**：定义随 OOC runtime 发布，不写 world 的
`packages/`；但它们和 Stone Object 一样有自己的 Pool（跨 session 沉淀）和 Flow（运行时实例）。

---

## 3. 维度相关术语

| 术语 | 定义 |
|---|---|
| **server method** | Object 在自己 stone 的 `executable/index.ts` 定义的一个函数。可被该 Object 自己的 LLM 通过 `program_window` 调用，也可被其 client 页面（`visible/index.tsx`）调用。是 Object 的"自身函数库"，programmable 维度的核心载体。 |
| **ui_method** | server method 的一种特例：由该 Object 的 visible tsx 调用，而非 LLM 调用。同样写在 `executable/`，承担前端 UI 与后端逻辑桥接（visible 维度）。 |
| **visible tsx** | Object 自己 stone 的 `visible/index.tsx`，渲染该 Object 的专属 UI 页面（visible 维度）。 |
| **seed knowledge** | 写在 stone/builtin 里的初始知识库 `<stone>/knowledge/<slug>.md`，Builtin 的 seed 进源码仓 review，Stone 的 seed 进 git review。每篇带 `activates_on` frontmatter（见下文）决定何时进 LLM 视野。 |
| **sediment knowledge** | 写在 pool 里的运行时长期记忆 `pools/<id>/knowledge/{memory,relations}/...`，不进 git。由 reflectable 维度通过 super flow 写入。 |
| **super flow** | 一种特殊的反思 thread：在普通业务 thread 之上做经验沉淀。**唯一**合法写 sediment knowledge 的入口（直接写文件被协议拒）。 |
| **activates_on** | seed / sediment knowledge 文件 frontmatter 中的字段，控制该篇何时被加入 LLM 视野。形态：`{ "<trigger>": "show_description" \| "show_content" }`。三类 trigger：`"window::<type>"`（任意 open 的该类 window 出现时命中；如 `"window::root"` 等价"任意线程都见"）/ `"command::<window_type>::<command>"`（某个 window 上正在开同名 command form 时命中）/ `"super"`（仅在 super flow 中命中）。多 trigger 命中取 max（show_content > show_description）。 |

---

## 4. 协议相关术语

### stone-versioning（stone 改动审计协议）

任何对 world 内 `packages/`（Stone）的写入都必经此流程，不能绕过。
**Builtin Object 不在此协议覆盖范围内**——Builtin 由 OOC 代码仓版本化，Agent 不能改写。

1. **open_worktree** — 拉一个临时 git worktree（独立分支 + 工作目录）给写者
2. 写者在 worktree 里改文件
3. **commit** — 把 worktree 改动落 commit 到那个临时分支
4. **merge** — 把临时分支并回 main：
   - **intra-scope**（改动只触及 `objects/<self>/` 自己的目录）→ 自动 fast-forward merge，立即生效
   - **cross-scope**（触及 `objects/<other>/`）→ 自动开 **PR-Issue** 待 supervisor 评审

### metaprog（操作 stone 的命令族）

通过 `open(type="command", command="metaprog", args={action:"<action>", ...})` 调用：

| action | 谁能调 | 用途 |
|---|---|---|
| `open_worktree` | 任何 Object | 开始一次 stone 改动，返回临时 branch + worktree path |
| `commit` | 任何 Object | 把 worktree 里 staged 改动落 commit |
| `merge` | 任何 Object | 尝试把临时分支合回 main；跨 scope 时返回 `{ok:true, kind:"must-pr-issue", issueId, paths}`，自动开 PR-Issue |
| `resolve` | **supervisor 专属** | 决议 PR-Issue（decision: `merge` / `reject` / `request-changes`） |
| `rollback` | **supervisor 专属** | 强制回滚 stone 历史到指定 commit |
| `create_object` | **supervisor 专属** | 一次性原子落盘新 Object 骨架（self/readable/knowledge）+ commit on main |

### PR-Issue（跨自治区改动审阅 Issue）

跨 scope 改动会自动产生一条特殊 Issue，含：
- `prPayload.intent`：发起者描述的改动意图（commit message 同源）
- `prPayload.branch`：临时分支名
- `prPayload.diff`：改动 diff（unified format）
- `prPayload.paths`：受影响的文件路径列表
- `prPayload.baseSha`：临时分支基线 commit sha

supervisor 读 diff → 调 `metaprog action="resolve"` 决议（args: `{ issueId, decision }`）：

| decision | 含义 |
|---|---|
| `merge` | 接受改动，临时分支并入 main |
| `reject` | 拒绝改动，临时分支抛弃，PR-Issue 关闭 |
| `request-changes` | 让发起者回去改；PR-Issue 留 open，发起者可继续 commit + 再次 merge |

supervisor 自己发起的跨 scope 改动也走同一流程（"自审 merge" 合法，git log 与 PR-Issue 链留下完整审计）。

### Builtin Object（运行时内置对象）

OOC runtime 自带的 Object 定义，位于 `packages/@ooc/builtins/<id>/`。当前包括：

- **supervisor**：我自己，OOC World 的总管与入口。
- **user**：真人用户的占位 Object，定义 `[[ui...ui]]` inline UI token 协议。
- **root / file / plan / todo / program / knowledge / search / skill_index**：内置 ContextWindow 类型 Object。

与 Stone Object 的区别：定义不可被 Agent 改写（由代码仓版本化），但 Pool 和 Flow 与 Stone Object 完全同构。

---

## 5. 运行状态相关术语

| 术语 | 定义 |
|---|---|
| **session** | 一次 World 的运行会话，有唯一 sessionId。所有 flow 数据落在 `flows/<sessionId>/` 下；session 结束后可归档或丢弃。 |
| **thread** | session 中的一条对话/任务链，有唯一 threadId。一个 Object 可以同时跑多条 thread（例如同时被多个用户找）。`root` 是该 Object 的常驻主线程 id。 |
| **inbox** | Object 收到但还未处理的跨 Object 消息队列（talk_window 推送 / do_window 子任务结果）。每轮思考自动可见。 |
| **events** | 系统级事件（Object stone 变更 / 错误），进 visibility 通道供我观察。 |
| **broken stone** | 启动期 recovery-check 发现的、`executable/index.ts` 加载失败的 Stone Object。系统自动开 `[recovery-needed]` PR-Issue 给我处理（决定回滚到哪个历史 commit / 或拒绝放行）。 |
| **recovery-check** | 启动期自检：遍历 `packages/*/executable/index.ts`（Stone Object），加载失败的 Object 走 broken stone 流程。Builtin Object 由代码仓版本保证、不走此流程。不阻塞启动，只产出 PR-Issue。 |
