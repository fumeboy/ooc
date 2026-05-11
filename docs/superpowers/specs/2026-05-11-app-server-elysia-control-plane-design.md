# App Server Elysia Control Plane Design

**Date:** 2026-05-11

**Scope:** 在 `src/app/server` 下新增基于 `Elysia` 的控制面服务，采用官方 best practice 推荐的 feature-based 目录结构，并为当前 OOC 内核落地首批 HTTP API：

1. `stones` 控制面 API
2. `flows` 控制面 API（包含 thread 能力）
3. `runtime` / job / LLM 配置 / debug 查询 API
5. `pause/resume` API
6. stone 与 flow 两侧 `ui_methods` 的 `call_method` HTTP 调用

明确不实现：

- `context-visibility`
- SSE / streaming
- 认证鉴权
- 可恢复的持久 job 队列
- 自动恢复运行中的 worker
- `llm_methods` 的 HTTP 暴露

---

## 背景

当前仓库中的 OOC 运行时已经具备以下内核能力：

- `persistable`：stone / flow / thread / debug 文件读写
- `thinkable`：`buildContext()`、`think()`、`runScheduler()`
- `executable`：form、tool、command、`program`、server method 动态加载
- `observable`：latest input/output、loop 级 debug、`paused` 状态占位

但仍然缺少一层正式的服务端控制面：

- 没有统一 HTTP API 暴露 stone / flow / thread / debug 能力
- `ui_methods` 仅存在文档约定，尚无 HTTP `call_method` 落地
- `pause/resume` 只有文档和 `paused` 状态，没有控制面入口和运行时实现
- `scheduler` 只能在进程内直接函数调用，没有异步后台任务抽象

本设计的目标是补上一层**最小但完整的控制面 Server**，让当前 OOC 系统能被外部 UI / 工具 / 人工操作稳定驱动。

---

## 外部约束

### 1. Elysia 目录结构约束

根据官方 best practice，并结合用户新增要求：

- 采用 **feature-based folder structure**
- 在 feature 分组的基础上改为 **one api per file**
- 每个 feature/module 目录下包含：
  - `index.ts`：聚合注册该 module 下的所有 API 文件
  - `service.ts`：该 module 的共享业务逻辑
  - `model.ts`：该 module 的共享模型与 schema helper
  - `api.*.ts`：每个 API 单独一个文件，文件名直接表达路由语义

同时遵守以下官方建议：

- `1 Elysia instance = 1 controller`
- 不把整个 Elysia `Context` 传入 controller/service
- 非 request 逻辑放在 `service.ts` 或独立运行时模块
- 所有 DTO 和校验统一使用 `elysia` 的 `t.*` 定义

### 2. 当前系统边界约束

当前仓库事实如下：

- `src/executable/server/loader.ts` 只加载 `llm_methods`
- `src/executable/server/self.ts` 只面向 `program` 注入 `self.callMethod`
- `src/observable/index.ts` 里 `isPausing()` 仍是占位函数
- `src/thinkable/thinkloop.ts` 已支持在 LLM 返回后、tool 执行前把线程置为 `paused`
- `src/thinkable/scheduler.ts` 明确不负责 `paused` 恢复

因此本设计必须额外补：

- `ui_methods` 的加载与执行
- `pause` 的控制信号存储
- `resume` 的未执行 LLM 输出恢复执行
- 后台 job manager / worker

---

## 关键设计决策

### 决策 1：Server 采用 feature-based + one api per file 目录结构

`src/app/server` 采用 Elysia 官方推荐的模块组织方式，不做传统横向 `controllers/services/models` 分层。
同时按用户要求把每个 API 拆成单独文件，保证仅从源码目录就能直接看出有哪些端点。

最终结构：

