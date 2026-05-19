# Issue 作为 ContextWindow — kanban 数据层 + LLM 协作接入

> **状态**：drafting (2026-05-19) — round-2 revision after ce-doc-review
> **范围**:**两层一并交付**
>   - Tier A:kanban 数据层最小实现(persistence + ConcurrentWrite + HTTP comment endpoint)
>   - Tier B:LLM 视角(IssueWindow + 3 commands + wait 扩展 + 拉取式 mention 通知)
>
> **不含**:UI 看板(留给后续切片)、task_window、user 自助创建 Issue UI、跨 session
> Issue 引用
>
> **前置说明(修正自上一轮)**:`meta/object/collaborable/kanban/` 是 forward-looking
> spec,**src/ 中无任何 kanban 实现** — `grep SerialQueue|/issues/|hasNewInfo`
> 在 src/ 零命中。上一轮 brainstorm 错误地把 spec 当现状,本轮显式承认:数据层是
> 同切片的一部分,不是"已存在"。

---

## 1. 上下文:为什么现在做

### 1.1 现状(诚实版)

kanban spec 已定义 Issue/Comment 数据结构、ConcurrentWrite 串行保护、hasNewInfo
红点机制;**这些都还只是 meta 文档**:
- `src/persistable/` 下没有 `issue.ts` / `kanban.ts`
- `src/app/server/modules/flows/` 下没有 issue / comment 相关 API
- `.ooc-world-test/flows/*/issues/` 不存在
- `SerialQueue` / `ConcurrentWrite` 全仓零命中

`writers` 段定义的三种写入方(supervisor / 其他 Object / user),除了 talk 通信
原语已实现,Issue 写入路径在 src/ 没有任何一方真正打通。

### 1.2 用户痛点 — 现状 vs ack

用户原话:"LLM 能'在场'看到讨论进展。"

诚实表达(根据 product-lens 反馈): **这是 want,不是已观察到的失败 trace**。
没有"某次多对象协作因为 LLM 看不见 Issue 进展而卡住"的具体案例。

但是这个 want 是合理的方向:OOC 的协作 spec 已经把多对象协作放在中心位置
(`collaborable.subdomains` 四个子域之一是 kanban),现在 src 完全没有 Issue
层运行时 = spec 与 impl 间最大缺口。本切片接受"先 ship,再观察实际协作场景
是否需要更强 surface"的工程节奏。

### 1.3 关键设计选择

**为什么不只做 Tier A(kanban 数据层)**:Tier A 独立 ship 后,user 唯一能用
Issue 的方式是手动 curl HTTP API + 手动看 issue-*.json — 没有任何工作流价值。
Tier B 把 LLM 接入,Tier A 才有第一个真实写入者。

**为什么不只做 Tier B(LLM 视角)**:无 Tier A 时 LLM 没有可写的 endpoint,
"在场"承诺只是空话。

两层必须一起 ship。本切片显式承认这一点,scope 与工作量按"两层之和"估算。

### 1.4 切片决策(上一轮 attachment probe 的回应)

ce-brainstorm 第一轮提出了 smaller 选项:"仅 LLM 参与讨论,不含创建 Issue 能力"。
被 reject;采纳的是"原提案全集"。理由:

- mention 是 LLM 在场协作的最低粘合剂,缺它则 wait 也只是被动轮询
- create_issue 与 open_issue 是镜像操作,只做 open 而不做 create 会让 LLM 只能
  被动响应人/supervisor 的 Issue,无法主动开新议题(这正是"在场"的反面)

但**比起原 brainstorm,本轮 scope 再做一次收紧**:
- 移除"现有 HTTP 写入路径也要触发 mention 解析"假设(那个路径根本不存在;Tier A
  会建一个新的,自然带 mention)
- 移除 push-on-write 跨 thread 写 inbox 的复杂并发模型,改成 pull-on-tick
  (与现有 syncCrossObjectCalleeEnds 同模式,无新并发抽象)

### 1.5 这是一次 paradigm 转向 — 显式 ack

OOC 现有 IO 模型是点对点(caller.outbox → callee.inbox,通过 talk-delivery 五
步派送)。本切片首次引入**多订阅者共享资源**模型:多个 thread 持有 issue_window
都"订阅"同一 Issue 的更新。这是真实的范式新增,后续可能推广到 task_window /
PR review window / 共享白板。

