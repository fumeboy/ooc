---
type: feat
origin: docs/brainstorms/2026-05-19-issue-context-window-requirements.md
created: 2026-05-19
status: active
---

# feat: Issue context window — kanban data + LLM collaboration

> **状态**: active (2026-05-19, round-3 — 已应用 ce-doc-review round-2 全部
> walk-through 决策)
> **Origin**: `docs/brainstorms/2026-05-19-issue-context-window-requirements.md`
>            (round-2 修订版,已含 ce-doc-review round-1 全部 findings 处置)
> **类型**: feat — 同切片交付两层:Tier A(kanban 持久化 + persistable issue-service
>           + HTTP API)+ Tier B(IssueWindow + 3 commands + wait 扩展 +
>           双轨 mention + 拉取/推送双管唤醒)
> **不含**: UI 看板渲染、task_window、user 自助创建 Issue UI、跨 session Issue 引用

***

## 1. Summary

把 origin 的 "Issue 作为 ContextWindow" 从悬空 spec 落到 runtime。两层一并交付:

**Tier A — kanban 数据层(本仓 src 中目前为零)**:`flows/{sid}/issues/` 目录 +
`issue-{id}.json` + `index.json` + per-session SerialQueue 串行写 + 5 个 HTTP
endpoints(create / get / list / append-comment / close)。**业务逻辑(service)
+ SerialQueue + mention helper 全部沉到 `src/persistable/issue-service.ts`**
作为 HTTP 与 LLM 命令两条写入路径的共享 seam(避免 `src/executable/` 反向
import `src/app/server/` 破坏分层)。

**Tier B — LLM 接入(新 ContextWindow 类型 + 协作机制)**:`IssueWindow` 持久化
形态(close 即移除 window,无 status 翻转;`lastSeenCommentId` 等游标 in-process
不持久化)、`root.create_issue` / `root.open_issue` / `issue_window.comment`
命令(comment 支持 `mentions: string[]` 双轨参数 + 文本正则)、close 走通用
原语、`wait(on=issue_window)` 扩展、`deriveIssueWindowKnowledge` 每轮派生
(评论用 XML fence 包裹防 prompt injection)、`syncIssueWindowComments` 拉取式
通知 + `issuesService.appendComment` 内 `enqueueSubscribersForIssue` push 主动
唤醒订阅 thread(双管齐下解决 "waiting thread 永远不被 tick" 的死局)。

paradigm 说明:本切片是 OOC 首个"多 thread 订阅同一资源"形态(相对于现有
point-to-point talk-delivery),但**不预设 `shared:*` 通用前缀范式**。通知 tag
直接用 `[issue:...]`;若未来 task_window / PR review 真复用本切片模式,届时再
统一命名。

***

## 2. Problem Frame

- meta 文档已定义 kanban/Issue/Comment/ConcurrentWrite spec,但 `grep
  SerialQueue|/issues/|hasNewInfo` 在 src/ 零命中 — spec 与 impl 间最大缺口
- LLM 协作只有 talk(点对点);"多 agent 共同推进同一议题"无对应原语
- 用户 want: "LLM 能'在场'看到讨论进展"(承认这是 want 不是已观察 trace;
  本切片 ship + 实际观察)

***

## 3. Scope Boundaries

### 含 — Tier A

- `flows/{sid}/issues/` 目录骨架 + issue-{id}.json + index.json 双写
- per-session SerialQueue(`src/persistable/serial-queue.ts` 新增简易 Promise-chain)
- 5 个 HTTP endpoints(create_issue / get_issue / list_issues / append_comment / close_issue)
  ;**S1**:sessionId / issueId / text / authorObjectId 严格 schema 校验,防
  path-traversal 与超长输入;**S3**:authorKind 由 server 派生不接受 client 传
- mention 解析 helper(`src/persistable/mention.ts`,供 HTTP / LLM / worker 三处共用)

### 含 — Tier B

- `IssueWindow` 持久化形态(**无 status 字段**,close 即移除;`lastSeenCommentId` /
  `lastNotifiedAt` 是 in-process 内存语义,writeThread 时 strip 不持久化)
  + `WindowType` / `ContextWindow` union 扩展 + registry seed 占位条目
- `KnowledgeWindow.source` 加 `"issue"` 字面量
- `root.create_issue` / `root.open_issue` / `issue_window.comment`(close 走通用
  原语;**comment 支持双轨 mentions**:`text` 正则 + `mentions: string[]` 参数取
  并集)
- `wait(on=issue_window)` schema 扩展
- `deriveIssueWindowKnowledge` 每轮派生 + 截断策略(最近 N=20 条 + 描述);
  评论文本以 `<comment author="X" id="N">...</comment>` XML fence 包裹(S2 防
  prompt injection)
- `syncIssueWindowComments` worker-tick 拉取式通知 + **`issuesService.appendComment`
  内 push 路径**(`enqueueSubscribersForIssue` 把订阅 thread 加进 jobManager 队列)
  双管齐下;通知规约:self-skip / @-mention / wait-all(绕 10s 限频)/ 10s 限频
  (非 waiting)/ Issue close fallback(写 inbox + WindowManager.close 移除 window)
- `basic-knowledge.ts` 加 "看板协作" 段
- meta doc 4 文件 sources 接入:`kanban/issue.doc.ts` + `kanban/index.doc.ts` +
  `kanban/comment.doc.ts` + `kanban/concurrent-write.doc.ts`(后两者描述本切片
  实现的 Comment / SerialQueue,加进 scope 与 U11 Files 列表一致)

### Deferred for later(origin §7 第一组,确定后续要做)

- task\_window — Task 对应同款 ContextWindow + assign/done command
- UI 看板渲染 — 给 user 可视化入口
- Issue comment "增量 diff render" — 长 Issue 减 token cost
- hasNewInfo heuristic — agent 写 N 条 / 关键字触发 setNewInfo

### Outside this product's identity(origin §7 第二组 + 明确反对的)

- 跨 session Issue 引用(spec.sessionScope 反对)
- `@all` / `@<role>`(role 系统未建)

### Deferred to Follow-Up Work

- 本切片完整闭环,无需拆切片;所有 unit 在本计划内

***

## 4. Key Technical Decisions

1. **Tier A + Tier B 同切片交付** — Tier A 单独 ship 没有真实写入者;Tier B 单独
   ship 无可调 endpoint。两层互相依赖,合并为一个完整切片(origin §1.3)
2. **Service seam 在 `src/persistable/`(F2 修正)** — Issue 业务逻辑
   (`createIssue` / `appendComment` / `closeIssue` / `listIssues` / `getIssue`)
   + per-session SerialQueue 全部沉到 `src/persistable/issue-service.ts`,**避免
   `src/executable/` 反向 import `src/app/server/`** 破坏分层。HTTP 模块(U3)
   与 LLM 命令(U5/U6)都是该 service 的薄壳消费者。两条写入路径**共享同一
   SerialQueue 实例**(模块级 `Map<sessionId, tailPromise>`),所以多 LLM + curl
   并发写同 session 时仍然串行,index.json 不会损坏