```text
src/app/server/
├── index.ts
├── bootstrap/
│   ├── config.ts
│   └── errors.ts
├── runtime/
│   ├── job-manager.ts
│   ├── worker.ts
│   ├── pause-store.ts
│   ├── resume.ts
│   └── types.ts
└── modules/
    ├── health/
    │   ├── index.ts
    │   └── api.health.ts
    ├── runtime/
    │   ├── index.ts
    │   ├── service.ts
    │   ├── model.ts
    │   ├── api.get-llm-config.ts
    │   ├── api.list-jobs.ts
    │   ├── api.get-job.ts
    │   ├── api.enable-global-pause.ts
    │   ├── api.disable-global-pause.ts
    │   ├── api.get-global-pause-status.ts
    │   ├── api.get-latest-debug.ts
    │   └── api.get-loop-debug.ts
    ├── stones/
    │   ├── index.ts
    │   ├── service.ts
    │   ├── model.ts
    │   ├── api.create-stone.ts
    │   ├── api.get-stone.ts
    │   ├── api.get-self.ts
    │   ├── api.put-self.ts
    │   ├── api.get-readme.ts
    │   ├── api.put-readme.ts
    │   ├── api.get-data.ts
    │   ├── api.patch-data.ts
    │   ├── api.get-server-source.ts
    │   ├── api.put-server-source.ts
    │   └── api.call-method.ts
    ├── flows/
    │   ├── index.ts
    │   ├── service.ts
    │   ├── model.ts
    │   ├── api.create-session.ts
    │   ├── api.create-flow-object.ts
    │   ├── api.get-flow-object.ts
    │   ├── api.get-thread.ts
    │   ├── api.pause-session.ts
    │   ├── api.resume-session.ts
    │   └── api.call-method.ts
```

补充说明：

- `threads` 不单独成模块，统一并入 `flows`
- `methods` 不单独成模块，`call_method` 分别归入 `stones` 和 `flows`
- `pause/resume` 不单独成 feature，对外 API 并入 `flows` 和 `runtime`
- `debug` 不单独成模块，统一并入 `runtime`
- `index.ts` 不是“大而全 controller”，只做 route composition
- 每个 `api.*.ts` 文件内只定义一个端点及其 schema/handler

### 决策 2：异步执行模型采用进程内 worker

首版采用**进程内异步 worker**：

- HTTP 请求只负责创建/唤醒 job
- 后台 worker 驱动 `runScheduler()`
- job 状态保存在进程内 registry
- flow/thread/debug 数据继续保存在磁盘
- 服务进程重启后，不自动恢复运行中的 job

这样既能满足“异步任务模型”，又不会引入首版过重的持久化调度系统。

### 决策 3：`call_method` 只暴露 `ui_methods`

两个 HTTP 端点：

- `POST /api/stones/:objectId/call_method`
- `POST /api/flows/:sessionId/objects/:objectId/call_method`

都只调用 `ui_methods`：

- stone 端点 -> stone object `server/index.ts` 的 `ui_methods`
- flow 端点 -> flow object `server/index.ts` 的 `ui_methods`

不会通过 HTTP 暴露：

- `llm_methods`
- `self.callMethod`
- sandbox 内的 LLM 通道

这样可以保持现有“HTTP = UI 通道，sandbox = LLM 通道”的边界。

### 决策 4：`pause` 分为 session 级与 global 级

基于现有文档约定，首版同时实现两类 pause：

1. session / flow 级 pause
   - `POST /api/flows/:sessionId/pause`
   - `POST /api/flows/:sessionId/resume`

2. global pause
   - `POST /api/runtime/global-pause/enable`
   - `POST /api/runtime/global-pause/disable`
   - `GET /api/runtime/global-pause/status`

语义：

- pause 不会打断正在进行中的 LLM 请求
- pause 在 **LLM 返回后、tool 执行前** 生效
- 线程进入 `paused`
- 本轮 `toolCalls` 不执行
- `resume` 恢复的不是重新发起 LLM 请求，而是**继续执行上一轮已落盘但未执行的 LLM 输出**

### 决策 5：resume 以“恢复未执行输出”为准，不重新调用 LLM

