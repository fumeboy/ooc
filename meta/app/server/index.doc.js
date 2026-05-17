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

## 启动约定（本仓库）

本仓库根目录 \`~/x/ooc/ooc-2\` 是源码目录，**不是** world 数据目录。
启动 app server 必须显式传 \`--world\`，否则 server 会把源码目录当成 world，导致写出
\`flows/\` / \`stones/\` 文件夹到代码树里。

约定 world 目录：\`~/x/ooc/ooc-2/.ooc-world-test\`（已 gitignore）。

启动命令：

\`\`\`bash
cd.
bun --env-file=.env src/app/server/index.ts --world ./.ooc-world-test
\`\`\`

\`config.ts\` 解析顺序为 \`--world\` flag → \`OOC_WORLD_DIR\` env → \`OOC_BASE_DIR\` env →
\`process.cwd()\`，因此 \`.env\` 里也可固化 \`OOC_WORLD_DIR\`，但 CLI 起 server 时优先用 flag
明示，避免误用其它 env。

## 职责

- 将 stone / flow / runtime 等 OOC 内核能力暴露为 HTTP API。
- 为 UI 和工程工具提供稳定的控制面入口。
- 管理进程内 job、global pause、session pause 与 resume。
- 额外提供只读 world 浏览接口与本地 debug HTML，方便 web 与人工排查共享同一控制面。
- 只通过 HTTP 暴露 \`ui_methods\`，不暴露 \`llm_methods\`。

## 模块

- health：\`GET /api/health\`
- runtime：LLM 配置、job 查询、global pause、debug 状态切换，以及 debug 文件读取
- stones：stone object 创建、读写 self/readme/data/server source、knowledge 目录/文件创建与更新、\`call_method\`
- flows：session 列表/创建、flow object 创建、thread 查询/继续、session pause/resume、\`call_method\`
- ui：\`GET /api/tree\`、\`GET /api/tree/file\`，为 web 提供 world / flows / stones 的只读目录树与文件读取
- debug-ui：\`GET /debug\`、\`GET /debug/chat.html\`，用于本地最小调试页面

其中 runtime 当前已经形成一组稳定的控制面接口：

- \`GET /api/runtime/llm-config\`
- \`GET /api/runtime/jobs\`
- \`GET /api/runtime/jobs/:jobId\`
- \`GET|POST /api/runtime/global-pause/*\`
- \`GET|POST /api/runtime/debug/*\`
- \`GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug\`
- \`GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex\`

调试文件读取还有两个当前实现边界需要显式说明：

- 这两条 debug 文件读取接口允许通过 query \`baseDir\` 覆盖 world 根目录；未传时回退到 \`process.cwd()\`，不是固定读取 server 启动时的 \`config.baseDir\`。
- 缺文件时返回 404；文件存在但 JSON 损坏时返回 500；成功返回的是已解析 JSON，而不是原始文本。

而 ui 模块的边界也要明确：它只做 tree / file 的只读浏览，不负责 session、chat、stone knowledge 写入；写操作继续走 flows / stones / runtime 模块。

## UI / Debug UI 的真实能力边界

- \`GET /api/tree\` 当前是**服务端递归返回整棵目录树**，不是节点级懒加载。
- tree 会过滤 dotfiles / dot directories，并在一级 \`flows/{sessionId}\`、\`stones/{objectId}\` 节点打上 \`marker=flow|stone\`，供 web 识别会话与对象入口。
- \`GET /api/tree/file\` 会做 world 根目录内的安全路径校验；绝对路径、\`..\` 逃逸或非文件路径都会被拒绝。
- \`/debug/chat.html\` 不是纯静态占位页；它已经具备 create stone、create session/object、continue root thread、自动刷新，以及查看 process events / thread context / API trace 的人工调试闭环。

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

flow object 创建后总会创建 root thread，但只有带 \`initialMessage\` 时才会入队 \`run-thread\` job。

- \`createFlowObject\`：无 \`initialMessage\` 时只建 session/object/root thread，不自动跑模型
- \`continueThread\`：会把用户消息写入 inbox，并请求 \`run-thread\` job
- \`resumeSession\`：会扫描 session 下所有 paused thread，把线程状态翻回 running，并为每个线程补一个 \`resume-thread\` job

补充当前实现细节：

- \`run-thread\` job 会按 \`sessionId + objectId\` 做去重；若该 object 已有 \`queued/running\` job，控制面会直接复用旧 job，而不是再创建一个新的 job。
- \`resume-thread\` job 不做去重，因为它语义上是对某个 paused thread 的一次显式恢复动作。
- worker 把 job 标记为 \`done\`，只表示“这次 worker 调度完成”；并不等同于 thread 一定已经到达 \`done\` 终态。\`workerMaxTicks\` 可能让线程停在 \`running / waiting / paused\` 中间状态，等待下一次 job 或人工操作继续推进。

- 默认生产配置启用 worker：\`OOC_WORKER_ENABLED !== "0"\`
- 测试中可通过 \`workerEnabled: false\` 关闭 worker，避免普通测试访问真实 LLM
- worker 轮询 queued job，执行成功后标记为 \`done\`，异常时标记为 \`failed\`

这意味着 app server 管的不是“请求即完成”的同步动作，而是一层显式的 runtime orchestration：建线程、入队、轮询、恢复都要通过 server 的 job 语义串起来。

## Resume 的真实语义

\`resume\` 不是“重跑一轮模型”，而是“接着执行上一次已经拿到但尚未消费的 LLM 输出”：

- server 从 \`threads/{threadId}/debug/llm.output.json\` 读取上一次保存的输出
- 若其中有 assistant text，会先补回 thread events
- 若其中有 tool calls，会逐个重新分派到 executable tools 执行

因此 pause / resume 的边界是：**pause 卡在 LLM 输出已拿到、tool 尚未执行；resume 恢复的是这一半轮的后半段。**

## 错误模型与运行时边界

- \`AppServerError\` 会被统一映射成 JSON 错误对象与明确的 HTTP 状态码，而不是一律 500。
- \`pauseStore\`、\`jobManager\`、observable debug 开关都是**进程内状态**：它们提供稳定 API，但不是 world 持久化真相。
- app server 启动时会通过 \`setPauseChecker(...)\` 把 session/global pause 注入 observable / thinkloop；web 只能查询和触发这些状态，不能自行推断。
- ui/tree 与 stones/knowledge 的路径都必须经过 server 侧安全校验，防止越出 \`baseDir\` 或 knowledge 根目录。

## 测试分层

- service tests：模块业务逻辑单测，快速稳定
- routes tests：controller / route 层接口测试，验证 schema 与路由装配
- local e2e：基于临时 baseDir 的控制面闭环，不依赖真实 LLM
- real e2e：真实 LLM 链路，默认跳过，显式开关才运行

## 本轮控制面演进补充

- runtime 模块现在不仅暴露全局 pause：
  - \`GET /api/runtime/global-pause/status\`
  - \`POST /api/runtime/global-pause/enable\`
  - \`POST /api/runtime/global-pause/disable\`
- 同时也把 observable debug 的进程内开关变成了 HTTP 能力：
  - \`GET /api/runtime/debug/status\`
  - \`POST /api/runtime/debug/enable\`
  - \`POST /api/runtime/debug/disable\`
- flows 列表会附带 session 的 \`paused\` 状态，供 web 控制面直接展示与切换。

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