3. **Pull-on-tick + push-on-write 协同(F4 修正)** — pull:复用
   `src/app/server/runtime/worker.ts:syncCrossObjectCalleeEnds` 模式,worker 跑
   每个 thread tick 前自我扫描;push:`appendComment` 成功后,service 主动扫同
   session 所有 thread,凡持有 open IssueWindow on this issueId 的 thread,enqueue
   一个 run-thread job(经 jobManager)。push 解决 "waiting thread 既不在 job
   队列也不是 running 永远不被 sync" 的死局;pull 兜底防漏。代价是通知延迟在
   "service 写入 → 下一个 worker tick" 之间(亚秒级)
4. **派生 seam 在 `src/thinkable/knowledge/synthesizer.ts`** — 与 protocol /
   activator / relation 同处;新加 "5) issue" 段,产出
   `KnowledgeWindow(source="issue")`。评论文本用 `<comment author="X" id="N">
   ...</comment>` XML fence 包裹(S2 防 prompt injection — LLM 把 fenced 内容当
   数据不当指令)
5. **Mention 双轨:structured 参数 + 文本正则(P1 修正)** — `issue_window.comment`
   args 加 `mentions?: string[]`;若 LLM 显式传则**与正则解析结果取并集 + 去重**
   作为 resolved_mentions。正则保持 `(?:^|\\s)@([a-zA-Z][a-zA-Z0-9_-]*)\\b`
   (前置空白避免 `user@example.com` / `@deprecated` 假阳性)。这样 "LLM 忘记
   @" 的失败模式可由 prompt 教学引导显式传 mentions 字段绕过,无需依赖文本格式
6. **Mention 扇出无 cap(A4 显式可接受)** — 单条 comment 解析出 N 个 mention
   就会触发 N 个 thread 各自下一 tick 被唤醒,无横向限制。MVP 接受 N× LLM 并发
   成本;未来若观察到滥用再加 K 截断
7. **10s 限频(防纵向振荡;A1 修正)** — IssueWindow 加 `lastNotifiedAt`
   (in-process 内存,不持久化);同 thread 同 issue < 10s 内的连续通知合并为
   一次,`lastSeenCommentId` 仍前进。**例外**:`thread.status==="waiting" &&
   thread.waitingOn === w.id` 时**绕过限频**(限频只防 idle 高频振荡,不能压制
   waiting 唤醒信号)
8. **Self-skip 是 objectId 维度** — `authorObjectId === thread.persistence.objectId`
   即跳过(无视 threadId);避免 fork 子 thread 自唤醒环。已知副作用:同 objectId
   多 thread 间不互通过 mention 协作(走 talk 即可),不影响 MVP
9. **`KnowledgeWindow.source = "issue"` 而非复用 activator** — activator 是
   commandPaths 驱动,issue 是 talk_window/issue_window 共存语义;新 source 命名
   清晰,与 relation 同模式
10. **Close 即移除 window(F3 修正)** — `WindowManager.close()` 既有语义就是
    `onClose hook + removeWindow`,**不引入 status 字段翻转**。U9 Issue close
    fallback 写完 inbox 立即调 `WindowManager.close(window.id, thread)`,window
    从 `thread.contextWindows` 消失。U7 wait 检查走 "unknown window id" 分支
11. **`lastSeenCommentId` 不持久化(A5 修正)** — IssueWindow.lastSeenCommentId
    与 lastNotifiedAt 都是 worker process 内存语义,`writeThread` 时**strip 这
    两个字段**(参考 `service.ts:stripVolatileForHash` 的模式)。重启后视
    `undefined` → 初值=当前最新 commentId(避免重启全唤醒);代价是重启期间错
    过的 mention 永远丢失。MVP 单 worker 长跑时几乎无影响
12. **通知 tag 用 `[issue:...]` 不带 `shared:` 前缀(P2 修正)** — 不预设
    "shared resource paradigm"。若未来 task_window / PR review 真复用本切片
    模式,届时再统一命名;现在专注 Issue 一个 case

***

## 5. Implementation Units

### U1. Issue / Comment persistence types + IO helper

**Goal**: 给磁盘上的 `flows/{sid}/issues/issue-{id}.json` 和 `index.json` 定义
TypeScript 类型 + readIssue/writeIssue/readIndex/writeIndex 等基础 IO,不带任何
锁与业务逻辑

**Requirements**: origin §3.1 (Issue 文件结构 / Id 分配)

**Dependencies**: 无

**Files**:

- `src/persistable/issue.ts` (new — 类型 + helper)
- `src/persistable/__tests__/issue.test.ts` (new — unit)
- `src/persistable/index.ts` (modify — re-export)

**Approach**:

- 新 type `Issue` / `Comment` / `IssueIndexEntry` / `IssueIndex`(字段见 origin §3.1)
- `issueFile(sessionId, issueId)` / `issueIndexFile(sessionId)` 路径函数
- **S1 防御**:`issueFile/issueIndexFile` 入参校验 `sessionId` 必须匹配
  `/^[a-zA-Z0-9_-]{1,64}$/`,`issueId` 必须正整数;不匹配抛错(防止 `..` /
  URL 编码绕过把文件写到任意路径)。复用 `flows` module 已有的
  `sessionIdParams` 模式
- `readIssue` / `writeIssue` / `readIssueIndex` / `writeIssueIndex` IO(JSON
  parse/stringify;ENOENT 静默)
- 不在本 unit 做并发保护、不做 id 分配、不做 business — 全部留给 U2

**Patterns to follow**:

- `src/persistable/stone-readme.ts` 是几乎完全的模板(readFile + ENOENT 静默 + writeFile)
- `src/persistable/common.ts:toJson` 用统一格式
- `flows/{sid}/` 目录已由 `flow-object.ts` 创建,issues/ 子目录需要 mkdir recursive
- `src/app/server/modules/flows/model.ts:sessionIdParams` 的 schema 模式

**Test scenarios**:

- writeIssue 后 readIssue 拿到一致数据
- 不存在 issue → readIssue 返回 undefined(ENOENT 静默)
- 不存在 index → readIssueIndex 返回空 `{ nextId: 1, issues: [] }`
- writeIssueIndex 后 readIssueIndex 拿到 nextId + issues 列表
- 异常 JSON 文件 → readIssue 抛错(让 caller 决定)
- `issueFile("../etc", 1)` 抛 sessionId 校验错
- `issueFile("good", 1.5)` 抛 issueId 校验错

**Verification**: `bun test src/persistable/__tests__/issue.test.ts` 绿

***

### U2. Issue service + per-session SerialQueue(persistable 层共享 seam)

**Goal**: 把 Issue 业务逻辑(create / appendComment / closeIssue / list / get)
+ per-session SerialQueue 沉到 `src/persistable/` 层,作为 HTTP(U3)与 LLM
命令(U5/U6)共享的唯一写入入口。**这是修正原 plan 把 service 放在
`src/app/server/modules/issues/` 导致 executable→app/server 反向 import 的关键
seam 调整(F2 修正)**

**Requirements**: origin §3.1 ConcurrentWrite SerialQueue / Id 分配 / Issue 文件结构

**Dependencies**: U1

**Files**:

- `src/persistable/serial-queue.ts` (new — per-key Promise chain)
- `src/persistable/issue-service.ts` (new — createIssue / appendComment / closeIssue / listIssues / getIssue)
- `src/persistable/mention.ts` (new — `parseMentions(text)` 纯函数;HTTP 与 worker 共享)
- `src/persistable/__tests__/serial-queue.test.ts` (new)
- `src/persistable/__tests__/issue-service.test.ts` (new)
- `src/persistable/__tests__/mention.test.ts` (new)
- `src/persistable/index.ts` (modify — re-export `enqueueSessionWrite` / `issuesService` / `parseMentions`)

