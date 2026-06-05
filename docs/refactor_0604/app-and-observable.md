# observable + app/server 联合自审方案

> 撰写人：AgentOfObservable + AgentOfAppServer（联合发言人）
> 日期：2026-06-04
> 对齐总纲：docs/refactor_0604/ (A/F 对齐)

---

## 1. 我们是谁

### observable/ 模块

- **定位**：OOC 八大能力维度之一——`observable`。负责观测 LLM 运行时状态（输入/输出快照、loop debug 文件落盘、pause 判断、权限决策注入、线程激活通知、window content hash 计算）。
- **维度**：`observable`（AgentOfObservable 归口）。
- **核心能力**：
  - `beginLlmLoop / finishLlmLoop`：LLM loop 的生命周期打点，写入 llm.input / llm.output / loop_NNNN.*.json debug 文件。
  - `LlmObservation`：最近一轮 LLM 输入/输出的内存快照（供 debug panel / tests spy 查看）。
  - `PauseChecker / RuntimePermissionDecider / ThreadActivationNotifier`：三个运行时注入点（由 app/server 在 buildServer 时挂载）。
  - `window-hash`：ContextWindow 的 content hash 计算与 fileDiff 派生（供 loop timeline diff view）。

### app/server/ 模块

- **定位**：OOC HTTP 控制面。Elysia 服务端，负责对外暴露 REST API、管理 World 资源、调度 worker 运行 thinkloop、boot 启动迁移、版本化 stone 写入。
- **维度**：横切维度——不属于八大能力维度均通过 server 对外暴露；自身属于 `infrastructure / control-plane`。
- **核心能力**：
  - `buildServer(config)`：构造 Elysia 实例，挂载各业务 module（health / runtime / stones / ui / world-config）。
  - `worker`：轮询 jobManager，驱动 `runScheduler` 推进 thread。
  - `job-manager`：线程级任务队列（run-thread / resume-thread）。
  - `pause-store`：全局 / session 级暂停控制。
  - `bootstrap/*`：启动期自检与历史数据迁移（pool-migration / flow-children / state-context-split / recovery-check / stale-database-dir）。
  - `modules/*`：各业务域 API（见 2.2）。

### 两者关系

observable 是 app/server 的下游——app/server 在 buildServer 时把 runtime 注入点挂到 observable：

- `setPauseChecker` → 由 `config.pauseStore` 驱动（`app/server/index.ts:185-188`）。
- `setThreadActivationNotifier` → 桥接 `config.jobManager.createRunThreadJob` + lark forward（`app/server/index.ts:196-205`）。
- `modules/runtime/service.ts` 直接 import `enableDebug / disableDebug / getDebugStatus / notifyThreadActivated` 等 observable 导出（`modules/runtime/service.ts:3-8`）。
- observable 的 debug 文件落盘由 persistable 提供底层能力，persistable 被 observable 和 app/server 都消费。

两者共同承担了 **"运行时调度 + 观测"** 的协同：observable 是"被调度逻辑容器"，app/server 是"调度执行器 + API 网关"。

---

## 2. 我们有什么（符号全景）

### 2.1 observable/

| 文件 | 导出符号 | 一句话 |
|------|---------|--------|
| `observable/index.ts` | `type LlmObservation, LlmLoopHandle, ObservableDebugStatus, PauseChecker, RuntimePermissionDecision, RuntimePendingToolCall, RuntimePermissionDecider, ThreadActivationRef, ThreadActivationNotifier, ObservableStore`（type re-export）；`createObservableStore`；`enableDebug, disableDebug, getDebugStatus, setPauseChecker, isPausing, setPermissionDecider, getPermissionDecider, setThreadActivationNotifier, notifyThreadActivated, clearLatestLlmObservation, clearObservableDebugState, getLatestLlmObservation`（thin wrapper 到 defaultObservableStore）；`writeLatestLlmInput, writeLatestLlmOutput, beginLlmLoop, finishLlmLoop`（module-level 实现，bun:test spyOn 技术债——不可迁到 class） | thin deprecated 模块级观测入口；**核心实现在 runtime/observable-store.ts**；BEGIN_LLM_LOOP 两套重复实现为 spy |
| `observable/window-hash.ts` | `type FileDiffData, WindowSnapshotEntry`；`stripVolatileWindow, computeWindowContentHash, buildWindowsSnapshot` | ContextWindow content hash 计算 + file_window diff 派生（debug-only） |
| `runtime/observable-store.ts`（核心实现） | `type LlmLoopHandle, LlmObservation, ObservableDebugStatus, PauseChecker, RuntimePermissionDecision, RuntimePendingToolCall, RuntimePermissionDecider, ThreadActivationRef, ThreadActivationNotifier`；`class ObservableStore`（per-world 实例）；`defaultObservableStore`（单例）；`createObservableStore` | per-world 观测与运行时注入状态容器；beginLlmLoop/finishLlmLoop 与 observable/index.ts 重复实现 |

