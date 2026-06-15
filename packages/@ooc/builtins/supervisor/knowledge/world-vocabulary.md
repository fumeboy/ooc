---
title: World 系统术语权威表
description: ContextWindow / 持久层 / 维度 / 协议 / 状态相关的所有专有术语单点定义
activates_on:
  "object::root": "show_content"
---

# World 系统术语

我在其它知识文件、命令调用、错误信息中遇到的所有专有术语，这里给出**单点权威定义**。
其它文件不重复释义，直接以这里的语义使用。

---

## 1. ContextWindow 家族

我看到的"上下文"是一组 **ContextWindow** 对象的集合。每个 Window 既是信息展示单元，
也是可调用 `method` 的交互对象。

| Window kind | 用途 | 关键参数 |
|---|---|---|
| **talk** | 跨 Object 双向消息流；每条消息一个 turn。target=别的对象 ⇒ peer 会话（需 `title`）；target=自己 ⇒ fork 一条子线程处理任务（需 `msg`，可选 `wait` / `share_windows`），子 thread 跑完把结果交回 | `target`；peer 需 `title`，fork 需 `msg` |
| **program** | REPL 风格代码执行窗口（执行代码 / 调用方法），exec 历史保留 | `language`、`code` |
| **file** / **knowledge** | 把 World 文件 / 知识文档纳入 context | `path` |
| **method_exec** | 调用某个 method 时产生的临时 form；累积参数后提交 | 由 `exec` 自动产生 |
| **peer Object window** | 同 stone 的 sibling / level-1 children Object，**自动作为 first-class ContextWindow 注入到我的 contextWindows 中**，可直接 exec 其 object method | id = `<objectId>`，type = `<objectId>`，method 集合为该对象 `executable/index.ts` 中声明的 method |

method 按 Object/Agent/组合分布、不堆在一个 root window 上：agency（talk/plan/todo/end）在我的
**self 窗**（agent 基类 `_builtin/agent`）；工具方法在我持有的**成员对象窗**（filesystem 的
open_file/write_file/glob/grep、terminal 的 program、world 的 create_object、knowledge_base 的
open_knowledge）。没有单独的"command 窗口"。

作用在 window 上的稳定 tool 原语共 **3 个**（`OOC_TOOLS`）：`exec`（在某 window 上调一条 method，
缺省 window = 我自己的 self 窗）/ `close` / `wait`。`compress`（折叠窗口 / 事件流以省 token）与 `expand`
不是原语，而是**经 exec 调用的通用展示方法**（`exec(method="compress", args={scope,...})`），与 file 窗的
set_viewport 同类。`method_exec` form 上另有 `refine` / `submit`（同样经 exec 调用）累积并提交参数。各
window 还有自己的 method（例如 talk 上有 `say`，peer Object window 上就是它声明的 object method）。

> **peer exec vs talk 的边界**：
> - 同 stone peer（我身边的 sibling / children）：默认直接 `exec(window_id="<objectId>", method="...")`
> - 跨 session / 需要对方独立思考 / 跨 stone 跨 world 对象：`exec(method="talk", args={ target: "...", title: "..." })` 开 talk_window
> - 不要拿 peer window id 做 talk——那是把"直接调用"错当成"发消息给远方同事"，链路多 2 跳。

我每轮思考都看到所有 Window 的当前状态。

### share_windows

`talk(target=自己)` fork 子线程时可以传 `share_windows: [{ window_id, mode }, ...]`，让派生出的子 thread 也看到这些
父 Window —— 用于把上下文（如某个 file Window）下传给子任务，避免重复装填。

---

## 2. 持久层（四分：Builtin / Stone / Pool / Flow）

完整版见 `three-fold-persistence.md`。一句话总览：

| 层 | 路径前缀 | 性质 | 进 git？ |
|---|---|---|---|
| **Builtin** | `packages/@ooc/builtins/<id>/`（源码仓） | 运行时自带定义（supervisor、user 等）；不可被 Agent 改写 | ✓（随代码发布） |
| **Stone** | `stones/main/objects/<id>/`（world 内） | 用户/Agent 创建 Object 的设计层（身份 + 源码 + schema + seed knowledge）；git 版本化 | ✓ |
| **Pool**  | `pools/<id>/` | 事实层（data csv + sediment knowledge + files） | ✗ |
| **Flow**  | `flows/<sessionId>/` | 运行层（thread / session_data / 临时 relation） | ✗ |

