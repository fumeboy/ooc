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
| **peer Object window** | 同 stone 的 sibling / level-1 children Object，**自动作为 first-class ContextWindow 注入到我的 contextWindows 中**，可直接 exec 其 commands | id = `<objectId>`，type = `<objectId>`，command 集合为该对象 `executable/index.ts` 中声明的 commands |

每个 Window 都有命令集：通用的 `open` / `refine` / `submit` / `close` / `wait`，
加上 Window 特定的 command（例如 talk 上有 `say`，peer Object window 上有 `exec`）。

> **peer exec vs talk 的边界**：
> - 同 stone peer（我身边的 sibling / children）：默认直接 `exec(window_id="<objectId>", command="...")`
> - 跨 session / 需要对方独立思考 / 跨 stone 跨 world 对象：`talk_window(target=...)`
> - 不要拿 peer window id 做 talk——那是把"直接调用"错当成"发消息给远方同事"，链路多 2 跳。

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
| **activates_on** | seed / sediment knowledge 文件 frontmatter 中的字段，控制该篇何时被加入 LLM 视野。形态：`{ "<trigger>": "show_description" \| "show_content" }`。三类 trigger：`"window::<type>"`（任意 open 的该类 window 出现时命中；如 `"window::root"` 等价"任意线程都见"）/ `"method::<window_type>::<method>"`（某个 window 上正在开同名 command form 时命中）/ `"super"`（仅在 super flow 中命中）。多 trigger 命中取 max（show_content > show_description）。 |

---

## 4. 协议相关术语

### stone-versioning（stone 改动审计协议）

任何对 world 内 Stone 的写入都必经此流程，不能绕过。
**Builtin Object 不在此协议覆盖范围内**——Builtin 由 OOC 代码仓版本化，Agent 不能改写。

模型（去 metaprog 写路径后，2026-06-09）：**业务 session 写 → super flow 合入**。

1. 在**业务 session** 里改 Stone：
   - 改**已存在**对象的文件 → `write_file` / `edit` 写 `stones/<id>/...`。
   - 建一个**全新**对象 → root method `create_object`（裸 write_file 建对象会被拒）。
2. 改动落**本 session 的 git worktree**（`flows/<sid>/objects/...`，main 的完整副本），
   本 session 内即时生效、**main 不变**。
3. 在 **super flow** 调 `evolve_self` 把这个业务 session 的 worktree 改动合入 main：
   - **self-scope**（只触及 `objects/<self>/` 自己目录）→ 自动 fast-forward merge，立即生效。
   - **cross-scope**（触及 `objects/<other>/` 或新对象）→ 自动开 **PR-Issue** 待 supervisor 评审。

### create_object / evolve_self / metaprog（操作 stone 的方法）

| method | 谁能调 | 用途 |
|---|---|---|
| `create_object` | 任何 Object（仅业务 session） | 原子落盘**新** Object 骨架（package.json/self/readable[/knowledge]）到 session worktree；不 commit，由 evolve_self 合入 |
| `evolve_self` | 任何 Object（仅 super flow） | 把触发本 super 的业务 session 的 worktree 改动合入 main（self-scope ff-merge / cross-scope 自动 PR-Issue） |
| `metaprog action="resolve"` | **supervisor 专属** | 决议 PR-Issue（decision: `merge` / `reject` / `request-changes`） |
| `metaprog action="rollback"` | **supervisor 专属** | 强制回滚 stone 历史到指定 commit |

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