resume 语义遵循 `meta/object/observable/pause.doc.js`：

- 恢复 paused 线程为 `running`
- 从最近一次已落盘的 `llm.output.json` 读取 LLM 结果
- 重新把该结果映射为 text / tool_use / dispatch 行为
- 只补执行此前未执行的 tool calls
- 不重新调用 LLM，不重建新的 messages

原因：

- 这是 pause 作为“人工检查点”的核心语义
- 允许用户在 pause 期间查看甚至未来编辑 `llm.output.json`
- 避免 resume 改变模型结果，保持可解释与可重放

### 决策 6：`context-visibility` 从本次范围移除

虽然 `meta.md` 中提到 `GET /api/flows/:sessionId/objects/:name/context-visibility?focus=:threadId`，
但用户已明确要求本次忽略该能力，因此：

- 不设计 API
- 不设计 service
- 不作为 worker / thread / debug 依赖

---

## 模块职责设计

## 1. `health`

### 目标

提供最小健康检查。

### 文件

- `modules/health/index.ts`
- `modules/health/api.health.ts`

### API

- `GET /api/health`

### 返回

```json
{
  "ok": true,
  "service": "ooc-app-server",
  "time": 1760000000000
}
```

---

## 2. `runtime`

### 目标

暴露运行时全局能力：

- LLM 配置探测
- job 查询
- global pause 开关
- debug 查询

### 文件

- `modules/runtime/index.ts`
- `modules/runtime/service.ts`
- `modules/runtime/model.ts`
- `modules/runtime/api.get-llm-config.ts`
- `modules/runtime/api.list-jobs.ts`
- `modules/runtime/api.get-job.ts`
- `modules/runtime/api.enable-global-pause.ts`
- `modules/runtime/api.disable-global-pause.ts`
- `modules/runtime/api.get-global-pause-status.ts`
- `modules/runtime/api.get-latest-debug.ts`
- `modules/runtime/api.get-loop-debug.ts`

### API

- `GET /api/runtime/llm-config`
- `GET /api/runtime/jobs`
- `GET /api/runtime/jobs/:jobId`
- `POST /api/runtime/global-pause/enable`
- `POST /api/runtime/global-pause/disable`
- `GET /api/runtime/global-pause/status`
- `GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug`
- `GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex`

### `GET /api/runtime/llm-config`

调用 `readLlmEnv()`，返回：

```json
{
  "provider": "openai",
  "baseUrl": "https://...",
  "model": "gpt-...",
  "configured": true
}
```

注意：

- 不回传 `apiKey`
- 若读取失败，不直接抛裸错，转换为结构化错误

### `GET /api/runtime/jobs`

返回进程内 job registry 的快照。

### `GET /api/runtime/jobs/:jobId`

返回单个 job 状态：

```json
{
  "jobId": "job_xxx",
  "status": "queued",
  "sessionId": "s1",
  "objectId": "agent",
  "threadId": "root",
  "startedAt": 1760000000000,
  "finishedAt": null,
  "error": null
}
```

### global pause

全局 pause 状态由 `runtime/pause-store.ts` 管理：

- 进程内布尔值
- 提供 `enableGlobalPause()` / `disableGlobalPause()` / `getGlobalPauseStatus()`

---

## 3. `stones`

## 3. `stones`

### 目标

提供 stone 对象长期身份与长期数据的 HTTP 控制面。

### 文件

- `modules/stones/index.ts`
- `modules/stones/service.ts`
- `modules/stones/model.ts`
- `modules/stones/api.create-stone.ts`
- `modules/stones/api.get-stone.ts`
- `modules/stones/api.get-self.ts`
- `modules/stones/api.put-self.ts`
- `modules/stones/api.get-readme.ts`
- `modules/stones/api.put-readme.ts`
- `modules/stones/api.get-data.ts`
- `modules/stones/api.patch-data.ts`
- `modules/stones/api.get-server-source.ts`
- `modules/stones/api.put-server-source.ts`
- `modules/stones/api.call-method.ts`