**Approach**:

- `serial-queue.ts`:模块级 `Map<string, Promise<unknown>>` 缓存 per-key tail Promise;
  `enqueueSessionWrite<T>(sessionId, task: () => Promise<T>): Promise<T>`:
  取 tail → 新 promise = tail.then(task) → 写回 map → 返回新 promise;
  tail 的 catch 在 map 中防止毒化。**单进程语义,模块单例**(HTTP 与 worker
  都 import 这个模块所以共享 Map);多进程部署需文件锁(留给 follow-up)
- `mention.ts`:`parseMentions(text: string): string[]` —
  正则 `/(?:^|\s)@([a-zA-Z][a-zA-Z0-9_-]*)\b/g` 抽 captures,unique 去重;
  **不做 stones 存在性校验**(校验放在 service 层,需要 baseDir),纯字符串处理
- `issuesService.createIssue({baseDir, sessionId, title, description, createdByObjectId})`:
  - enqueueSessionWrite → readIssueIndex → newId = nextId → writeIssue
    + writeIssueIndex(nextId+1, append issue 摘要) → 返回 `{id, title, status, createdAt, ...}`
- `issuesService.appendComment({baseDir, sessionId, issueId, text, authorObjectId, authorKind, mentions?})`:
  - **S2 防御**:`text.length > 4096` 拒绝(单 comment 最大 4KB)
  - **S3 防御**:`authorObjectId` 必须是该 baseDir 下 stones/ 子目录里实际存在
    的 objectId(参考 `stoneObjectMetadataFile` 存在性);不存在拒绝
  - `authorKind` **由 service 决定**:LLM 路径(U5/U6 经过)→ "llm",HTTP 路径
    (U3)→ "user";**不接受 client 传**
  - enqueueSessionWrite → readIssue(校验存在) → comments.push(commentId =
    comments.length + 1) → writeIssue → 更新 index commentCount/lastUpdatedAt
  - resolved_mentions = unique(parseMentions(text) ∪ (mentions ?? []))
    — structured 参数与正则解析结果并集去重(P1 双轨)
  - **F4 push 路径**:写入成功后调
    `enqueueSubscribersForIssue({baseDir, sessionId, issueId, exceptThreadId?: authorThreadId})`
    扫同 session 所有 thread.json,凡持有 type=="issue" + issueId 匹配 + status
    open 的 IssueWindow 的 thread,经 `getJobManager().enqueue` 加一个 run-thread
    job(除 author 自己 thread 外)。`exceptThreadId` 由 caller 传入(U5/U6 知道
    自己 thread,HTTP 路径不传)
  - return `{commentId, resolved_mentions, mentionCap: false}`
    (mentionCap 字段为 §4 决策 6 预留,本切片始终 false)
- `issuesService.closeIssue({baseDir, sessionId, issueId})`:enqueueSessionWrite →
  readIssue → status="closed" → writeIssue + 更新 index
- `issuesService.getIssue({baseDir, sessionId, issueId})`:readIssue 返回
- `issuesService.listIssues({baseDir, sessionId})`:readIssueIndex 返回 issues[]
- `enqueueSubscribersForIssue` 实现:扫 `sessionDir/objects/*/threads/*/thread.json`,
  parse → 检查 contextWindows 含 open IssueWindow on this issueId → 排除
  `exceptThreadId` → 调 `getJobManager().enqueue(thread.persistence)`

**Patterns to follow**:

- `src/app/server/modules/flows/service.ts` 是 service 函数 + baseDir 透传的写法
- `src/app/server/runtime/job-manager.ts:getJobManager().enqueue` 是 push 路径入口
- `src/persistable/stone-object.ts:stoneObjectMetadataFile` 是 stone 存在性校验入口

**Test scenarios**:

- SerialQueue:同 session 两个并发 enqueueSessionWrite → 串行执行
- SerialQueue:不同 session 并发执行
- SerialQueue:task 抛错 → 错误传给该 caller;后续同 session task 仍能跑
- 100 并发 enqueue 顺序正确
- `parseMentions("hi @critic @reviewer @user@example.com")` → `["critic", "reviewer"]`
- `parseMentions("`@deprecated` function")` → `[]`(前置反引号非空白)
- `parseMentions("@1abc @-illegal valid")` → `[]`
- createIssue → getIssue 命中;index 含摘要
- appendComment:并发两次 → 串行写,commentId 顺序正确,index.commentCount 准
- appendComment text > 4096 字符 → 抛错
- appendComment authorObjectId 不在 stones/ → 抛错
- appendComment structured `mentions: ["alice"]` + 文本 "hi @bob" → resolved_mentions = ["alice", "bob"]
- appendComment push:同 session 有 3 个 thread 持有该 issue → 调 jobManager.enqueue 3 次(除 author thread)
- closeIssue → status="closed"
- listIssues → index.issues 全部

**Verification**: `bun test src/persistable/__tests__/{serial-queue,issue-service,mention}.test.ts` 绿

***

### U3. Issues HTTP module(薄壳,转发到 persistable.issuesService)

**Goal**: 暴露 5 个 HTTP endpoint 供 curl / UI 调用;**业务逻辑全部委托给
`issuesService`(U2)**,本 unit 只做 Elysia 路由 + schema 校验 + author 派生

**Requirements**: origin §3.1 HTTP endpoints

**Dependencies**: U1, U2

**Files**:

- `src/app/server/modules/issues/index.ts` (new — Elysia module entry)
- `src/app/server/modules/issues/model.ts` (new — t.Object schemas,严格校验)
- `src/app/server/modules/issues/api.create-issue.ts`
- `src/app/server/modules/issues/api.get-issue.ts`
- `src/app/server/modules/issues/api.list-issues.ts`
- `src/app/server/modules/issues/api.append-comment.ts`
- `src/app/server/modules/issues/api.close-issue.ts`
- `src/app/server/modules/issues/__tests__/api.test.ts`
- `src/app/server/index.ts` (modify — 挂载新 module)

**Approach**:

- **S1 验证**(model.ts schemas):
  - sessionId param 用 `t.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" })`(复用
    `flows` module 的 `sessionIdParams` 写法)
  - issueId param 用 `t.Numeric({ minimum: 1 })`
  - text body 用 `t.String({ maxLength: 4096 })`
  - authorObjectId(HTTP 路径)用 `t.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" })`
- **S3 验证**:authorKind 由 server 派生为 "user"(HTTP 路径默认值),**不暴露
  到 schema**;authorObjectId 也由 service 层做 stones/ 存在性校验
- 每个 api.*.ts:调对应的 `issuesService.{createIssue,getIssue,listIssues,
  appendComment,closeIssue}`;返回 service 返回值原样 + 必要时 wrap `{ ok: true }`
- 不存在的 issueId → service 返回 undefined → endpoint 404
- 写入路径**不主动通知**(那是 `issuesService.appendComment` 内部 push 路径的事)
- 端点路径:
  - `POST /api/flows/:sessionId/issues` create
  - `GET /api/flows/:sessionId/issues` list
  - `GET /api/flows/:sessionId/issues/:id` get
  - `POST /api/flows/:sessionId/issues/:id/comments` appendComment
  - `POST /api/flows/:sessionId/issues/:id/close` closeIssue