### 2.2 app/server/

#### 顶层

| 文件 | 导出符号 | 一句话 |
|------|---------|--------|
| `app/server/index.ts` | `buildServer(config)`（核心） | Elysia 服务装配 + 错误归一 + worker 启动 + bootstrap 迁移 |
| `app/server/bootstrap/config.ts` | `interface ServerConfig`；`readServerConfig()` | 读取启动配置（env/argv/.world.json），构造 ServerConfig（port/baseDir/worker/pause/jobManager） |
| `app/server/bootstrap/errors.ts` | `class AppServerError` | 统一错误模型（code/message/details） |
| `app/server/bootstrap/hash.ts` | `hashJson(value)` | JSON 值的稳定 SHA-1 hash（前端"内容未变就别重渲染"） |
| `app/server/bootstrap/recovery-check.ts` | `interface RecoveryCheckResult, BrokenObject`；`runRecoveryCheck()` | 启动期遍历 stones/main/objects/*/server/index.ts，加载失败的开 [recovery-needed] PR-Issue |
| `app/server/bootstrap/check-pool-migration.ts` | `interface PoolMigrationCheckResult`；`checkStoneToPoolMigration()`；`reportPoolMigration()` | 扫描 stone 侧错位 sediment（knowledge/memory,relations/ + files/）警告 |
| `app/server/bootstrap/check-stale-database-dir.ts` | `interface StaleDatabaseDirCheckResult`；`scanStaleDatabaseDir()`；`reportStaleDatabaseDir()`；`checkStaleDatabaseDir()` | 扫描 stone 侧残留 database/ 子目录 advisory |
| `app/server/bootstrap/check-flow-children-migration.ts` | `checkFlowChildrenMigration()` | flow 子 object 从 flat 嵌套迁到 children/ marker（与 stone 对齐） |
| `app/server/bootstrap/check-state-context-split.ts` | `checkStateContextSplit()` | state (object dim) vs context (thread dim) 拆分迁移（import `../../../../../../scripts/` 跨 6 层） |
| `app/server/bootstrap/migrate-stone-knowledge-to-pool.ts` | `interface MigrateOptions, MigrateReport`；`migrateStoneKnowledgeToPool()` | 一次性 CLI 迁移脚本（stone knowledge/files → pool），344 行 |

#### runtime/（运行时内核）

| 文件 | 导出符号 | 一句话 |
|------|---------|--------|
| `app/server/runtime/types.ts` | `interface RuntimeJobInput, RuntimeJob` | job 类型定义（kind/status/statusReason） |
| `app/server/runtime/job-manager.ts` | `createJobManager()`（返回 createRunThreadJob/createResumeThreadJob/listJobs/getJob/updateJob/tryClaimQueuedJob） | 内存 Map 实现的 FIFO 任务队列 + 原子 claim |
| `app/server/runtime/pause-store.ts` | `interface PauseStore`；`createPauseStore()` | 全局 pause + session 级 pause 的内存状态 |
| `app/server/runtime/thread-transition.ts` | `canResumeThread()`；`applyInjectTransition()`；`applyResumeTransition()` | ThreadContext 状态机（paused→running、inject→running）翻转 |
| `app/server/runtime/thread-query.ts` | `scanPausedThreads()`；`scanRunningThreads()` | 递归扫 flows/<sid>/ 下所有 object 的 threads/，按 status 过滤 |
| `app/server/runtime/resume.ts` | `resumePausedThread()` | 从 paused 恢复：读 llm.output.json → dispatchToolCall → writeThread |
| `app/server/runtime/worker.ts` | `interface RuntimeJobResult, RuntimeJobRunner`；`runJob()`；`processQueuedJobs()`；`enqueueRunningThreadsAtBootstrap()`；`startJobWorker()`；**内部函数 syncCrossObjectCalleeEnds()（~70 行，跨 object callee end → caller 唤醒）** | worker 主循环：claim job → runScheduler → 终态对账；内联跨 object talk 结束唤醒；scheduler yield 自入队；bootstrap 恢复 |

#### modules/

##### modules/health

| 文件 | 导出符号 | 一句话 |
|------|---------|--------|
| `modules/health/index.ts` | `healthModule` (Elysia) | /api/health 模块装配 |
| `modules/health/api.health.ts` | `healthApi` (Elysia) | GET /api/health → {ok, service, time} |

##### modules/runtime（⚠ 命名与 runtime/ 内核冲突）

| 文件 | 导出符号 | 一句话 |
|------|---------|--------|
| `modules/runtime/index.ts` | `runtimeModule(config)`（Elysia factory） | /api/runtime/* 路由装配 |
| `modules/runtime/model.ts` | `threadDebugParams, loopDebugParams` (typebox schemas)；`type LoopMeta, LoopListEntry, ListLoopsResponse`；`RuntimeModel` (response schemas) | runtime API 的类型 + typebox schema |
| `modules/runtime/service.ts` | `interface RuntimeService`；`createRuntimeService()`（返回 getLlmConfig/listJobs/getJob/enableGlobalPause/disableGlobalPause/.../decidePermission/getLoopDebug/listLoops） | runtime API 的业务逻辑：LLM config / 配置 / debug 文件读 / HITL 权限审批，371 行 |
| `modules/runtime/api.enable-debug.ts` | `enableDebugApi(service)` | POST /api/runtime/debug/enable |
| `modules/runtime/api.disable-debug.ts` | `disableDebugApi(service)` | POST /api/runtime/debug/disable |
| `modules/runtime/api.get-debug-status.ts` | `getDebugStatusApi(service)` | GET /api/runtime/debug/status |
| `modules/runtime/api.enable-global-pause.ts` | `enableGlobalPauseApi(service)` | POST /api/runtime/global-pause/enable |
| `modules/runtime/api.disable-global-pause.ts` | `disableGlobalPauseApi(service)` | POST /api/runtime/global-pause/disable |
| `modules/runtime/api.get-global-pause-status.ts` | `getGlobalPauseStatusApi(service)` | GET /api/runtime/global-pause/status |
| `modules/runtime/api.get-job.ts` | `getJobApi(service)` | GET /api/runtime/jobs/:jobId |
| `modules/runtime/api.list-jobs.ts` | `listJobsApi(service)` | GET /api/runtime/jobs |
| `modules/runtime/api.get-latest-debug.ts` | `getLatestDebugApi(service, baseDir)` | GET /api/runtime/flows/:sid/:oid/threads/:tid/debug |
| `modules/runtime/api.get-loop-debug.ts` | `getLoopDebugApi(service, baseDir)` | GET .../debug/loops/:loopIndex |
| `modules/runtime/api.list-loop-debug.ts` | `listLoopDebugApi(service, baseDir)` | GET .../debug/loops（列表） |
| `modules/runtime/api.get-llm-config.ts` | `getLlmConfigApi(service)` | GET /api/runtime/llm-config |
| `modules/runtime/api.permission-decision.ts` | `permissionDecisionApi(service, baseDir)` | POST .../permission：HITL approve/reject |

##### modules/stones

| 文件 | 导出符号 | 一句话 |
|------|---------|--------|
| `modules/stones/index.ts` | `stonesModule(config, runtime)`（Elysia factory） | /api/stones/* 路由装配 |
| `modules/stones/model.ts` | `objectIdParams, createStoneBody, textBody, codeBody, knowledgeDirectoryBody, knowledgeFileBody, callMethodBody` (typebox schemas) | stones API 请求/响应 typebox schema |
| `modules/stones/service.ts` | `createStonesService()`（返回 listStones/createStone/getStone/getSelf/putSelf/getReadme/putReadme/getServerSource/putServerSource/createKnowledgeDirectory/createKnowledgeFile/putKnowledgeFile/callMethod） | stones CRUD + knowledge CRUD + server method 调用 + git versioning，348 行 |
| `modules/stones/versioning-helper.ts` | `interface HttpWriteOk, HttpWriteErr, WriteContext, WrapHttpWriteInput`；`wrapHttpWriteInWorktree()` | HTTP stone 写入 git versioning 薄适配层（→ persistable.versionedStoneWrite） |
| `modules/stones/api.list-stones.ts` | `listStonesApi(service)` | GET /api/stones |
| `modules/stones/api.create-stone.ts` | `createStoneApi(service)` | POST /api/stones |
| `modules/stones/api.get-stone.ts` | `getStoneApi(service)` | GET /api/stones/:objectId |
| `modules/stones/api.get-self.ts` | `getSelfApi(service)` | GET /api/stones/:objectId/self |
| `modules/stones/api.put-self.ts` | `putSelfApi(service)` | PUT /api/stones/:objectId/self |
| `modules/stones/api.get-readme.ts` | `getReadmeApi(service)` | GET /api/stones/:objectId/readme |
| `modules/stones/api.put-readme.ts` | `putReadmeApi(service)` | PUT /api/stones/:objectId/readme |
| `modules/stones/api.get-server-source.ts` | `getServerSourceApi(service)` | GET /api/stones/:objectId/server-source |
| `modules/stones/api.put-server-source.ts` | `putServerSourceApi(service)` | PUT /api/stones/:objectId/server-source |
| `modules/stones/api.create-knowledge-directory.ts` | `createKnowledgeDirectoryApi(service)` | POST /api/stones/:objectId/knowledge/directory |
| `modules/stones/api.create-knowledge-file.ts` | `createKnowledgeFileApi(service)` | POST /api/stones/:objectId/knowledge/file |
| `modules/stones/api.put-knowledge-file.ts` | `putKnowledgeFileApi(service)` | PUT /api/stones/:objectId/knowledge/file |
| `modules/stones/api.call-method.ts` | `callMethodApi(service)` | POST /api/stones/:objectId/call-method |

##### modules/ui

| 文件 | 导出符号 | 一句话 |
|------|---------|--------|
| `modules/ui/index.ts` | `uiModule(config)`（Elysia factory） | /api/ui/* 路由装配 |
| `modules/ui/model.ts` | `treeQuery, fileQuery, anyFileQuery` (typebox schemas)；`type TreeScope, UiTreeNode` | tree/file 浏览 model + schema |
| `modules/ui/service.ts` | `createUiService()`（返回 getTree/getFile/readAnyFile/listFlows） | tree 浏览 + file 读（world 隔离 + 任意路径读 + flows 轻量列表），213 行 |
| `modules/ui/api.get-tree.ts` | `getTreeApi(service)` | GET /api/tree |
| `modules/ui/api.get-file.ts` | `getFileApi(service)` | GET /api/tree/file |
| `modules/ui/api.read-any-file.ts` | `readAnyFileApi(service)` | GET /api/file/read（world 外任意路径，dev-only） |
| `modules/ui/api.list-flows.ts` | `listFlowsApi(service)` | GET /api/flows（轻量 session 目录列表） |
| `modules/ui/api.list-window-types.ts` | `listObjectTypesApi()`；内部 `extractBasicDescription()`（70+ 行）；`type ObjectMethodEntry, ObjectTypeCatalogEntry` | GET /api/windows/_shared/types + /api/objects/_shared/types — 列出所有已注册 object type 与其 commands 的 basic description |
| `modules/ui/api.client-source-url.ts` | `clientSourceUrlApi(config)` | GET /api/objects/:scope/:objectId/client-source-url — stone/flow 的前端 client 源码绝对路径 + /@fs URL |

##### modules/world-config

| 文件 | 导出符号 | 一句话 |
|------|---------|--------|
| `modules/world-config/index.ts` | `worldConfigModule(config)`（Elysia factory） | GET /api/world/config — siteName/hasExternalSkills/hasLarkBot/larkTenantHost |

---

### 2.3 缺失模块

`app/server/index.ts` 第 14、16 行 import：

```typescript
import { poolsModule } from "./modules/pools";   // ← modules/pools/ 目录不存在
import { flowsModule } from "./modules/flows";   // ← modules/flows/ 目录不存在
```

当前 `modules/` 下实际只有 `health / runtime / stones / ui / world-config`，**缺少 pools 与 flows 两个模块目录完全缺失**，但 buildServer 第 222、224 行仍在 `.use(poolsModule(config))` / `.use(flowsModule(config))`，运行时会因为模块不存在导致编译错误或 import 失败。

---

## 3. 哪些不属于我们 / 哪些做得不好

### 3.1 observable 侧

#### (1) 名存实亡：核心逻辑在 runtime/observable-store.ts，observable/index.ts 是 thin wrapper，但 `beginLlmLoop / finishLlmLoop` 在 observable/index.ts:125-215 与 runtime/observable-store.ts:231-313 **两套完全重复的实现**

- 重复原因注释写明：bun:test `spyOn(module, "fn")` 要求调用经过真正的模块导出才能被拦截。见 observable/index.ts:7-10, 77-79, 119-124, 158-163。
- observable-store.ts 的 ObservableStore 类也有完整的 beginLlmLoop/finishLlmLoop/writeLatestLlmInput/writeLatestLlmOutput，但 observable/index.ts 又在 module-level 重复实现一份。
- **两套实现几乎逐行一致**（byteLength helper 函数、normalizeInputItems + writeDebugInput + writeLoopDebugInput 等逻辑完全相同）。
- observable/index.ts:1-10 注释明确标注 `@deprecated (M1 2026-06-02)`，但实际上 module-level 的实现仍在，且被大量测试 spyOn 依赖，无法删除。
- 这是**明确的技术债**：同一逻辑两套实现，修改时容易改一处忘改另一处。

#### (2) 15+ 处 console.* 散落在 executable/thinkable/，不通过 observable，与 debugEnabled 不联动

实锤（非测试、非 sandbox 注释、非 sandbox/console 自身）：

| # | 文件:行号 | 内容 |
|---|-----------|------|
| 1 | `thinkable/knowledge/activator.ts:99` | `console.warn(...)` — trigger parse 失败 |
| 2 | `thinkable/knowledge/activator.ts:108` | `console.warn(...)` — activator 激活失败 |
| 3 | `thinkable/knowledge/loader.ts:168` | `console.warn(...)` — sediment/seed 冲突 |
| 4 | `thinkable/knowledge/loader.ts:207` | `console.warn(...)` — knowledge 文件读失败 |
| 5 | `thinkable/knowledge/loader.ts:213` | `console.warn(...)` — trigger 解析失败 |
| 6 | `thinkable/knowledge/synthesizer.ts:93` | `console.debug(...)` — synthesize 进度 |
| 7 | `thinkable/knowledge/synthesizer.ts:147` | `console.debug(...)` — synthesize 结果 |
| 8 | `thinkable/llm/providers/claude.ts:104` | `console.error(...)` — LLM 响应非 JSON |
| 9 | `thinkable/context/protocol.ts:161` | `console.warn(...)` — protocol inject 失败 |
| 10 | `executable/windows/_shared/manager.ts:806` | `console.warn(...)` — writeThreadContext 失败 |
| 11 | `executable/windows/_shared/manager.ts:820` | `console.warn(...)` — createFlowObject 失败 |
| 12 | `executable/windows/_shared/manager.ts:826` | `console.warn(...)` — writeRuntimeObjectState 失败 |
| 13 | `executable/windows/_shared/manager.ts:853` | `console.warn(...)` — registry update 失败 |
| 14 | `executable/windows/_shared/manager.ts:858` | `console.warn(...)` — writeThreadContext 失败 |
| 15 | `executable/windows/_shared/manager.ts:902` | `console.warn(...)` — metaprog 异常 |
| 16 | `executable/windows/_shared/manager.ts:911` | `console.warn(...)` — fork 失败 |
| 17 | `executable/windows/_shared/manager.ts:967` | `console.warn(...)` — registry remove 失败 |
| 18 | `executable/windows/_shared/manager.ts:975` | `console.warn(...)` — deleteRuntimeObject 失败 |
| 19 | `observable/window-hash.ts:147` | `console.warn(...)` — fileDiff readFile 失败 |
| 20 | `runtime/observable-store.ts:143` | `console.warn(...)` — thread-activation notifier throw |

以上 20 处中 18 处不在 observable 管控范围内，**不与 `debugEnabled` 开关完全无关** —— debug 关了照样打。

#### (3) window-hash.ts 不纯（直接磁盘 IO）

- `observable/window-hash.ts:22` `import { readFile } from "node:fs/promises";`
- `computeFileDiff()`（window-hash.ts:122-159）直接 `readFile(path, "utf8")` 读磁盘。
- observable 作为"观测"维度不应做磁盘 IO 属于越权。fileDiff 逻辑本质是"debug 视角的内容读 file_window 的 diff"，应该由 persistable（负责磁盘读写）——fileDiff 是 debug 派生数据，IO 应由 persistable 或专门的 file-io 层提供。
- 同时 `window-hash.ts:147` 有 `console.warn` 裸输出，也绕过 observable 统一日志通道。

#### (4) RuntimePermissionDecider / ThreadActivationNotifier 语义更像 runtime 通用能力

- `RuntimePermissionDecider`（observable-store.ts:69-72）是"运行时权限审批回调"，放在 observable 里语义不对——权限决策是 executable + thinkable 的横切能力，不属于"观测"（只应该观测，不该持有权限决策注入点）。
- `ThreadActivationNotifier`（observable-store.ts:79）是"线程激活通知回调"，实际是调度器事件总线的一部分，与"观测"无关。
- `PauseChecker`（observable-store.ts:55）同理——pause 是运行时控制，非观测。

这三个注入点是 runtime/scheduler 通用抽象，错放在 observable 命名空间下。

### 3.2 app/server 侧

#### (1) `app/server/runtime/` vs `modules/runtime/` 命名冲突

- `app/server/runtime/` 是**运行时内核**（worker/job-manager/pause-store/thread-query/thread-transition/resume/types）。
- `app/server/modules/runtime/` 是**runtime API 暴露层**（debug/global-pause/jobs/permission）。
- 同名 `runtime` 两个目录，一个是内核、一个是 API，造成 import 时极易混淆。
- 例如 `modules/runtime/index.ts:3-4` `import { createJobManager } from "../../runtime/job-manager";` —— 语义上是"从 runtime 导入 runtime"，读起来绕。

#### (2) pools / flows 模块缺失

- `app/server/index.ts:14` `import { poolsModule } from "./modules/pools";` — 不存在。
- `app/server/index.ts:16` `import { flowsModule } from "./modules/flows";` — 不存在。
- `app/server/index.ts:222` `.use(poolsModule(config))`。
- `app/server/index.ts:224` `.use(flowsModule(config))`。
- modules/ 下无 pools/ flows/ 目录。build 会报错。

#### (3) worker.ts 职责过重，尤其 `syncCrossObjectCalleeEnds` 70 行应在 talk/delivery 层

- `app/server/runtime/worker.ts:252-322` `syncCrossObjectCalleeEnds()`：约 70 行。
- 职责：扫 caller 的 talk_window 列表，读跨 object callee 的 thread 状态，若 done/failed 则写 inbox message + 翻 running。
- 这是 **cross-object talk delivery 语义的一部分**，不应由 worker 兜底实现。正确位置应在 collaborable（talk delivery）层作为主动通知，而不是 worker 被动扫。
- 同时 `worker.ts` 还承担：
  - `runJob`（42-107）：读 thread → syncCrossObjectCalleeEnds → runScheduler → scheduler_yielded 自入队 → 终态对账。
  - `processQueuedJobs`（109-160）：并行 claim + runner + 对账。
  - `enqueueRunningThreadsAtBootstrap`（170-192）：启动期 fs 扫。
  - `maybeMarkInterrupted`（209-233）：中断 thread 标记。
  - `startJobWorker`（324-345）：setInterval 主循环。
  - `listSessionIds`（194-201）：辅助。

单文件 347 行，6 个导出 + 2 个内部函数，职责过重。

#### (4) `ui/api.list-window-types.ts` 的 `extractBasicDescription` 70+ 行逻辑下沉

- `modules/ui/api.list-window-types.ts:70-101` `extractBasicDescription()`：
  - 构造 stubForm（line 72-77）。
  - 构造 change event（line 78-84）。
  - 构造 intents（line 85-86）。
  - 调 `entry.onFormChange(change, { form, intents })`（line 88-89）。
  - 过滤 guidance window、取 `/basic` 结尾 title、兜底最长 content（line 93-100）。
- 这是 **executable/windows 的 window definition 派生的知识提取逻辑**，放在 UI API route 文件内。
- 应下沉到 executable/windows/_shared/ 或独立 helper，让非 UI 层也可复用（例如 supervisor 在 think 时需要 method description）。

#### (5) thread-transition + resume 是 ThreadContext 状态机，应在 thinkable/

- `app/server/runtime/thread-transition.ts:10-39`：`canResumeThread / applyInjectTransition / applyResumeTransition`。
- `app/server/runtime/resume.ts:18-55`：`resumePausedThread`。
- 这两个文件是 ThreadContext 的状态机逻辑（paused ↔ running，inject 追加 events），属于 thinkable（思考维度的线程状态管理），错放在 app/server/runtime/。
- resume.ts:46 `dispatchToolCall` 直接 import executable，进一步说明这是业务逻辑而非 HTTP 控制面。

#### (6) bootstrap/check-state-context-split.ts 跨 6 层 `../` import scripts/

- `app/server/bootstrap/check-state-context-split.ts:18`：
  ```typescript
  import { runMigration } from "../../../../../../scripts/migrate-state-context-split";
  ```
- 从 `packages/@ooc/core/app/server/bootstrap/` 向上 6 层到仓库根 scripts/，打破了 packages/@ooc/core 与 scripts/ 的包边界。
- 迁移脚本应放在仓库根 scripts/，app/server bootstrap 通过相对路径跨包 import，破坏模块化。

#### (7) pause 两套抽象

- 一套在 `app/server/runtime/pause-store.ts`（`createPauseStore`，全局 + session 级）。
- 一套在 `runtime/observable-store.ts` 的 `PauseChecker`（observable 注入点，由 app/server 用 pauseStore 桥接）。
- app/server/index.ts:185-188：
  ```typescript
  setPauseChecker((thread) => {
    return config.pauseStore.isGlobalPauseEnabled() || (sessionId ? config.pauseStore.isSessionPaused(sessionId) : false);
  });
  ```
- observable 侧 PauseChecker 是函数式注入，runtime/pause-store 是对象式状态。两套抽象通过一层桥接，概念重复。

#### (8) "0.0.0.0" 硬编码

- `app/server/index.ts:338`：
  ```typescript
  buildServer(config).listen({ port: config.port, hostname: "0.0.0.0" });
  ```
- `app/server/index.ts:339`：
  ```typescript
  console.log(`[ooc-app-server] listening on 0.0.0.0:${config.port}`);
  ```
- hostname 应该从 config 读取，不应硬编码。部署场景（container / local / cloud）不同，需求不同。

---

## 4. 理想的我们

### observable 合并进 runtime；runtime 改名 scheduler

当前 observable/ 的定位调整后：

- **observable/index.ts 保留为对外兼容 re-export，但内容全部迁移。
- runtime/observable-store.ts 的 **observable 能力（LlmObservation、debug 文件落盘、window-hash）合并进 **runtime/**（新命名为 **scheduler/**）。
- runtime/ 改名为 **scheduler/**。
  - 原因：现有 runtime/ 实际承担的是"线程调度"（worker + job queue + pause + thread state + resume），"scheduler" 命名更准确。
  - 原来的 modules/runtime/ 改名为 **modules/debug/**（因为它主要暴露 debug/global-pause/jobs/permission——都是调试与运行时调试与运行时 observability API）。
- window-hash.ts 剥离磁盘 IO 去掉，fileDiff 的 readFile 交给 persistable 层或新建 file-io helper，window-hash 只做纯 hash 计算。
- PauseChecker / RuntimePermissionDecider / ThreadActivationNotifier 从 observable 类型定义中剥离，进入 scheduler/ 独立类型定义。
- console.* 全部进入统一日志通道（与 debugEnabled 联动）。
- beginLlmLoop/finishLlmLoop 两套实现合一（解决 bun:test spyOn 技术债，通过重构测试用 mock class 方法或改用其他手段）。

### 补齐 pools/flows

- 新建 `app/server/modules/pools/`：pools CRUD API（pool knowledge/files/data 读写，与 stones 对称）。
- 新建 `app/server/modules/flows/`：flows CRUD API（session/object/thread 列表、状态、暂停、恢复、thread events 读写）。

### worker.ts 拆分

- `syncCrossObjectCalleeEnds`：移入 `collaborable/talk-delivery` 层主动通知（caller end → callee end 时主动 notify）。
- `resumePausedThread`：移入 thinkable/ 或独立的 thread-state-machine。
- `maybeMarkInterrupted`：移入 thinkable/recovery。
- worker 主循环精简为：claim → runScheduler → 对账。

### 重构后目录结构（目标态）

```
packages/@ooc/core/
├── scheduler/              # 原名 runtime/ + observable 合并
│   ├── index.ts            # 对外入口
│   ├── observable-store.ts # per-world 观测（合并 observable/）
│   ├── window-hash.ts      # 纯 hash（去掉磁盘 IO）
│   ├── types.ts            # job/thread 类型
│   ├── job-manager.ts
│   ├── pause-store.ts
│   ├── worker.ts           # 精简后
│   ├── thread-query.ts
│   └── world-runtime.ts
│
├── thinkable/
│   └── thread-state/       # 从 runtime/ 剥离
│       ├── thread-transition.ts
│       └── resume.ts

app/server/
├── index.ts
├── bootstrap/
│
└── modules/
    ├── health/
    ├── debug/              # 原名 runtime/（debug/global-pause/jobs/permission API）
    ├── pools/              # NEW：pools CRUD
    ├── flows/              # NEW：flows CRUD
    ├── stones/
    ├── ui/
    └── world-config/
```

---

## 5. 我们的优化方案

对齐总纲 A（Architecture）/ F（Foundation）原则。

### 阶段 A：架构梳理（先理清楚边界）

**A1. observable → scheduler 重命名与合并**

1. `packages/@ooc/core/runtime/` → `packages/@ooc/core/scheduler/`
   - 改名 + 合并 observable/（window-hash.ts 去磁盘 IO 后整体迁入）。
   - observable/index.ts 保留 deprecated re-export 兼容过渡。

2. `app/server/modules/runtime/` → `app/server/modules/debug/`
   - 改名解决命名冲突。
   - 暴露内容不变（debug/global-pause/jobs/permission/llm-config）。

3. PauseChecker / RuntimePermissionDecider / ThreadActivationNotifier 类型从 observable-store.ts → scheduler/types.ts
   - observable 只保留 LlmObservation + debug 文件落盘 + window hash。

**A2. thread 状态机剥离**

1. `app/server/runtime/thread-transition.ts` → `packages/@ooc/core/thinkable/` 下新建 `thread-state/`。
2. `app/server/runtime/resume.ts` → 同目录。
3. 调整 app/server 通过 import thinkable/thread-state/ 消费。

**A3. 补齐 pools/flows 模块**

1. 新建 `app/server/modules/pools/`（最小实现）：
   - list pools、get pool knowledge、CRUD knowledge file/directory
   - 复用 stones/service.ts 同构 pattern
2. 新建 `app/server/modules/flows/`（最小实现）：
   - list sessions、list flows、get thread、pause/resume thread
   - 复用 runtime/service 同构 pattern

### 阶段 F：基础卫生（消除技术债）

**F1. beginLlmLoop/finishLlmLoop 两套实现合一**

- 测试改造：class 方法级别 mock 替代 module-level spyOn，迁移到 `spyOn(ObservableStore.prototype, "beginLlmLoop")`。
- observable/index.ts module-level 实现删除，改为 thin delegation 到 store 方法。

**F2. 统一日志通道**

- 新建 `scheduler/logger.ts`（或复用 persistable 已有通道）：
  - 所有 console.* 改为走统一入口，受 debugEnabled 开关控制。
  - executable/thinkable 现有 20+ 处 console.* 替换。

**F3. window-hash 纯化**

- computeFileDiff 的 readFile 从 observable/window-hash.ts → 抽出为 persistable 层或独立 file-io helper。
- window-hash 只做纯 hash + diff 结构生成（纯函数）。

**F4. "0.0.0.0" 硬编码 → config**

- ServerConfig 增加 `hostname?: string` 字段，默认 "0.0.0.0"。
- buildServer.listen 用 config.hostname。

**F5. bootstrap/check-state-context-split 跨包 import**

- scripts/migrate-state-context-split.ts → 迁入 `packages/@ooc/core/persistable/` 或独立 package，解决跨包 import。
- 或 bootstrap 改为通过 CLI 子进程调用（不 import）。

**F6. syncCrossObjectCalleeEnds 迁移**

- 移入 collaborable/talk-delivery 层：callee thread end（status=done/failed）时主动 notify caller。
- worker 保留兜底 fs 扫描（防御性），但主路径走主动通知。

### 实施顺序（依赖最小化改动、每步独立可验证）

1. F4（hostname config）+ F2（统一日志）→ 低风险，立即收益清晰。
2. A1（scheduler 改名 + debug 改名）→ 解决命名冲突。
3. A2（thread 状态机剥离）→ 边界清晰。
4. F1（两套实现合一）→ 消除技术债。
5. F3（window-hash 纯化）+ F5（bootstrap import）。
6. A3（pools/flows 新模块）。
7. F6（syncCrossObjectCalleeEnds 迁移）。

---

## 6. 我们对其他模块的要求

### 对 executable/ 的要求

1. **executable/windows/_shared/manager.ts**：10 处 `console.warn` 改为走统一日志通道（见 3.1 清单）。由 AgentOfExecutable 负责替换。
2. **executable/collaborable/talk-delivery**：提供"callee end 主动 notify caller"能力（F6 所需）。由 AgentOfCollaborable 负责。
3. **executable/windows/_shared/**：提供 `extractBasicDescription` 逻辑从 ui/api.list-window-types.ts 下沉到 executable 层（3.2(4)）。由 AgentOfExecutable 负责。
4. **executable/tools/dispatchToolCall**：resume.ts 中 `dispatchToolCall` 位于 executable/，我们剥离 resume.ts 到 thinkable/后仍需 import executable，需确认边界是否 OK，或 dispatchToolCall 也需进一步拆分。

### 对 thinkable/ 的要求

1. **thinkable/knowledge/\***：8 处 console.warn/debug/error 替换走统一日志通道（见 3.1 清单）。由 AgentOfThinkable 负责。
2. **thinkable/context/protocol.ts**：1 处 console.warn。同上。
3. **thinkable/llm/providers/claude.ts**：1 处 console.error。
4. **thinkable/scheduler + recovery**：thread-transition.ts + resume.ts 迁入 thinkable/，由 AgentOfThinkable 承接。
5. **thinkable/**：需提供 thread state machine 公共 API（canResume / applyResume / applyInject / resumePausedThread），app/server 通过该 API 消费。

### 对 persistable/ 的要求

1. **persistable/**：提供 fileDiff 所需的 file 读 API（window-hash 纯化所需）。
2. **persistable/**：承接 scripts/migrate-state-context-split.ts 迁入（或独立 package）。由 AgentOfPersistable 负责。

### 对总纲 / Supervisor 的要求

1. **总纲 A/F 对齐**：
   - 本方案需要总纲确认 scheduler/ 命名（原名 runtime/ + observable/）是否与 8 维度命名冲突（scheduler 不是 8 维度内）。
   - debug/ 模块（原名 modules/runtime/ 改为 modules/debug/）是否命名同意。
2. **pools/flows API 设计**：pools/flows 模块 API 契约（REST 与 stones/ui 同构）需要 Supervisor 确认 schema 对齐。
3. **bun:test spyOn 技术债处理**：F1 测试改造方式（module-level → class-level）需要测试体系确认后测试不破。

---

*本方案作为 observable + app/server 联合自审，锚定的所有问题均附文件:行号，可独立审阅。*