### API

- `POST /api/stones`
- `GET /api/stones/:objectId`
- `GET /api/stones/:objectId/self`
- `PUT /api/stones/:objectId/self`
- `GET /api/stones/:objectId/readme`
- `PUT /api/stones/:objectId/readme`
- `GET /api/stones/:objectId/data`
- `PATCH /api/stones/:objectId/data`
- `GET /api/stones/:objectId/server-source`
- `PUT /api/stones/:objectId/server-source`
- `POST /api/stones/:objectId/call_method`

### `POST /api/stones`

调用 `createStoneObject()`。

请求：

```json
{
  "baseDir": "/tmp/ooc-world",
  "objectId": "agent"
}
```

响应：

```json
{
  "objectId": "agent",
  "dir": "/tmp/ooc-world/stones/agent",
  "created": true
}
```

### `GET /api/stones/:objectId`

返回 stone 基本信息：

- `objectId`
- `dir`
- `exists`

首版不扫描完整目录树，不做聚合 stats。

### `self/readme/data/server-source`

直接复用 `persistable` 读写 API：

- `readSelf` / `writeSelf`
- `readReadme` / `writeReadme`
- `readData` / `mergeData`
- `readServerSource` / `writeServerSource`

### `POST /api/stones/:objectId/call_method`

只调用 stone `server/index.ts` 的 `ui_methods`。

请求：

```json
{
  "method": "submit",
  "args": {
    "value": 42
  }
}
```

响应：

```json
{
  "returnValue": {
    "ok": true
  }
}
```

为此需要补齐：

- `src/executable/server/loader.ts` 同时支持 `ui_methods`
- stone 级 HTTP method 调用上下文构造器

---

## 4. `flows`

### 目标

提供 flow object 与线程树的控制面，并把 thread 能力统一纳入 `flows`。

### 文件

- `modules/flows/index.ts`
- `modules/flows/service.ts`
- `modules/flows/model.ts`
- `modules/flows/api.create-session.ts`
- `modules/flows/api.create-flow-object.ts`
- `modules/flows/api.get-flow-object.ts`
- `modules/flows/api.get-thread.ts`
- `modules/flows/api.pause-session.ts`
- `modules/flows/api.resume-session.ts`
- `modules/flows/api.call-method.ts`

### API

- `POST /api/flows/`
- `POST /api/flows/:sessionId/objects/`
- `GET /api/flows/:sessionId/objects/:objectId`
- `GET /api/flows/:sessionId/objects/:objectId/threads/:threadId`
- `POST /api/flows/:sessionId/pause`
- `POST /api/flows/:sessionId/resume`
- `POST /api/flows/:sessionId/objects/:objectId/call_method`

### `POST /api/flows/`

用于创建一个新的 session。

请求：

```json
{
  "baseDir": "/tmp/ooc-world",
  "sessionId": "s1",
  "title": "新任务"
}
```

响应：

```json
{
  "sessionId": "s1",
  "dir": "/tmp/ooc-world/flows/s1",
  "created": true
}
```

说明：

- 该接口负责初始化 session 根目录
- 首版同时补 `.session.json` 的最小元数据文件
- 不在该接口中隐式创建任何 flow object

### `POST /api/flows/:sessionId/objects/`

调用 `createFlowObject()` 创建某个 session 下的 flow object 根目录，并自动创建初始 thread、自动启动后台 job。

请求：

```json
{
  "baseDir": "/tmp/ooc-world",
  "sessionId": "s1",
  "objectId": "agent"
}
```

响应：

```json
{
  "sessionId": "s1",
  "objectId": "agent",
  "dir": "/tmp/ooc-world/flows/s1/objects/agent",
  "created": true,
  "initialThreadId": "root",
  "jobId": "job_123"
}
```

自动初始化语义：