**Patterns to follow**:

- `src/app/server/modules/flows/{index,model,api.*}.ts` 是模板;Elysia + t schema + service 注入
- `src/app/server/modules/ui/api.read-any-file.ts` 是最小 endpoint 示例

**Test scenarios**:

- POST `/api/flows/sess1/issues` body `{title,description}` → 200 + `{id, ...}`
- GET `/api/flows/sess1/issues/1` → 200 + Issue body
- POST `/api/flows/sess1/issues/1/comments` body `{text, authorObjectId}` → 200 + resolved_mentions
- POST `/api/flows/sess1/issues/1/close` → 200,后续 GET 看到 status="closed"
- GET `/api/flows/sess1/issues/999` → 404
- POST `/api/flows/..%2Fetc/issues` → 400(sessionId schema 拒绝)
- POST appendComment `text` > 4096 → 400(model 层)
- POST appendComment `authorObjectId="不存在"` → 400 或 422
- POST appendComment `authorKind` 字段传入 → 被 schema 忽略(server 派生)
- listIssues → index.issues 全部

**Verification**: 单元 + module 测试全绿;curl `POST /api/flows/s/issues` 能创建

***

### U4. Extend types: IssueWindow + KnowledgeWindow.source = "issue"

**Goal**: 给 ContextWindow union 加新成员;给 KnowledgeWindow.source 加新字面量;
**预注册 "issue" 到 WindowRegistry,避免 U6 的 registerWindowType 抛错(F1 修正)**

**Requirements**: origin §3.2 IssueWindow 持久化形态;§3.6 source = "issue"

**Dependencies**: 无(可与 U1-U3 并行)

**Files**:

- `src/executable/windows/types.ts` (modify)
- `src/executable/windows/registry.ts` (modify — REGISTRY 预 seed "issue" 条目)
- `src/app/server/modules/flows/service.ts` (modify — `stripVolatileForHash`
  对 IssueWindow strip `lastSeenCommentId` + `lastNotifiedAt`)
- `src/app/server/runtime/thread-snapshot.ts` 或 writeThread 调用处
  (modify — 同样 strip 这两字段,防 in-process 内存语义被持久化)

**Approach**:

- `WindowType` union 加 `"issue"`
- 新 interface `IssueWindow extends BaseContextWindow`:
  ```
  type: "issue";
  issueId: number;
  /**
   * mention/拉取游标 —— in-process 语义,**不持久化**(A5 修正)。
   * writeThread 时被 strip;重启后视 undefined → sync 首次见到时初值=当前最新 commentId
   * (避免重启全唤醒;代价是重启期间错过的 mention 永远丢失)。
   */
  lastSeenCommentId?: number;
  /**
   * 10s 限频窗口起始时间戳 —— in-process 语义,**不持久化**。
   * 同样 writeThread 时 strip。
   */
  lastNotifiedAt?: number;
  ```
  **注意**:不引入 `status: "open"|"closed"` 字段 —— close 即移除 window(F3
  修正),Issue 自身 status 通过 derive 见到
- `ContextWindow` union 加入 IssueWindow
- `generateWindowId("issue")` 前缀 `"w_issue"`
- KnowledgeWindow JSDoc 扩 "5 种 source",`source` union 加 `"issue"`
- `src/executable/windows/registry.ts`:在文件末尾 `REGISTRY.set("issue", { type: "issue", commands: {}, basicKnowledge: undefined })`
  作为占位条目;U6 的 `registerWindowType("issue", {...})` 会更新这个条目(不再
  抛 "unknown window type")
- `stripVolatileForHash` 在遍历 contextWindows 时,若 `window.type === "issue"`,
  返回的拷贝里 `delete lastSeenCommentId / lastNotifiedAt`(参考已有 relation
  source strip 逻辑)
- writeThread 路径(`src/persistable/thread-json.ts` 或调用处)同样 strip;
  也可以集中在一个 `stripVolatileForPersist(thread)` helper 里实现,两处复用

**Patterns to follow**:

- `TalkWindow`(target/targetThreadId/conversationId)字段命名风格
- `KnowledgeWindow`(source/presentation/description)风格
- 上次 PR feat(collaborable): relation activation 加 `"relation"` source 是模板
- `src/app/server/modules/flows/service.ts:stripVolatileForHash` 是 strip 模式

**Test scenarios**:

- 类型扩展:`bun tsc --noEmit` 全绿
- registry.ts:`REGISTRY.get("issue")` 返回占位条目;`registerWindowType("issue", {...})` 不抛
- stripVolatileForHash:含 IssueWindow + lastSeenCommentId=5 + lastNotifiedAt=now
  → 返回拷贝不含这两字段
- writeThread:含 IssueWindow + in-process 字段 → readThread 后这两字段为 undefined

**Verification**: `bun tsc --noEmit` 全绿;registry + strip unit 测试绿

***

### U5. root.create_issue + root.open_issue commands

**Goal**: 让 LLM 能创建 Issue 或把已有 Issue 拉进 thread

**Requirements**: origin §3.2 root.create_issue / root.open_issue

**Dependencies**: U1, U2, U4

**Files**:

- `src/executable/windows/root/create-issue.ts` (new)
- `src/executable/windows/root/open-issue.ts` (new)
- `src/executable/windows/root/index.ts` (modify — 注册)
- `src/executable/windows/index.ts` (modify — 加 `import "./issue.js";` 副作用导入,
  让 U6 的 registerWindowType 在 worker / test boot 时生效;F1 修正)
- `src/executable/__tests__/issue-commands.test.ts` (new)

**Approach**:

- `create_issue`(args:`{title, description?}` args 齐 auto-submit):
  - 调 `issuesService.createIssue({baseDir, sessionId, title, description, createdByObjectId: thread.persistence.objectId})`
    (**走 `src/persistable/issue-service.ts`,不通过 HTTP 也不反向 import
    `src/app/server/...`** — F2 修正后的合规路径)
  - 拿到 newId → ctx.manager.insertTypedWindow IssueWindow
    `{ issueId: newId, lastSeenCommentId: undefined }`
  - **A2 failure recovery**:try/catch insertTypedWindow;若抛错,返回
    command-error 含 issueId,告知 LLM `Issue #${id} 已创建但 window 挂载失败,
    可用 open_issue(${id}) 接管`(让 LLM 自救,不强制 runtime 回滚孤儿 Issue
    文件)
- `open_issue`(args:`{issueId}` args 齐 auto-submit):
  - readIssue 校验 — 不存在 → return command-error `[open_issue] Issue <id> 不存在`
  - 已挂同 issueId 的 IssueWindow → 返回已有 windowId,不重复创建(因为 F3 决议
    close 即移除 window,所以这里只可能见到 open 状态的 window)
  - 新挂 IssueWindow,`lastSeenCommentId` 初始化为当前最新 commentId
    (= comments.length;避免首次 open 时历史 comment 全部触发 wake)
  - **A3 文档说明**:`lastSeenCommentId` 只控制 inbox 唤醒游标,**不影响 LLM 在
    derive body 中看到完整 Issue 内容**(description + 全部 comments,详见 U8)。
    LLM close 后想再次订阅 → 再次 open_issue(同 id)即可,新 window 看到全部历史