本切片**不抽象 SharedContextWindow 通用基类**(过早抽象);但命名 / 事件格式
对未来复用留口:
- inbox 通知 tag 用 `[shared:issue:<id>:...]`(而非死写 `[issue:...]`),让后续
  其他 shared resource 走相同前缀
- 派生函数命名 `deriveIssueWindowKnowledge` 而非 `syncIssueComments`,与
  `deriveRelationKnowledge` 命名一致,后续抽通用 helper 更顺

---

## 2. 用户故事

### 2.1 主路径:LLM 参与已有 Issue

(场景未变,但实施依赖 Tier A 完成)

1. supervisor(或 user 通过 curl)创建 Issue#42 "rename function X"
2. supervisor `root.open_issue(42)` 拉进自己 context,comment "派给 refactor 与
   critic @refactor @critic"
3. refactor 与 critic 在下一次 worker tick 被通知(@ 解析,见 §3.4)→ 自动 wake +
   inbox 注入 system message:"#42 有新评论 @你"
4. refactor `root.open_issue(42)` → 看到完整 Issue 描述 + supervisor 评论 →
   wait(on=<issue_window>)
5. critic 在 Issue#42 评论 → refactor 下一次 worker tick 拉新 comment → 唤醒

### 2.2 主路径:LLM 主动创建 Issue

1. assistant 干活时发现跨多 object 需求 → `root.create_issue(title, description)`
2. 提交后自动 open 一个 issue_window 给 assistant
3. assistant comment 时 @ 相关 object → 它们下一 tick 被 ping
4. 后续走 2.1

### 2.3 不在 scope 的故事

- LLM 改 Issue 状态/标题(只支持 comment;结构改动留给后续 supervisor 模块)
- task_window 形态(本切片只做 issue;**理由**:Task 是执行单元,LLM 通过 do_window
  直接干活,不需要 task_window 看 Task;只有"多人讨论一个执行目标"才会缺
  task_window,这种场景目前可用 Issue 承载)
- UI 看板渲染(留给后续切片)
- 跨 session Issue 引用(spec 明确反对)
- @ 自动 reply(被 @ 只 notify,LLM 是否回复自己判断)

---

## 3. 行为规约

### 3.1 Tier A:kanban 数据层

#### Issue 文件结构

`flows/{sessionId}/issues/issue-{id}.json`:
```
{
  "id": <integer>,
  "title": <string>,
  "description": <string>,
  "status": "open" | "closed",
  "createdAt": <timestamp ms>,
  "createdByObjectId": <string>,
  "comments": [
    {
      "id": <integer>,
      "text": <string>,
      "authorObjectId": <string>,
      "authorKind": "llm" | "user" | "system",
      "createdAt": <timestamp ms>
    }
  ],
  "hasNewInfo": <boolean>
}
```

`flows/{sessionId}/issues/index.json`:
```
{
  "nextId": <integer>,
  "issues": [
    { "id", "title", "status", "commentCount", "lastUpdatedAt", "hasNewInfo" }
  ]
}
```

#### Id 分配

`index.json.nextId` 顺序递增。新 Issue 写入流程:
1. 读 index.json
2. 分配 newId = nextId
3. 写 issue-{newId}.json
4. 更新 index.json:nextId++, 追加 issue 摘要

第 1-4 步串行化(SerialQueue,见下)。

#### ConcurrentWrite SerialQueue(本切片实现)

新建 `src/persistable/serial-queue.ts`:per-session 单写队列,所有 Issue / Comment
写入入队按顺序执行。最简实现:一个 `Promise` 链,新 task `.then` 到尾巴。
不持久化、不跨进程(本切片 worker 单进程,够用)。

#### HTTP endpoints

`src/app/server/modules/issues/`:
- `POST /api/flows/:sessionId/issues` body `{title, description?, createdByObjectId, authorKind}` → 创建 Issue
- `GET /api/flows/:sessionId/issues/:id` → 读单个 Issue
- `GET /api/flows/:sessionId/issues` → 读 index
- `POST /api/flows/:sessionId/issues/:id/comments` body `{text, authorObjectId, authorKind}` → 追加 comment
- `POST /api/flows/:sessionId/issues/:id/close` → 改 status