- flow object create 成功后，自动创建 `root` 初始线程
- 自动向 job manager 注册一个 `run-thread` job
- controller 直接返回 `initialThreadId` 与 `jobId`
- 调用方无需再显式创建第一条 thread

### `GET /threads/:threadId`

读取并返回 `thread.json`。

### `POST /api/flows/:sessionId/pause`

设置 session pause 标记。

作用规则：

- 影响该 `sessionId` 下所有 object 的 running thread
- 不会打断正在进行中的 LLM 请求
- 等当前轮 LLM 返回后，由 `isPausing(thread)` 命中并进入 `paused`

### `POST /api/flows/:sessionId/resume`

功能：

- 清除 session pause 标记
- 找到该 session 下所有 `paused` 线程
- 为这些线程创建或唤醒 resume job
- resume job 不重新调 LLM，而是读取最近一次 `llm.output.json` 继续执行

响应：

```json
{
  "sessionId": "s1",
  "resumedThreadIds": ["root", "child_1"],
  "jobIds": ["job_a", "job_b"]
}
```

### `POST /api/flows/:sessionId/objects/:objectId/call_method`

只调用 flow object `server/index.ts` 的 `ui_methods`。

请求/响应结构与 stones 级一致。

---

## API 文件组织规则

为满足“从源码目录一目了然地看出有哪些 API”，所有 HTTP 端点都采用 one api per file 组织。

规则如下：

- 每个 module 下的 `api.*.ts` 只承载一个端点
- 文件名直接体现行为，不使用模糊命名
- `index.ts` 只负责 `use()` / route composition，不写具体业务逻辑
- schema 可以放在该 API 文件内，也可以从同 module 的 `model.ts` 复用
- handler 中只做：
  - 解构 request 所需字段
  - 调用 `service.ts`
  - 返回结构化响应
- 不把整个 Elysia `Context` 传给 `service.ts`

示例：

```text
modules/flows/
├── index.ts
├── service.ts
├── model.ts
├── api.create-session.ts
├── api.create-flow-object.ts
├── api.get-thread.ts
├── api.pause-session.ts
├── api.resume-session.ts
└── api.call-method.ts
```

这样目录层面就能直接回答两个问题：

- 当前系统有哪些 API
- 每个 API 属于哪个业务边界

---

## 运行时设计

## 1. Job Manager

文件：`src/app/server/runtime/job-manager.ts`

职责：

- 维护进程内 job registry
- 负责 `createJob()`
- 负责并发互斥
- 负责查询 job 状态

### 类型

```ts
export interface RuntimeJob {
  jobId: string;
  kind: "run-thread" | "resume-thread";
  sessionId: string;
  objectId: string;
  threadId: string;
  status: "queued" | "running" | "done" | "failed";
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}
```

### 并发约束

同一个 `(sessionId, objectId)` 同时只允许一个 running job。

原因：

- 当前 `runScheduler()` 与 `writeThread()` 不具备并发写保护
- 避免多个 job 同时修改同一个 flow object 的 thread 树

若重复提交：

- 返回现有 running job
- 或抛出 `JOB_ALREADY_RUNNING`

首版采用前者更友好。

## 2. Worker

文件：`src/app/server/runtime/worker.ts`

职责：

- 后台消费 queued jobs
- 调用 `runScheduler()`
- 更新 job 状态

### 执行模型

每个 job 的执行伪代码：

```ts
while (!finished && batchCount < maxBatches) {
  await runScheduler(rootThread, llmClient, { maxTicks: maxTicksPerBatch });
  await persistThreadTree(rootThread);
  if (rootThread.status === "done" || rootThread.status === "failed") {
    finished = true;
  } else if (!hasRunnableThread(rootThread)) {
    finished = true;
  }
}
```

补充说明：

- 当前仓库只有 `writeThread(nextThread)`，没有完整 thread tree 落盘工具
- 因此实现时需补一个“按树递归写 thread.json”的 runtime helper
- 若只恢复/运行单个 root thread，也允许首版把 resume / run 限定在 root thread 所在线程树