**Patterns to follow**:

- `src/executable/windows/root/talk.ts:executeTalkCommand` 是 close 模板(校验 →
  manager.insertTypedWindow);特别是 root.talk 校验 target stone 存在的 pattern
  与 open_issue 校验 issue 存在直接对应
- `src/executable/windows/root/index.ts` 注册新命令的位置
- `src/executable/windows/index.ts` 顶部 `import "./root/index.js"` 风格的副作用
  导入

**Test scenarios**:

- create_issue args 齐 → 自动 submit + 挂 IssueWindow + 服务端建文件
- create_issue 缺 title → command-error
- create_issue insertTypedWindow throws → error 含 issueId 让 LLM 知道
- open_issue 不存在 issueId → command-error,不挂 window
- open_issue 已挂同 issueId → 返回已有 windowId,不重复挂
- open_issue 首次挂:lastSeenCommentId = comments.length
- create_issue + close_window + open_issue 同 id → 新 window 挂上,看到完整历史
  (derive body 含全部 comments)

**Verification**: 单元测试绿;手动测试场景 "create_issue → open_issue (id) 不重复"

***

### U6. issue_window registration (comment command + basicKnowledge)

**Goal**: 注册 issue type 的 window 与 comment 命令;close 复用 `WindowManager.close`
**既有 "移除 window" 语义(F3 修正,不引入 status 翻转)**

**Requirements**: origin §3.2 issue_window.comment 语义;§3.2 close 语义

**Dependencies**: U2 (issuesService.appendComment), U4

**Files**:

- `src/executable/windows/issue.ts` (new — registerWindowType("issue", {commands, basicKnowledge}))
- `src/executable/__tests__/issue-window.test.ts` (new)

**Approach**:

- `registerWindowType("issue", { commands: { comment: { ... } }, basicKnowledge: ISSUE_BASIC_KNOWLEDGE })`
  — 此时 U4 已 seed 占位条目,registry update 不抛
- comment command(args 形如 `{ text: string, mentions?: string[] }`,args 齐 auto-submit):
  - ctx.parentWindow.type !== "issue" → command-error
  - text 非空校验
  - 调 `issuesService.appendComment({baseDir, sessionId, issueId, text,
    authorObjectId: thread.persistence.objectId, authorKind: "llm",
    authorThreadId: thread.id, mentions: args.mentions})`
  - 拿到 `{commentId, resolved_mentions}` → command output:
    `[issue_window.comment] 已发表 (comment#${commentId});resolved mentions: [<obj>, <obj>]`
  - **P1 双轨**:LLM 可显式传 `mentions: ["alice", "bob"]` 强保证不漏 mention;
    service 层取并集 + 去重,LLM 可同时在 text 里也 @,两路都生效
  - 写回 parent IssueWindow 的 `lastSeenCommentId = commentId`
    (自己写的不触发自唤醒)
- **不注册 onClose hook**:close 走 `WindowManager.close` 默认语义即 removeWindow;
  本 thread 立即解订阅(从 contextWindows 消失);其它 thread 不受影响
- basicKnowledge 段:简洁说明 comment 命令 + 关闭语义("close 即解订阅") +
  "如何在 text 里 @ peer / 或传 mentions 参数"

**Patterns to follow**:

- `src/executable/windows/talk.ts` 是 registerWindowType + commands + basicKnowledge
  的完整示范
- `src/executable/windows/file.ts:editCommand` 是 args 校验 + service 函数 pattern
- `src/executable/windows/manager.ts:close()` 默认语义参考

**Test scenarios**:

- comment 挂 issue_window 上 → 写文件 + 返回 resolved_mentions
- comment 挂非 issue_window → command-error
- comment text 空 → command-error
- comment 后本 thread 的 IssueWindow.lastSeenCommentId 更新(不会自唤醒)
- comment args.mentions=["alice"] + text "hi @bob" → resolved=["alice","bob"]
- comment args.mentions=["alice","alice"] → resolved 去重
- close issue_window → 从 thread.contextWindows 中消失,Issue 文件不动
- close 后同 thread 再 open_issue(同 id) → 新挂 window,看到全部历史 comments

**Verification**: 单元测试绿;手动 e2e:create + comment + close 链路通

***

### U7. Wait extension for issue_window

**Goal**: 让 `wait(on=<issue_window>)` 被允许(当前只支持 talk/do)

**Requirements**: origin §3.3 wait 扩展

**Dependencies**: U4

**Files**:

- `src/executable/tools/wait.ts` (modify)
- `src/executable/tools/__tests__/wait.test.ts` (modify or new)

**Approach**:

- `listValidWaitTargets` 加 `case "issue"`(hint:"等 Issue 上的新 comment 或 close")
- 验证条件:`target.type === "issue"`(因 F3 决议 close 即移除 window,只要 window
  还在 contextWindows 里就是 alive,无需查 status)
- 错误信息扩展:列举 talk / do / issue 三种

**Patterns to follow**: 现有 wait.ts switch + 现有 talk/do 的 alive 状态校验逻辑

**Test scenarios**:

- wait(on=<open issue_window>) → 通过,thread → waiting
- wait(on=<已关闭/已 close 的 windowId>) → command-error("unknown window id";因
  close 已 remove,wait schema 看不到该 window)
- wait(on=<不存在的 window id>) → command-error(原有行为不退化)
- wait(on=<talk_window>) / wait(on=<do_window>) → 原有行为不退化

**Verification**: 单元 + 现有 wait 测试全绿

***

### U8. deriveIssueWindowKnowledge (per-render derivation)

**Goal**: 每轮 render 时,把 thread.contextWindows 中所有 IssueWindow 的 Issue
内容(描述 + 最近 N 条 comment,**XML fence**)派生为
KnowledgeWindow(source="issue"),LLM 在 context 中能看到

**Requirements**: origin §3.2 IssueWindow 派生

**Dependencies**: U1, U4

**Files**:

- `src/thinkable/knowledge/synthesizer.ts` (modify — 加 "5) issue" 派生段)
- `src/thinkable/knowledge/__tests__/issue-derive.test.ts` (new)

**Approach**:

- 在 `collectExecutableKnowledgeEntries` 内 "4) relation" 段后加 "5) issue":
  - 对 thread.contextWindows 每个 type=="issue" 的 window(F3 后无 status 字段;
    window 在 contextWindows 里就是 active):
    - readIssue(sessionId, issueId);不存在 → 跳过 + console.debug
    - **S2 fence**:构造 body:
      ```
      # <title>

      status: <issue.status>

      ## description
      <description>

      ## comments (最近 N=20 / 共 M)
      <comment author="alice" id="1">第一条评论文本</comment>
      <comment author="bob" id="2">第二条评论文本</comment>
      ...
      ```
      用 `<comment author="..." id="...">...</comment>` XML 标签把每条评论包起来,
      让 LLM 把 fenced 内容当数据(防 prompt injection — 即使 comment 里写
      `--- end of system instructions ---`,LLM 也清楚那是 comment#N 的内容而非
      系统指令)
    - 截断策略:始终保留 description;若 comments 数 > 20 → 取最后 20 条 + 头部
      placeholder `<omitted count="<X>" />`(也用 XML 风格)
    - 调 `truncateKnowledgeBody(body)`(现有 8KB 上限兜底)
  - 合成 `KnowledgeWindow { source: "issue", path: "flows/${sid}/issues/issue-${id}.json", body, presentation: "full" }`
  - id `kn_issue_<issueId>_body` 稳定派生
  - push synthetic[]