createdByObjectId / authorObjectId 由调用方传(server 不做身份认证 — 本期仍是
信任入栈调用,认证留给后续切片)。

#### hasNewInfo 机制(MVP 收紧)

MVP **不在 LLM 写 comment 时设 hasNewInfo**(避免每条评论打扰人)。后续 issue
状态变更 / supervisor 显式标记时再设。这一选择带来"user 看不见 LLM 协作进展"
的不对称(见 §5 已显式接受的限制 I6)。

### 3.2 Tier B:IssueWindow + commands

#### IssueWindow 持久化形态

`thread.contextWindows` 中持久化:
```
{
  id: "w_issue_<random>",
  type: "issue",
  parentWindowId: "root",
  issueId: <integer>,
  status: "open" | "closed",   // window 状态(LLM close 后变 closed);Issue 本身的 status 通过派生看到
  lastSeenCommentId: <integer | undefined>,  // mention/拉取记号,用于"自上次以来新评论"判定
  createdAt: <timestamp>
}
```

**命名澄清**(coherence review 关切):`status` 字段在 IssueWindow 上是 window
状态(LLM 是否关闭了这个订阅),不是 Issue 本身的 status。两者命名一样但语义
不同:Issue.status 通过 §3.3 每轮派生看到。实施者要注意此区分,**doc 行文统一
用 `IssueWindow.status` 与 `Issue.status` 区别**。

#### IssueWindow 派生(每轮 render)

由 `src/thinkable/knowledge/synthesizer.ts:collectExecutableKnowledgeEntries` 中
新增 step `deriveIssueWindowKnowledge(thread)` 派生:
- 对 thread.contextWindows 中每个 `type === "issue"` 且 `status === "open"` 的
  window
- 读 `flows/{sessionId}/issues/issue-{issueId}.json`(走 readFile,文件不存在 →
  跳过 + console.debug,不阻断 render)
- 派生 `KnowledgeWindow(source="issue")` 或新 source label(详见 §3.6),body
  包含:`title + status + description + comments[]`
- comment 流截断策略:**只展示最近 N=20 条 + Issue 描述 + "省略 X 条早期"
  marker**,而不是简单 8KB 尾部截断(确保 LLM 总能看到 Issue 描述与最新动态;
  比上一轮的"头尾截断"更具操作性)

派生不持久化,与 protocol/activator/relation 同模式。

#### 新增 commands

**`root.create_issue`** — `{title: string, description?: string}` args 齐时
auto-submit:
- POST 到 Tier A 的 create Issue endpoint;authorObjectId = thread.persistence.objectId
- 自动在 thread.contextWindows 挂 IssueWindow(issueId = 返回的新 id)
- lastSeenCommentId = undefined(创建时尚无评论)

**`root.open_issue`** — `{issueId: integer}` args 齐时 auto-submit:
- GET Tier A 校验 Issue 存在;不存在 → command-error `[open_issue] Issue <id>
  不存在`
- 已挂同 issueId 的 IssueWindow → 返回已有 windowId,不重复创建
- 新挂:lastSeenCommentId = 当前最新 commentId(确保首次 open 不会被历史评论
  瞬间唤醒)

**`issue_window.comment`** — 挂在 IssueWindow:`{text: string}` args 齐时
auto-submit:
- 校验 text 非空
- POST 到 Tier A 的 append comment endpoint;authorObjectId = thread.persistence
  .objectId, authorKind = "llm"
- 触发本 thread 自己的 IssueWindow.lastSeenCommentId 更新(自己写的不会唤醒自己,
  见 §3.4)

**`issue_window.close`** — 复用现有 close 原语:
- 仅本 thread 解订阅(IssueWindow.status → "closed");Issue 本身不变
- 不能 close 别 thread 的 IssueWindow

### 3.3 wait 扩展

`src/executable/tools/wait.ts`:
- `listValidWaitTargets` 加 `issue` 分支(hint 类似 talk_window)
- 验证逻辑放开 `target.type === "issue" && target.status === "open"`
- 错误信息更新为列举 talk / do / issue 三种
- **不要求 LLM "先 comment 才能 wait"**(与 talk 不同:Issue 可只观察不发言)

### 3.4 Pull-on-tick 通知模型(替代上一轮 push-on-write)