## 3. Pause Store

文件：`src/app/server/runtime/pause-store.ts`

职责：

- 保存 global pause 状态
- 保存 session pause 状态

API：

- `enableGlobalPause()`
- `disableGlobalPause()`
- `isGlobalPauseEnabled()`
- `pauseSession(sessionId)`
- `resumeSession(sessionId)`
- `isSessionPaused(sessionId)`

## 4. Resume Runtime

文件：`src/app/server/runtime/resume.ts`

职责：

- 读取 paused thread 最近一次 `llm.output.json`
- 把文件内容解析回 `LlmGenerateResult`
- 按 `thinkloop` 当前语义补执行：
  - 写入 `llm_interaction:text`
  - 写入 `llm_interaction:tool_use`
  - 顺序执行 `dispatchToolCall`
- 成功后把线程状态从 `paused` 恢复为 `running` 或由 command 改写为最终状态

### 关键事实

当前 `llm.output.json` 中已经保存统一结构的 `LlmGenerateResult`，因此 resume 不需要重新解析 provider 原始文本。

### 恢复流程

```ts
1. 读取 thread.json，确认 status === "paused"
2. 读取 llm.output.json
3. thread.status = "running"
4. 把 result.text / result.toolCalls 回放进 events
5. 若 pause 仍开启，禁止继续 resume
6. 顺序 dispatch tool calls
7. writeThread()
```

### 幂等性

resume 首版不追求完全幂等。

为了避免重复执行同一批 tool calls，设计约束如下：

- 只有 `paused` 线程允许进入 `resume`
- resume 开始时立即把 `thread.status` 改回 `running`
- 若中途失败，线程变为 `failed` 或写入 inject 错误
- 不允许对非 `paused` 线程调用 resume

未来若要支持“多次编辑 llm.output.json 后重试”，再增加 `pausedOutputConsumed` 一类状态标记。

---

## 内核扩展设计

## 1. `src/executable/server/loader.ts` 扩展 UI methods

当前：

- `loadServerMethods(stoneRef)` 仅返回 `llm_methods`

需要改为：

```ts
export async function loadLlmServerMethods(ref: StoneObjectRef): Promise<LlmMethods>;
export async function loadUiServerMethods(ref: StoneObjectRef): Promise<LlmMethods>;
```

缓存键仍按同一文件 mtime。

### 兼容策略

若短期不想拆 API，可保留旧函数：

```ts
export const loadServerMethods = loadLlmServerMethods;
```

供现有 `createProgramSelf()` 继续使用。

## 2. 新增 HTTP 调用上下文

新增类似 `createProgramSelf()` 的 HTTP method 调用上下文构造器，但专门给 `ui_methods` 使用。

建议位置：

- `src/executable/server/http.ts`

能力：

- `self.dir`
- `self.getData/setData`
- `thread.inject` 可选

差异：

- 不暴露 sandbox 专用语义
- 不走 `llm_methods`
- flow 级调用优先作用于 flow object 对应 ref

## 3. `src/observable/index.ts` 实现 pause 查询

当前 `isPausing(thread)` 总是返回 `false`。

需要改成依赖 `pause-store` 的可插拔实现。

建议做法：

- `observable` 保持无 HTTP 依赖
- 通过注册式 API 注入 pause checker：

```ts
type PauseChecker = (thread: ThreadContext) => boolean | Promise<boolean>;
export function setPauseChecker(checker: PauseChecker): void;
```

默认 checker 为 `() => false`

`app/server` 启动时把 `pause-store` 注入进去：

- global pause 开启 -> true
- thread.persistence.sessionId 命中 session pause -> true

## 4. `src/thinkable` 保持最小侵入

`thinkloop.ts` 本身不引入 HTTP 语义。

resume 不直接塞回 `think()`，而是新增独立 runtime helper 回放已落盘输出。

