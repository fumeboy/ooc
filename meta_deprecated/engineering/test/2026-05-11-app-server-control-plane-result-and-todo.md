# App Server Control Plane 工作结果与待办事项

**日期:** 2026-05-11

## 背景

本次工作在 `src/app/server` 下新增基于 Elysia 的 OOC 控制面服务，并补齐接口测试、端到端测试、真实 LLM 端到端验证，以及 `meta/app` 应用层文档入口。

## 已完成结果

### 1. App Server 控制面

- 新增 `src/app/server`，采用 feature-based 结构。
- 每个 API 独立为一个 `api.*.ts` 文件，模块内平铺，不额外增加 `api/` 子目录。
- 已实现模块：
  - `health`
  - `runtime`
  - `stones`
  - `flows`
- `debug` 能力并入 `runtime`。
- `threads` 能力并入 `flows`。
- `methods` 能力并入 `stones` 和 `flows`，两侧各自提供 `call_method`。

### 2. API 能力

- `GET /api/health`
- `GET /api/runtime/llm-config`
- `GET /api/runtime/jobs`
- `GET /api/runtime/jobs/:jobId`
- `POST /api/runtime/global-pause/enable`
- `POST /api/runtime/global-pause/disable`
- `GET /api/runtime/global-pause/status`
- `GET /api/runtime/sessions/:sessionId/objects/:objectId/threads/:threadId/debug/latest`
- `GET /api/runtime/sessions/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex`
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
- `POST /api/flows/`
- `POST /api/flows/:sessionId/objects/`
- `GET /api/flows/:sessionId/objects/:objectId`
- `GET /api/flows/:sessionId/objects/:objectId/threads/:threadId`
- `POST /api/flows/:sessionId/pause`
- `POST /api/flows/:sessionId/resume`
- `POST /api/flows/:sessionId/objects/:objectId/call_method`

### 3. Runtime 与 Worker

- 新增进程内 `jobManager`，支持 queued / running / done / failed 状态。
- 新增 `pauseStore`，支持 global pause 与 session pause。
- 新增 `resumePausedThread`，支持复用已落盘 `llm.output.json` 继续执行。
- 新增 `processQueuedJobs` 与 `startJobWorker`。
- `buildServer` 可通过 `workerEnabled` 控制是否启动后台 worker。
- 普通测试显式关闭 worker，避免默认测试访问真实 LLM。
- 真实 E2E 显式启用 worker。

### 4. 内核配套

- `src/executable/server/loader.ts` 支持同时加载 `llm_methods` 与 `ui_methods`。
- `src/executable/server/types.ts` 增加 `UiMethods` 与 loader cache entry 类型。
- `src/observable/index.ts` 增加可注入 pause checker。
- `src/persistable/flow-object.ts` 增加 flow session 元数据与路径 helper。

### 5. 测试

新增测试覆盖：

- `src/app/server/__tests__/server.routes.test.ts`
  - controller / route 层接口测试
- `src/app/server/__tests__/server.e2e.test.ts`
  - 本地端到端测试，不依赖真实 LLM
- `src/app/server/__tests__/real-app-server.test.ts`
  - 真实 LLM 端到端测试，默认跳过，通过 `RUN_REAL_APP_SERVER_TEST=1` 显式运行
- `src/app/server/runtime/worker.test.ts`
  - worker job 状态流转测试

### 6. 文档

- 新增设计文档：
  - `docs/superpowers/specs/2026-05-11-app-server-elysia-control-plane-design.md`
  - `docs/superpowers/specs/2026-05-11-app-server-testing-and-docs-design.md`
- 新增实现计划：
  - `docs/superpowers/plans/2026-05-11-app-server-elysia-control-plane.md`
  - `docs/superpowers/plans/2026-05-11-app-server-testing-and-docs.md`
- 新增 `meta/app` 文档树：
  - `meta/app/index.doc.js`
  - `meta/app/server/index.doc.js`
- 更新 `meta/index.doc.js`，接入 `app` 顶层入口。

## 验证结果

本次提交前验证命令与结果：

```bash
bunx tsc --noEmit
```

结果：通过。

```bash
bun test src/app/server
```

结果：通过，`13 pass / 1 skip / 0 fail`。

```bash
RUN_REAL_APP_SERVER_TEST=1 bun test src/app/server/__tests__/real-app-server.test.ts
```

结果：通过，`1 pass / 0 fail`。

```bash
bun -e 'import("./meta/app/index.doc.js").then(m=>console.log(Object.keys(m).join(",")))'
```

结果：通过，输出 `app_tree_v20260511_1,app_v20260511_1`。

## 已知问题

### 1. 全量 `bun test` 仍有既有集成测试失败

执行全量 `bun test` 时，以下既有真实 Agent 集成测试仍存在不稳定或失败：

- `tests/integration/todo-driven-multistep.integration.test.ts`
- `tests/integration/abandon-via-close.integration.test.ts`
- `tests/integration/shell-exec-basic.integration.test.ts`
- `tests/integration/do-continue-after-done.integration.test.ts`
- `tests/integration/multi-shell-chain.integration.test.ts`

这些失败集中在 Agent 行为收敛和真实 LLM 输出稳定性，不属于本次 `app/server` 新增测试切片的失败。

### 2. 顶层 `meta/index.doc.js` import 存在既有循环初始化问题

直接执行：

```bash
bun -e 'import("./meta/index.doc.js")'
```

会触发既有 `meta/object/executable` 文档循环引用问题：

```text
ReferenceError: Cannot access 'executable_v20260504_1' before initialization
```

本次新增的 `meta/app` 独立 import 已通过验证。

## 待办事项

1. 修复 `meta/object/executable` 文档循环引用，使顶层 `meta/index.doc.js` 可直接 import。
2. 继续优化真实 Agent 集成测试的稳定性，重点关注 open / refine / submit / close / end 序列收敛。
3. 为 `call_method` 增加 route 层错误映射，避免 method 缺失时直接抛出通用 500。
4. 为 `runtime` debug 查询补充 controller 测试，覆盖 latest debug 与 loop debug 的 404 / JSON 解析场景。
5. 将 worker 的进程内状态模型升级为可恢复 job 队列前，需明确重启恢复语义与磁盘状态格式。
6. 为 `flows.resumeSession` 补齐扫描 paused thread 并入队 resume-thread job 的实现。