**核心变化**:不在 comment 写入时 fan-out 写其他 thread 的 inbox(避免
cross-thread inbox write race)。改为复用 `syncCrossObjectCalleeEnds` 的 pattern:
**每个持有 IssueWindow 的 thread 在自己 worker tick 之前自我扫描**。

`src/app/server/runtime/worker.ts:runJob` 在 runScheduler 前调:
```
syncIssueWindowComments(thread, baseDir, sessionId)
```

`syncIssueWindowComments(thread, baseDir, sessionId)`:
1. 找 thread.contextWindows 中 type=issue, status=open 的 windows
2. 对每个 window:读 issue-{issueId}.json;若 comments 中存在 id > window.lastSeenCommentId
3. 找新 comment 中**满足"应通知本 thread"的**:
   - 来自本 thread 自身 objectId 的不通知(authorObjectId === thread.persistence.objectId)
   - text 中含 `@<self.objectId>` 的 mention(用更严格正则,见下)
   - 或:LLM 显式 `wait(on=<this issue_window>)` 时,任何新 comment 都通知
     (体现"在 wait 这个 issue 上想看任何动态"的语义)
4. 命中 → 写一条 system message 到本 thread.inbox:
   `[shared:issue:<id>:comment author=<obj>] <text 前 200 字>`
5. 更新 window.lastSeenCommentId = max(new commentIds) — 哪怕没通知,游标也推进
   (避免下次重复扫早期 comment)
6. 若本 thread waiting → scheduler 自然检测 inbox 长度增长翻 running(无需自加
   wakeup 逻辑)
7. writeThread(本 thread) 持久化 lastSeenCommentId

**优势**:
- 完全在本 thread 内做 write,无 cross-thread file race
- 复用现有 wakeup 机制(scheduler.wakeWaitingThreadsOnInbox)
- 与 syncCrossObjectCalleeEnds 同 pattern,实施者一个心智模型搞定

**取舍**:
- 通知不是 real-time;最快也要等被通知 thread 自己被 worker pick(平均 < 1 tick)
- 不再触发 "comment 写入时唤醒所有人" 的爆炸式 wake;每个 thread 自己 throttle

### 3.5 Mention 正则与边界

**收紧正则**(避免假阳性):
- 模式:`(?:^|\s)@([a-zA-Z][a-zA-Z0-9_-]*)\b`
- 要求前置空白或行首,跳过 `user@example.com` / `@deprecated` 内联场景
- 仅匹配以字母开头的 objectId(避开 `@123`)
- 命中后查询本 session 的 stones 目录确认该 objectId 存在 → 不存在静默跳过

**Self-@ 跳过(明确语义)**:
- 在 §3.4 step 3 判定 "authorObjectId === thread.persistence.objectId 不通知"
- 即"同 objectId 不通知自己"(无论是同 thread 还是 fork 子 thread,只要 objectId
  相同就跳过) — 这避免了 fork 链上的自唤醒环

**同 objectId 多 thread 扇出策略**:
- 同 objectId 多个 thread 各自持有 issue_window 都会被通知(pull-on-tick 天然这样)
- 接受这一行为;实际场景下 fork 子 thread 通常 short-lived,影响有限
- 限频机制(见下)兜底

**Mention 限频(防振荡)**:
- IssueWindow 上加 `lastNotifiedAt: timestamp`
- syncIssueWindowComments 检查:若 lastNotifiedAt 距 now < 10 秒,跳过本次通知
  (lastSeenCommentId 仍推进 — 下次会"自然吸收"那批新 comment)
- 简化阻断 LLM A ↔ B 互 @ 的高频振荡

**Mention 结果反馈**:
- comment 返回 output 含 `resolved_mentions: [<obj>, <obj>]`,让 LLM 看到自己
  ping 中了谁 → 可在下条 comment 调整

### 3.6 KnowledgeWindow source = "issue"?

考虑 1:复用 `source = "activator"` 派生模式 — 但 activator 是 commandPaths 驱动,
issue 不属于这个语义。

考虑 2:加新 source `"issue"`,与 relation 同模式。这是更清晰的做法;
`KnowledgeWindow.source` union 加 `"issue"` 字面量,types.ts JSDoc 标注本来源由
syncIssueWindowComments 派生。

**采用考虑 2**(命名清晰,与 relation 模式一致)。

### 3.7 LLM 接口知识

