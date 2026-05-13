import * as appServer from "@src/app/server/index";
import * as appServerConfig from "@src/app/server/bootstrap/config";
import * as appServerWorker from "@src/app/server/runtime/worker";

export const app_server_v20260511_1 = {
  sources: {
    server: appServer,
    config: appServerConfig,
    worker: appServerWorker,
  },
  index: `
App Server 是 OOC 的控制面 HTTP 服务，位于 \`src/app/server\`，使用 Elysia 实现。

## 职责

- 将 stone / flow / runtime 等 OOC 内核能力暴露为 HTTP API。
- 为 UI 和工程工具提供稳定的控制面入口。
- 管理进程内 job、global pause、session pause 与 resume。
- 只通过 HTTP 暴露 \`ui_methods\`，不暴露 \`llm_methods\`。

## 模块

- health：\`GET /api/health\`
- runtime：LLM 配置、job 查询、global pause、debug 查询与 debug 开关
- stones：stone object 创建、读写 self/readme/data/server source、\`call_method\`
- flows：session、flow object、thread 查询、session pause/resume、\`call_method\`

## 目录约束

\`src/app/server\` 使用 feature-based 结构，并采用 one api per file：

\`\`\`
modules/<feature>/
├── index.ts
├── service.ts
├── model.ts
└── api.<action>.ts
\`\`\`

\`index.ts\` 只做 route composition；业务逻辑放在 \`service.ts\` 或 \`runtime/\` 下。

## Worker

flow object 创建后会创建 root thread 并入队 run-thread job。

- 默认生产配置启用 worker：\`OOC_WORKER_ENABLED !== "0"\`
- 测试中可通过 \`workerEnabled: false\` 关闭 worker，避免普通测试访问真实 LLM
- worker 轮询 queued job，执行成功后标记为 \`done\`，异常时标记为 \`failed\`

## 测试分层

- service tests：模块业务逻辑单测，快速稳定
- routes tests：controller / route 层接口测试，验证 schema 与路由装配
- local e2e：基于临时 baseDir 的控制面闭环，不依赖真实 LLM
- real e2e：真实 LLM 链路，默认跳过，显式开关才运行

## 本轮控制面演进补充

- runtime 模块现在不仅暴露全局 pause：
  - `GET /api/runtime/global-pause/status`
  - `POST /api/runtime/global-pause/enable`
  - `POST /api/runtime/global-pause/disable`
- 同时也把 observable debug 的进程内开关变成了 HTTP 能力：
  - `GET /api/runtime/debug/status`
  - `POST /api/runtime/debug/enable`
  - `POST /api/runtime/debug/disable`
- flows 列表会附带 session 的 `paused` 状态，供 web 控制面直接展示与切换。

这体现的设计原则是：**控制面状态必须通过 server 明确出入口，而不是让 web 猜测进程内状态。**

换句话说：

- pause / debug 不再只是 engine 内部开关；
- 它们被提升为“可查询、可切换、可验证”的控制面能力；
- route 仍保持 one api per file，service 负责状态语义，web 只消费 HTTP 契约。

## 真实测试

运行 app server 真实端到端测试：

\`\`\`bash
RUN_REAL_APP_SERVER_TEST=1 bun test src/app/server/__tests__/real-app-server.test.ts
\`\`\`

真实测试会读取当前工作区 \`.env\`，没有时回退读取上层仓库 \`.env\`，并设置 \`OOC_PROVIDER=openai\`。
`,
};