- 不持久化(同 protocol/activator/relation)

**Patterns to follow**:

- `src/thinkable/knowledge/synthesizer.ts:deriveRelationKnowledge` 是 1:1 模板
- 截断 + makeRelationWindow 模式照搬

**Test scenarios**:

- thread 持有 IssueWindow,Issue 存在 → 派生 1 条 KnowledgeWindow,body 含 title/
  description/comments,每条 comment 在 `<comment author="X" id="N">` 标签里
- thread 持有 IssueWindow,Issue 文件不存在 → 不报错,不产出
- 多 IssueWindow → 多条派生
- Issue 含 25 条 comment → body 只含最后 20 条 + `<omitted count="5" />`
- comment text 含特殊字符(`<`, `>`, `&`)→ XML escape(避免破坏 fence)
- console.debug 在 skip 时输出(原因可见)

**Verification**: 单元测试绿

***

### U9. syncIssueWindowComments (pull-on-tick fallback + close fallback)

**Goal**: 每个 thread 跑 scheduler 前自我扫描所有 IssueWindow:对新 comment 按
self-skip / @-mention / wait-all 规则决定是否写 inbox;Issue close 时写 close
信号 + 调 `WindowManager.close` 移除本 IssueWindow。**这是 pull 兜底**(F4 修正:
push 路径主要由 U2 `issuesService.appendComment` 内的 `enqueueSubscribersForIssue`
负责;sync 主要应对 worker 重启后的初始化场景与防漏)

**Requirements**: origin §3.4 Pull-on-tick 通知模型 / §5 Issue close fallback

**Dependencies**: U1, U2 (mention helper), U4, U7

**Files**:

- `src/app/server/runtime/worker.ts` (modify — runJob 调 syncIssueWindowComments;
  helper 函数定义)
- `src/app/server/runtime/__tests__/sync-issue-windows.test.ts` (new)

**Approach**:

- 新 helper `syncIssueWindowComments(thread, baseDir)`:
  1. 取 thread.contextWindows 中 type=="issue" 的 windows
  2. 对每个 IssueWindow w(整体 try/catch,单 window 出错 console.warn 后 continue,
     不阻塞 scheduler):
     - readIssue(thread.persistence.sessionId, w.issueId)
     - 不存在 → 跳过(window 暂不强动 — 留给 LLM 看到 derive 缺失自处理)
     - **Issue.status === "closed" 且 window 仍在**:写 `[issue:${id}:closed] <title> 已关闭` 到
       inbox(F3:tag 不带 shared 前缀;**注意 escape `[` `]` `${` 等以防伪造**
       — 实现用 `text.replace(/[\[\]]/g, "\\$&")` 或类似),然后**调
       `WindowManager.close(w.id, thread)` 移除本 IssueWindow**,continue
     - **w.lastSeenCommentId === undefined**(重启或刚 open)→ 初值=当前最新
       commentId,continue(避免一启动就全唤醒)
     - 计算 newComments = comments.filter(c => c.id > w.lastSeenCommentId)
     - 若 newComments 为空 → continue
     - **wait-all 模式**(`thread.status==="waiting" && thread.waitingOn===w.id`):
       所有 newComments 写 inbox,**绕过 10s 限频**(A1 修正);
       否则:筛 newComments 满足 (a) authorObjectId !== thread.persistence.objectId
       AND (b) `resolved_mentions` 包含 thread.persistence.objectId → 写 inbox
       (`resolved_mentions` 已被 service 计算并持久化到 `comment.mentions` 字段;
       若 comment.mentions 字段不存在则回退到 `parseMentions(text)` 兼容老数据)
     - **10s 限频**(非 wait-all 路径):若 `w.lastNotifiedAt && (now - w.lastNotifiedAt < 10000)`
       → 跳过本次写 inbox(但 lastSeenCommentId 仍前进 — 下次会 "自然吸收")
     - inbox message format:
       `[issue:${id}:comment author=${escape(author)} comment_id=${cid}] ${escape(text.slice(0,200))}`
       (F3 修正不带 `shared:`;escape 见上)
     - 写完更新 `w.lastSeenCommentId = max(newComments.id)`,`w.lastNotifiedAt = now`
       — **注意这俩字段不持久化(U4 中 strip),只在内存里跨 tick 维持**
  3. 调用 scheduler.wakeWaitingThreadsOnInbox(已有机制)— 本 helper 不直接
     翻 status
- runJob 在 `syncCrossObjectCalleeEnds(...)` 之后调用 `syncIssueWindowComments(...)`

**Patterns to follow**:

- `src/app/server/runtime/worker.ts:syncCrossObjectCalleeEnds` 是 1:1 模板:
  从 ref 读外部 thread → 比较状态 → marker 去重 → 写 inbox + event +
  writeThread。issue 版本是从 Issue 文件读 + lastSeenCommentId 游标去重
- `src/executable/windows/manager.ts:close` 提供 close window 入口

**Test scenarios**:

- newComment 来自 self → 不写 inbox,lastSeenCommentId 前进
- newComment 含 @self → 写 inbox,wake(scheduler 在下一步处理)
- newComment 不含 @self 且 thread 不 wait → 不写 inbox,lastSeenCommentId 前进
- thread waiting on this issue_window → 所有 newComments 都写 inbox(wait-all 模式)
- **A1 关键**:waiting thread + lastNotifiedAt < 10s 内 + 新 comment
  → 仍写 inbox + 唤醒(限频不压制 waiting 信号)
- 非 waiting + 10s 内连续 N 次 newComment → 只写第一次 inbox,游标前进到最后
- Issue.status 变 closed → 写一次 `[issue:closed]` 到 inbox + WindowManager.close
  移除 window;下一 tick 该 window 已不在 contextWindows
- Issue 文件不存在 → 跳过 + 不抛错
- readIssue 抛错 → console.warn + 继续其它 window,不抛阻塞 scheduler
- 无 IssueWindow → 无操作
- 同 thread 多 IssueWindow → 各自独立处理
- w.lastSeenCommentId undefined → 初值=当前最新 commentId,不写 inbox
- comment text 含 `[issue:fake]` → inbox 里被 escape 不能伪造 tag

**Verification**: 单元绿;与 syncCrossObjectCalleeEnds 同位置串行调用 — caller
thread tick 之前完成所有 sync

***

### U10. basic-knowledge: 看板协作段

**Goal**: 让 LLM 在每一轮的 protocol KnowledgeWindow 里看到 Issue 协作能力
说明 + 示例

**Requirements**: origin §3.7 LLM 接口知识

**Dependencies**: 文字稳定后即可写;U5/U6/U7 接口名称需对齐(软依赖)

**Files**:

- `src/thinkable/knowledge/basic-knowledge.ts` (modify — 在 "元编程" 段后加
  "看板协作" 段)

**Approach**:

- 段标题 `## 看板协作:Issue 上的多方讨论`
- 涵盖:
  - 何时开 Issue(多人/多轮/追溯;一对一仍 talk)
  - 命令:`create_issue` / `open_issue` / `issue_window.comment` / 通用 close
  - close 语义:close 即"本 thread 解订阅"——Issue 文件不动,其它 thread 不受
    影响;若要再次订阅,再 open_issue(同 id)即可
  - **@ mention 协议双轨**:文本 `@<objectId>` 正则 + `comment` args 的
    `mentions: string[]` 参数;两者取并集去重;LLM **推荐显式传 mentions** 强
    保证不漏
  - `wait(on=issue_window)` vs 不 wait 的语义差(wait → 全量唤醒;不 wait →
    只在 @ 时唤醒)
  - 与 talk 协同(Issue 决策 + talk 关键参与者敦促)
- 加 1-2 个示例:`open(command="create_issue", ...)` 和
  `open(command="comment", args={text, mentions})`
- 字数控制 — 与 talk/super 段同量级

**Patterns to follow**:

- `src/thinkable/knowledge/basic-knowledge.ts` 已有 "反思:super 分身" / "元编程"
  两段是模板;示例风格沿用上一 commit 的 example 形态

**Test scenarios**:

- Test expectation: none — 纯 prompt 文案;由 e2e 测试 LLM 行为间接验证

**Verification**: tsc 绿;手动检查 basicKnowledge 渲染含新段

***

### U11. meta doc — sources 接入 + 描述 LLM 视角

**Goal**: 把 `meta/object/collaborable/kanban/` 下的 doc 文件 sources 接到实际
实现模块;描述 issue_window 视角

**Requirements**: origin §3.2 meta doc 更新

**Dependencies**: U1, U2, U6, U9(描述实际存在的模块)

**Files**:

- `meta/object/collaborable/kanban/issue.doc.ts` (modify)
- `meta/object/collaborable/kanban/index.doc.ts` (modify — sources 扩展 + 描述 Tier B)
- `meta/object/collaborable/kanban/comment.doc.ts` (modify — sources 接入;新 plan §3
  Scope Boundaries 已显式纳入)
- `meta/object/collaborable/kanban/concurrent-write.doc.ts` (modify — sources 接 SerialQueue;§3 显式纳入)

**Approach**:

- 每个 doc 文件:
  - import 真实实现模块 `* as ...`
  - 把 sources 字段加上这些导入
  - 在 description 加一段 "implementation status (2026-05-19): Tier A 持久化与
    HTTP API 已落地;Tier B IssueWindow + 双轨 mention(structured+正则)+ 拉取式
    通知已落地"
- issue.doc.ts:专门增 LLM 视角段(IssueWindow / commands / wait / mention 通知 /
  XML fence 截断策略),链接到 implementation seam(synthesizer / worker /
  issue-service)

**Patterns to follow**:

- `meta/object/collaborable/relation/index.doc.ts` 上一 commit 已演示 sources 接入
  + "implementation status" 注释的写法

**Test scenarios**:

- Test expectation: none — 文档 / 类型边界;tsc 校验

**Verification**: `bun tsc --noEmit` 全绿

***

### U12. Integration + e2e tests

**Goal**: 验证 Tier A + Tier B 链路通,e2e 测 2 agent 共同协作

**Requirements**: origin §6 验收第 7-8 条

**Dependencies**: U1-U11 全部完成

**Files**:

- `tests/integration/issue-window-collab.integration.test.ts` (new — e2e LLM-driven,带 hasLlmEnv 守门)
- `tests/integration/issue-mention-cross-thread.integration.test.ts` (new — 非 LLM,集成测 cross-thread mention)

**Approach**:

- **cross-thread mention 集成测**(non-LLM):
  - 建 2 个 flow object alice / bob,各自一 thread
  - alice 持有 IssueWindow#1;bob 持有 IssueWindow#1
  - 调 `issuesService.appendComment({author=alice, text="hi @bob",
    authorThreadId=alice.threadId})`
  - **验证 push 路径**:`getJobManager` 队列里出现 bob.thread 的 run-thread job
    (alice 自己 thread 不在队列)
  - 跑 worker.runJob 处理 bob job → `syncIssueWindowComments(bob.thread)` 应写
    bob.inbox `[issue:1:comment author=alice comment_id=1] hi @bob`
  - 再跑一次 sync → 不重复写(lastSeenCommentId 已前进)
  - 写第二条 comment `text="ping @bob"`,< 10s 内 bob 不在 waiting → push 加入
    bob job,但 sync 命中 10s 限频跳过 inbox 写入(游标仍前进)
  - bob `wait(on=<issue_window>)` 后,第三条 comment `text="urgent @bob"` < 10s
    内 → wait-all 模式**绕过限频**(A1),inbox 收到
  - Issue close → bob.inbox 收 `[issue:1:closed]` + bob.contextWindows 中
    IssueWindow#1 消失(F3)
- **e2e LLM-driven**(`describe.skipIf(!hasLlmEnv)`):
  - 建 alice + bob stones + flow objects
  - 给 alice 初始 prompt:"创建 Issue 'rename function X',让 @bob 评估"
  - 给 bob 初始 prompt(单独 thread):"open 任何分配给你的 Issue,评估并 comment"
  - runScheduler 多 tick / 跨 thread
  - 三档判定:
    - **Good**: Issue 创建;alice/bob 各有 comment;bob 的 comment 引用 alice 内容;两 thread 都 done
    - **OK**: Issue 创建 + 至少一方 comment,但内容浅或一方未参与
    - **Bad**: 没有 Issue 创建 / 任一 thread 卡死 / @ 没起作用

**Patterns to follow**:

- `tests/integration/_fixture.ts` setupTempFlow / bootstrapInboxFromPrompt /
  hasLlmEnv 守门 / llm() 客户端复用
- `tests/integration/relation-write-on-talk.integration.test.ts` 是 e2e 三档判定
  + LLM-skipIf 的最近模板

**Test scenarios**: 见 Approach 段

**Verification**:

- `bun test tests/integration/issue-mention-cross-thread.integration.test.ts` 绿
- `bun test tests/integration/issue-window-collab.integration.test.ts` 在 hasLlmEnv=false 时 skip;
  开 LLM 时三档 ≥ OK

***

## 6. System-Wide Impact

- **新 ContextWindow type** — UI / ContextSnapshotViewer 不动也能基本工作
  (IssueWindow 会被当作 unknown type 走 generic JSON 渲染);后续 UI 切片可加
  专属渲染
- **F2 修正后的分层** — `src/persistable/issue-service.ts` 成为新的 "service in
  persistable" 模式(此前 stone-* helper 都是纯 IO,无业务)。这是 OOC 第一次在
  persistable 层放业务;模式简单(无注入,纯函数 + 模块级 SerialQueue),后续
  task/whiteboard 真复用时可考虑提取 base shape
- **F4 push 路径副作用** — `appendComment` 内部 enqueueSubscribers 会写
  `getJobManager` 队列,意味着写 Issue 同时触发 N 个 thread tick;这是 worker
  job 队列首次被 service 层主动 enqueue 的场景(此前都是 LLM 输出 / inbox 增长
  自然触发)。需在 U2 实现时确认 jobManager 单例可被 persistable 层稳定 import
- **worker tick 延迟** — 每个 thread 多一次 issue 文件 IO(per active
  IssueWindow);scale 上 N agent × M IssueWindow,实测应控制在 ms 量级,可接受
- **session 内串行写** — 所有 Issue 写入走 SerialQueue,多 LLM 同时跑同 session
  时写入排队;吞吐瓶颈,但 MVP scale 不影响