`src/thinkable/knowledge/basic-knowledge.ts` 加新段 `## 看板协作:Issue 上的多方
讨论`,覆盖:
- 何时该开 Issue(多人/多轮/需要追溯;一对一/临时仍用 talk)
- `root.create_issue` / `root.open_issue` / `issue_window.comment` /
  `issue_window.close` 用法
- @ mention 协议:写 `@<objectId>`,前置空白;result output 会反馈中 ping 谁
- `wait(on=<issue_window>)` vs 不 wait 的区别(wait → 任何 comment 触发;不 wait
  → 只在 @ 你时通知)
- 与 talk 协同:Issue 上的关键决策可同时 talk 给关键参与者敦促

---

## 4. 实现要点(给 ce-plan 的输入,非最终设计)

### 4.1 Tier A 改动文件

- `src/persistable/issue.ts`(new)— Issue/Comment 类型 + 读写 helper
- `src/persistable/serial-queue.ts`(new)— per-session 单写串行队列
- `src/persistable/index.ts` — re-export 新 helper
- `src/app/server/modules/issues/`(new dir)— Elysia route module
- `src/app/server/modules/issues/{api.create-issue,api.append-comment,api.list-issues,api.get-issue,api.close-issue,service,model,index}.ts`
- `src/app/server/index.ts` — 挂载新 module

### 4.2 Tier B 改动文件

- `src/executable/windows/types.ts` — 加 `IssueWindow`,union 扩展,WindowType 加
  `"issue"`;KnowledgeWindow.source 加 `"issue"`
- `src/executable/windows/issue.ts`(new)— 注册 issue_window commands
  (comment / close);basicKnowledge
- `src/executable/windows/root/create-issue.ts`(new)
- `src/executable/windows/root/open-issue.ts`(new)
- `src/executable/windows/root/index.ts` — 注册新 root commands
- `src/executable/tools/wait.ts` — 扩展允许 issue_window 作 on(见 §3.3)
- `src/thinkable/knowledge/synthesizer.ts` — `deriveIssueWindowKnowledge` 派生段
  (与 deriveRelationKnowledge 同位置)
- `src/app/server/runtime/worker.ts` — `syncIssueWindowComments` helper +
  runJob 调用
- `src/thinkable/knowledge/basic-knowledge.ts` — 加"看板协作"段
- `meta/object/collaborable/kanban/issue.doc.ts` + 父 `kanban/index.doc.ts` —
  sources 接入实际实现,描述 LLM 视角接入

### 4.3 测试要点

**单元**:
- Issue 读写、id 分配、SerialQueue 串行(并发两 task 顺序产出正确结果)
- create_issue / open_issue / comment 各 command 的副作用
- open_issue 不存在 → command-error
- syncIssueWindowComments:无新 comment → 不变;新 comment 来自自己 → 不通知;
  含 @self → 通知;wait 中任意 comment → 通知;限频(10s)生效
- mention 正则:`user@example.com` 不命中 `@example`;`@deprecated` 不命中

**集成**:
- thread A 创建 Issue → thread B(同 session 不同 object)open_issue → A comment
  @B → B 在下一 tick 被 inbox 注入并 wake
- 限频:A 连续 comment @B 两次 < 10s,只通知一次

**e2e**(LLM-driven,`hasLlmEnv` 守门):
- 2 agents 共同协作一个 Issue,@ 触发协作链
- Good / OK / Bad 三档:
  - Good:两 agent 都在 Issue 上 comment,LLM 看到对方的 comment 后基于其调整
  - OK:LLM comment 了但内容不基于对方;或只有一个 LLM 参与
  - Bad:LLM 没 comment,或卡死,或 @ 没有触发

---

## 5. 已显式接受的限制

- **I1 痛点为 want 不是已观察 trace** — 接受"先 ship 再观察"。e2e 测试 + 后续
  实际使用验证"在场"是否解决了真实卡点
- **mention 正则可能仍漏判** — 收紧后边界 case 难免;通过 resolved_mentions
  反馈 + console.debug 让 LLM/开发者可观察
- **同 objectId 多 thread 全通知** — 接受;限频兜底
- **MVP hasNewInfo 默认不设** — user 看不见 LLM 协作进展;承认这一不对称,留给
  后续切片解决(可能加 "agent 写 N 条后" 或关键字触发 heuristic)