原因：

- `think()` 的语义是“发起一轮新的 LLM 调用”
- `resume` 的语义是“继续执行上一轮结果”
- 两者混在一起会破坏当前函数边界

---

## API 明细

## `GET /api/health`

返回：

```json
{ "ok": true, "service": "ooc-app-server", "time": 1760000000000 }
```

## `GET /api/runtime/llm-config`

返回：

```json
{
  "configured": true,
  "provider": "openai",
  "baseUrl": "https://example.com",
  "model": "gpt-4.1"
}
```

## `GET /api/runtime/jobs`

返回：

```json
{
  "items": [
    {
      "jobId": "job_1",
      "kind": "run-thread",
      "sessionId": "s1",
      "objectId": "agent",
      "threadId": "root",
      "status": "running"
    }
  ]
}
```

## `GET /api/runtime/jobs/:jobId`

返回：

```json
{
  "jobId": "job_1",
  "kind": "run-thread",
  "sessionId": "s1",
  "objectId": "agent",
  "threadId": "root",
  "status": "done",
  "startedAt": 1760000000000,
  "finishedAt": 1760000001234,
  "error": null
}
```

## `POST /api/runtime/global-pause/enable`

返回：

```json
{ "enabled": true }
```

## `POST /api/runtime/global-pause/disable`

返回：

```json
{ "enabled": false }
```

## `GET /api/runtime/global-pause/status`

返回：

```json
{ "enabled": true }
```

## `POST /api/stones`

请求：

```json
{ "baseDir": "/tmp/ooc", "objectId": "agent" }
```

返回：

```json
{
  "objectId": "agent",
  "dir": "/tmp/ooc/stones/agent",
  "created": true
}
```

## `POST /api/stones/:objectId/call_method`

请求：

```json
{
  "baseDir": "/tmp/ooc",
  "method": "submit",
  "args": { "value": 1 }
}
```

返回：

```json
{
  "returnValue": { "ok": true }
}
```

## `POST /api/flows/:sessionId/objects/`

请求：

```json
{
  "baseDir": "/tmp/ooc",
  "objectId": "agent"
}
```

返回：

```json
{
  "sessionId": "s1",
  "objectId": "agent",
  "dir": "/tmp/ooc/flows/s1/objects/agent",
  "created": true,
  "initialThreadId": "root",
  "jobId": "job_123"
}
```

## `POST /api/flows/`

请求：

```json
{
  "baseDir": "/tmp/ooc",
  "sessionId": "s1",
  "title": "新的 session"
}
```

返回：

```json
{
  "sessionId": "s1",
  "dir": "/tmp/ooc/flows/s1",
  "created": true
}
```

## `GET /api/flows/:sessionId/objects/:objectId/threads/:threadId`

返回 `thread.json` 的结构化内容。

## `POST /api/flows/:sessionId/pause`

请求：

```json
{
  "baseDir": "/tmp/ooc"
}
```

返回：

```json
{
  "sessionId": "s1",
  "paused": true
}
```

## `POST /api/flows/:sessionId/resume`

请求：

```json
{
  "baseDir": "/tmp/ooc"
}
```

返回：

```json
{
  "sessionId": "s1",
  "resumedThreadIds": ["root"],
  "jobIds": ["job_resume_1"]
}
```

## `POST /api/flows/:sessionId/objects/:objectId/call_method`

请求：

```json
{
  "baseDir": "/tmp/ooc",
  "method": "submit",
  "args": { "value": 2 }
}
```

返回：

```json
{
  "returnValue": { "ok": true }
}
```

## `GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug`

返回：

```json
{
  "input": { "...": "..." },
  "output": { "...": "..." }
}
```

## `GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex`

返回：

```json
{
  "input": { "...": "..." },
  "output": { "...": "..." },
  "meta": { "...": "..." }
}
```

---

## 错误模型

所有模块统一用 `bootstrap/errors.ts` 做错误映射。