`supervisor` 和 `user` 是 **Builtin Object**：定义随 OOC runtime 发布，不写 world 的
`stones/`；但它们和 Stone Object 一样有自己的 Pool（跨 session 沉淀）和 Flow（运行时实例）。

---

## 3. 维度相关术语

| 术语 | 定义 |
|---|---|
| **object method** | Object 在自己 stone 的 `executable/index.ts` 定义、经 `registerExecutable` 注册的一个方法，操作对象数据。该 Object 自己的 LLM 经 `exec`（在 peer window 上或 method_exec form 里）调用。是 Object 的"自身方法库"，programmable 维度的核心载体。 |
| **window method** | 由 Object 的 readable 模块经 `registerReadable` 注册、只控某 window 怎样展示（与操作数据的 object method 并列）。 |
| **ui_method** | object method 的一种特例：由该 Object 的 visible tsx 经 HTTP 调用，而非 LLM 调用。同样写在 `executable/`，承担前端 UI 与后端逻辑桥接（visible 维度）。 |
| **visible tsx** | Object 自己 stone 的 `visible/index.tsx`，渲染该 Object 的专属 UI 页面（visible 维度）。 |
| **seed knowledge** | 写在 stone/builtin 里的初始知识库 `<stone>/knowledge/<slug>.md`，Builtin 的 seed 进源码仓 review，Stone 的 seed 进 git review。每篇带 `activates_on` frontmatter（见下文）决定何时进 LLM 视野。 |
| **sediment knowledge** | 写在 pool 里的运行时长期记忆 `pools/<id>/knowledge/{memory,relations}/...`，不进 git。由 reflectable 维度通过 super flow 写入。 |
| **super flow** | 一种特殊的反思 thread：在普通业务 thread 之上做经验沉淀。**唯一**合法写 sediment knowledge 的入口（直接写文件被协议拒）。 |
| **activates_on** | seed / sediment knowledge 文件 frontmatter 中的字段，控制该篇何时被加入 LLM 视野。形态：`{ "<trigger>": "show_description" \| "show_content" }`。三类 trigger：`"object::<type>"`（任意 open 的该类 window 出现时命中；如 `"object::root"` 等价"任意线程都见"；旧写 `"window::<type>"` 在 `parseTrigger` 阶段自动归一为同一 AST）/ `"method::<window_type>::<method>"`（某个 window 上正在开同名 method form 时命中）/ `"super"`（仅在 super flow 中命中）。多 trigger 命中取 max（show_content > show_description）。 |

---

## 4. 协议相关术语

### stone-versioning（stone 改动审计协议）

任何对 world 内 Stone 的写入都必经此流程，不能绕过。
**Builtin Object 不在此协议覆盖范围内**——Builtin 由 OOC 代码仓版本化，Agent 不能改写。

模型（feat 分支 PR，2026-06-11）：**session worktree 永不合入 main；沉淀进 canonical 走独立 feat 分支 PR**。

1. 在**业务 session** 里改/建 Stone（试验，不进 canonical）：
   - 改**已存在**对象的文件 → `write_file` / `edit` 写 `stones/<id>/...`。
   - 建一个**全新**对象 → root method `create_object`（裸 write_file 建对象会被拒）。
   改动落**本 session 的 git worktree**（`flows/<sid>/objects/...`），本 session 内即时生效；
   `session-<sid>` worktree 是运行时派生物，**永不合入 main**，归档即弃。
2. 进 canonical 在 **super flow** 走 feat 分支 PR：`new_feat_branch(intent)` 从 main 派生 feat 分支并
   绑定本 thread → 在 feat 分支上 write_file/edit 编辑 → `create_pr_and_invite_reviewers` commit + 开 **PR**。
3. PR 的 reviewer 集由变更触及谁的领地算出（越界对象拉进 review，**supervisor 始终参与**）。