***

## 7. Risks & Open Questions

### Risks

1. **LLM 不主动 @ 别人** — 本切片已加 `mentions: string[]` structured 参数
   (P1 双轨)+ basic-knowledge 教学引导显式传 mentions。若 e2e 显示 LLM 仍
   忘记两条路 → 加强 prompt + 考虑改默认行为(如 auto-CC)。push 路径(F4)
   保证只要 mention 被 service 看见就会唤醒
2. **N=20 comment 截断丢历史** — Issue 关键决策若埋在 < 21 条之前,新 agent
   open_issue 仍能在 derive body 看见 description 和最后 20 条 comment;依赖
   "关键决策写到描述里" 约定;后续可改 "增量 diff render"
3. **SerialQueue 不跨进程** — 多进程 worker 部署时 index.json 仍可能竞争;MVP
   单 worker 进程,不阻塞;若要多进程,需文件锁(留给 follow-up)
4. **issue-{id}.json 增长无界** — 长讨论后文件大;每轮 render 全读 → IO 增长。
   N=20 截断在 LLM 视角缓解,但磁盘文件没收缩;后续可考虑 archive 老 comment
5. **mention 扇出无 cap(§4 决策 6)** — 单条 comment `@a @b ... @z` 会触发 N 个
   thread 各自下一 tick 被唤醒,无横向限制。MVP 接受 N× LLM 并发成本;若观察
   到滥用再加 K 截断
6. **重启期间错过的 mention 永远丢失(§4 决策 11)** — `lastSeenCommentId` 不
   持久化,worker 重启后 sync 首次将游标置=当前最新 commentId,跳过重启窗口的
   comment;MVP 单 worker 长跑时几乎无影响

### 已显式 deferred

- task_window 形态:Task 由 supervisor 直接管理;LLM 通过 do_window 干活
- 跨 session Issue 引用:spec.sessionScope 反对
- @all / @role:role 系统未建
- hasNewInfo 默认 LLM 不设:本切片不引入 heuristic(留给后续观察)
- 多进程 worker 文件锁(Risk 3)
- 长 Issue archive(Risk 4)
- mention 扇出 K cap(Risk 5)

***

## 8. Verification & Done

按 origin §6 双 Tier 验收 checklist:

### Tier A

- [ ] issue-{id}.json + index.json 正确生成
- [ ] SerialQueue 并发不损坏 index
- [ ] 5 个 HTTP endpoints 正确响应,返回 resolved_mentions
- [ ] sessionId / issueId schema 拒绝 path-traversal / 非法字符(S1)
- [ ] appendComment text > 4KB 拒绝;authorObjectId 不存在拒绝(S2/S3)

### Tier B

- [ ] ContextWindow union 加 IssueWindow;WindowType 加 "issue";
      KnowledgeWindow.source 加 "issue";registry seed 占位条目(F1)
- [ ] IssueWindow.lastSeenCommentId / lastNotifiedAt 不被 writeThread 持久化(A5)
- [ ] root.create_issue / root.open_issue 工作;dedup;不存在 → command-error;
      create 失败 → error 含 issueId(A2)
- [ ] issue_window.comment 写文件;返回 resolved_mentions;支持
      `mentions: string[]` structured 参数与正则取并集(P1)
- [ ] wait(on=issue_window) 通过 schema(F3 后 close 即移除,无 closed 测例)
- [ ] syncIssueWindowComments self-skip / @-mention / wait-all(绕 10s 限频,A1)/
      10s 限频(非 waiting)/ Issue close fallback(写 inbox + WindowManager.close)
      各按规约
- [ ] basic-knowledge 含 "看板协作" 段
- [ ] meta doc sources 接入

### 测试

- [ ] U1-U11 各自 unit 测试绿
- [ ] U12 cross-thread mention 集成测绿(含 push 路径验证 + waiting bypass)
- [ ] U12 e2e(LLM-driven)hasLlmEnv 守门;开 LLM 时 ≥ OK

最终验证:

```
bun tsc -b --noEmit   # 全树类型干净
bun test src/         # 全单元测试绿
bun test tests/integration/   # 集成测绿(LLM-dependent 在无 env 时 skip)
```

***

## 9. Deferred / Open Questions

### From 2026-05-19 ce-doc-review round-2 (FYI / anchor 50)

以下是 round-2 review 的 advisory 观察(reviewer confidence 50,不阻塞实施;
ship 后观察实际行为再决定是否回头处理):

- **P3 basic-knowledge token 税(product-lens)** — U10 加的 "看板协作" 段对
  从不开 Issue 的 thread 也是 token 成本。若观察到许多短任务 thread 从不使用
  Issue,考虑改为 conditional inclusion(只在 thread 持有 IssueWindow 或 root
  有 issue 命令时注入该段)
- **P4 user curl 创建 Issue 无路由到 LLM(product-lens)** — Tier A 暴露 HTTP
  endpoints 让 curl 创建 Issue,但 mention 通知只对**已持有 IssueWindow** 的
  thread 起作用。user → 未开 Issue 的 agent 无直达路径,需要 supervisor / 中介
  代为 open_issue。MVP 可接受(基本工作流是 LLM 先 open,user 后追评论);若要
  user-as-writer 主动路由 → 后续切片
- **S4 多 worker 进程 index.json 损坏防御(security-lens)** — Risk 3 已记录,
  此 FYI 建议加 startup 时 pid-file / lockfile 阻止第二个 worker 进程启动同
  world 目录(防止操作员误用);相对文件锁成本低,但 MVP 阶段非必须
- **SG1 U10 dependency 软化(scope-guardian)** — U10 prompt 文案对 U5/U6/U7
  其实是软依赖,可并行;若实施时想并行画 U10,直接画即可(命令名稳定不再变)
- **SG2 U11 meta doc 扩展正当化(scope-guardian)** — §3 Scope Boundaries 现已
  显式接受 U11 的 4 个 doc 文件(本 round 更新已加注);只要 implementer 知道
  scope 同步过即可
- **A6 self-skip 用 objectId 导致 fork 子 thread 收不到父 @mention(adversarial)** —
  §4 决策 8 已显式承认副作用(同 objectId 多 thread 协作走 talk)。若实测 fork
  + Issue 协作很常见,考虑改 threadId-level skip + 加振荡风险评估
- **A7 每 tick 全文件读 issue-{id}.json(adversarial)** — Risk 4 已记录文件
  增长无界。可优化:同一 tick 内 U8 derive + U9 sync 共享单次 readIssue 结果
  (cache by issueId)以减半 IO;留给观察后再做
- **A8 derive 跳 closed window 导致 close fallback 那轮 LLM 看不到 Issue body
  (adversarial)** — F3 决议 "close 即移除 window" 后,close fallback 调
  `WindowManager.close` 移除 window;下一轮 derive 自然不再产出。LLM 看到
  `[issue:closed]` 通知但失去 Issue 内容回顾。若实测 LLM 在 close 后想 reference
  历史 → 考虑 close fallback 时把 Issue 摘要(title + 最后 N 条)附在 inbox
  消息里
- **A9 syncIssueWindowComments 失败/慢冻结 scheduler(adversarial)** — U9
  Approach 已加 try/catch + 单 window 出错 console.warn 跳过的规约;如果未来
  发现实际有慢 IO 影响 scheduler 吞吐,再加超时