- **大 Issue 评论流截断** — N=20 条最近 + 描述,丢失中段历史;依赖"关键决策
  写到描述或最近评论"约定;若使用中发现频繁触发,后期做"增量 diff render"
- **Issue 被 supervisor close 时 wait fallback** — syncIssueWindowComments 同时
  检查 Issue.status 变化,若变 closed:写 `[shared:issue:<id>:closed]` system
  message,wake thread;LLM 看到后自然 close 自己的 IssueWindow
- **拉取式延迟** — 不是 real-time,通知延迟 ~1 tick(< 数秒)。"在场"承诺降级
  为"在 wait 或下一 worker tick 时能看到所有新动态"

---

## 6. 验收标准

### Tier A 验收

- [ ] `flows/{sid}/issues/issue-{id}.json` + `index.json` 正确生成与维护
- [ ] SerialQueue 在并发写入下保持顺序,index 不损坏
- [ ] HTTP create/get/list/append-comment/close 全部正确响应
- [ ] HTTP 路径返回 `resolved_mentions` 字段(让 user 也能看到)

### Tier B 验收

- [ ] `ContextWindow` union 加 `IssueWindow`;`WindowType` 加 `"issue"`;
      `KnowledgeWindow.source` 加 `"issue"`
- [ ] `root.create_issue` 创建 Issue + 自动挂本 thread issue_window
- [ ] `root.open_issue(existingId)` 拉进 thread;不存在 → command-error
- [ ] 同 thread 重复 open 同 issueId → 返回已有 windowId
- [ ] `issue_window.comment(text)` 写入 issue-{id}.json comments[]
- [ ] `wait(on=<issue_window>)` 被允许;新 comment 到达且符合通知条件时被唤醒
- [ ] syncIssueWindowComments 拉取式扫描:不通知 self / @ 命中 / wait 中任意
      comment / 10s 限频 全部按 §3.4 行为生效
- [ ] mention 正则不误判 email / docstring 关键字
- [ ] Issue close 时 wait 中的 thread 收到 [shared:issue:closed] system message
      并 wake
- [ ] basic-knowledge 含"看板协作"段
- [ ] 单元 + 集成 + e2e 覆盖 §4.3 所有场景

---

## 7. 后续可能演进(本期 explicit 不做)

**有现实需求的后续切片**(高优):
- task_window — 对应 Task 的同款 ContextWindow + assign/done command
- UI 看板渲染 — 给 user 一个可视化入口
- Issue comment "增量 diff render" — 长 Issue 减 token cost
- hasNewInfo heuristic — 平衡 user 关注与噪声;agent 写 N 条 / 出现关键字时 set

**还在 wishlist 不应列入路线图**(spec 反对 / 依赖未建):
- 跨 session Issue 引用(spec.sessionScope 明确反对)
- `@all` / `@<role>`(role 系统未建)

---

## 8. ce-doc-review round-1 finding 处置追踪

(round-1 时 brainstorm 假设 kanban 已实现,以下 finding 的处置全在本 round-2 中)

- **B1 vapor infrastructure** → §1.1 + §1.3 显式 ack;scope 扩为 Tier A + Tier B 双交付
- **B2 wakeup 条件矛盾** → §3.4 改 pull-on-tick;唤醒走"inbox 增长" naturally,
  不再写"waitingOn 条件"
- **B3 cross-thread write race** → §3.4 改 pull-on-tick,完全消除 race
- **I1 premise want vs pain** → §1.2 ack
- **I2 正则假阳性** → §3.5 收紧正则
- **I3 同 objectId 多 thread 扇出** → §3.5 接受 + 限频
- **I4 close 时 wait hang** → §5 加 fallback 机制
- **I5 oscillation 限流** → §3.5 加 10s 限频(从"接受"提升到"must-handle")
- **I6 hasNewInfo 默认不设** → §3.1 + §5 显式 ack 不对称
- **I7 file_window+edit alternative** → §1.3 间接处置(本切片选择新 source,理由
  是 mention 解析 / wait 语义 / KnowledgeWindow 形态都需要 issue 专属逻辑;
  file_window 复用会让 commands 误导 LLM "这只是一个文件")
- **I8 push vs pull** → §3.4 采纳 pull
- **I9 paradigm shift 未 ack** → §1.5 显式 ack
- **I10 §7 mix 现实和 wishlist** → §7 拆两组