### create_object / new_feat_branch / create_pr_and_invite_reviewers（操作 stone 的方法）+ 治理端点

写 stone 用 method（任何 Object，经 versioning 审计）；supervisor 专属治理动作不是 method，而是经控制面 HTTP 端点 enact（versioning 层强制校验治理身份）。

| 动作 | 形态 | 谁能用 | 用途 |
|---|---|---|---|
| `create_object` | runtime 成员对象的 method（仅业务 session） | 任何 Object | 原子落盘**新** Object 骨架（package.json/self/readable[/knowledge]）到 session worktree；本 session 可用，进 canonical 走 feat 分支 PR |
| `new_feat_branch` | thread method（仅 super flow） | 任何 Object | 从 main 派生一个 feat 分支 worktree 并绑定本 thread（之后 write_file/edit 直接落 feat 分支）；沉淀第一步 |
| `create_pr_and_invite_reviewers` | thread method（仅 super flow） | 任何 Object | finalizer：commit 绑定的 feat 分支（署名发起者）→ 算 reviewer 集 → 开 PR → 给每个 reviewer 投 pr_window |
| 审批 PR | reviewer 在 pr_window 上 `approve`/`reject`/`request_changes`，或控制面端点 `POST /api/runtime/pr-issues/:issueId/approve`（body `{ reviewerObjectId, decision }`） | 该 PR 的 reviewer（含 supervisor） | 多 reviewer 审批聚合 |
| 决议 PR-Issue | 控制面端点 `POST /api/runtime/pr-issues/:issueId/resolve`，body `{ decision }` | **supervisor 专属** | `prAutoMerge=false` 时人工落锤合入（decision: `merge` / `reject` / `request-changes`） |
| 回滚 stone | 控制面端点 `POST /api/runtime/stones/:objectId/rollback`，body `{ targetCommit }` | **supervisor 专属** | 强制回滚 stone 历史到指定 commit |

### PR-Issue（feat 分支沉淀审阅 Issue）

`create_pr_and_invite_reviewers` 开 PR 时产生一条特殊 Issue，含：
- `prPayload.intent`：发起者描述的沉淀意图（commit message 同源）
- `prPayload.branch`：feat 分支名
- `prPayload.diff`：改动 diff（unified format）
- `prPayload.paths`：受影响的文件路径列表
- `prPayload.baseSha`：feat 分支基线 commit sha
- `reviewers` / `approvals`：应批集合与各 reviewer 当前 decision

reviewer 读 diff → 审批（pr_window method 或 `/approve` 端点）。聚合 verdict：全 approve → ready-to-merge；
任一 reject → 一票否决；有 request-changes（无 reject）→ 留 open 等回修。合入闸由 `.world.json prAutoMerge`
控制（缺省 false=人工经 `/resolve {merge}` 落锤）：

| decision | 含义 |
|---|---|
| `merge` | 接受改动，feat 分支并入 main |
| `reject` | 拒绝改动，feat 分支归档，PR-Issue 关闭，message 回投发起者 |
| `request-changes` | 让发起者回去改；PR-Issue 留 open，message 回投发起者续修后重开 PR |

supervisor 自己发起的沉淀也走同一流程（reviewer 仅 {supervisor} 时"自审"合法，git log 与 PR-Issue 链留下完整审计）。

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
| **inbox** | Object 收到但还未处理的跨 Object 消息队列（talk_window 推送：peer 会话消息 / fork 子线程回报）。每轮思考自动可见。 |
| **events** | 系统级事件（Object stone 变更 / 错误），进 visibility 通道供我观察。 |
| **broken stone** | 启动期 recovery-check 发现的、`executable/index.ts` 加载失败的 Stone Object。系统自动开 `[recovery-needed]` PR-Issue 给我处理（决定回滚到哪个历史 commit / 或拒绝放行）。 |
| **recovery-check** | 启动期自检：遍历 `stones/main/objects/*/executable/index.ts`（Stone Object），加载失败的 Object 走 broken stone 流程。Builtin Object 由代码仓版本保证、不走此流程。不阻塞启动，只产出 PR-Issue。 |