领域错误码：

- `NOT_FOUND`
- `INVALID_INPUT`
- `CONFLICT`
- `METHOD_NOT_FOUND`
- `METHOD_LOAD_FAILED`
- `THREAD_NOT_RUNNABLE`
- `THREAD_NOT_PAUSED`
- `JOB_ALREADY_RUNNING`
- `PAUSE_STILL_ENABLED`
- `INTERNAL_ERROR`

统一响应：

```json
{
  "code": "NOT_FOUND",
  "message": "线程不存在",
  "details": {}
}
```

HTTP 映射：

- `NOT_FOUND` -> `404`
- `INVALID_INPUT` -> `400`
- `CONFLICT` / `JOB_ALREADY_RUNNING` -> `409`
- 其他 -> `500`

---

## 测试策略

### 1. Module Service Unit Tests

新增测试：

- `src/app/server/modules/stones/service.test.ts`
- `src/app/server/modules/flows/service.test.ts`
- `src/app/server/modules/runtime/service.test.ts`
- `src/app/server/runtime/job-manager.test.ts`
- `src/app/server/runtime/resume.test.ts`
- `src/app/server/runtime/pause-store.test.ts`

重点覆盖：

- stone / flow 读写
- `ui_methods` 加载与调用
- job 状态迁移
- pause/session/global 判定
- resume 读取 `llm.output.json` 并继续 dispatch

### 2. Controller Tests

为每个 module 的 `index.ts` 增加 Elysia `app.handle()` 路由测试。

重点覆盖：

- request schema 校验
- response schema
- 错误码映射

### 3. Integration Tests

新增首批集成测试：

- 创建 stone -> 写 `server-source` -> stone `call_method`
- 创建 session -> 创建 flow object 自动产出初始 thread 并启动 -> 查询 `job`
- 开启 session pause -> thread 进入 `paused`
- `resume` 后继续执行未执行的 toolCalls
- runtime 下的 debug API 能读取 latest / loop 文件

### 4. 回归约束

现有测试必须继续通过，尤其是：

- `src/thinkable/__tests__/thinkloop.test.ts`
- `src/observable/__tests__/observable.test.ts`
- `src/executable/__tests__/server-loader.test.ts`
- `src/executable/__tests__/server-self.test.ts`
- `tests/integration/meta-programming.integration.test.ts`

---

## 验收标准

实现完成后，必须满足：

1. `src/app/server` 按 Elysia 官方推荐的 feature-based 结构组织
2. `stones`、`flows`、`runtime` 三大模块 API 可用
3. `threads` 能力已并入 `flows`
4. `call_method` 只暴露 `ui_methods`
5. `context-visibility` 未被实现
6. 存在 session pause、global pause、resume API
7. `resume` 不重新调 LLM，而是继续执行最近一次未执行的 `llm.output.json`
8. 异步 worker 能返回 `jobId`，并通过 job 查询状态
9. `bun test` 通过新增与既有测试
10. `bunx tsc --noEmit` 通过

---

## 非目标

本设计明确不覆盖：

- context visibility HTTP 暴露
- 前端页面资源服务
- SSE thought/tool stream
- 用户 inbox / session read-state API
- 多对象协作调度总控
- 跨进程 job 恢复
- 鉴权与权限边界

---

## 设计总结

本方案把当前 OOC 系统从“可在测试里运行的本地内核”推进到“拥有正式 HTTP 控制面和人工介入能力的可操作服务”。

核心收敛点是：

- 用 Elysia 官方推荐的模块化结构承载控制面
- 让 `stones` / `flows` 成为主要业务边界
- 把 `threads` 能力纳入 `flows`
- 把 `call_method` 纳入 `stones` / `flows`
- 把 `pause/resume` 作为一等运行时能力补齐
- 保持现有内核模块边界不被 HTTP 污染

这样既贴合当前仓库事实，也为后续接 UI、调试工具和自动化控制面留下了稳定演进路径。
