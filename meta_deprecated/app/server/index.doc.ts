import * as appServer from "@src/app/server/index";
import * as appServerConfig from "@src/app/server/bootstrap/config";
import * as appServerWorker from "@src/app/server/runtime/worker";

/**
 * AppServer — OOC 控制面 HTTP 服务（Elysia），把内核能力暴露为 API。
 *
 * sources:
 *  - server  — Elysia app entry (src/app/server/index.ts)
 *  - config  — --world / OOC_WORLD_DIR / OOC_BASE_DIR / cwd 解析
 *  - worker  — run-thread / resume-thread job 轮询执行器
 */
export const app_server_v20260511_1 = {
  title: "AppServer",
  sources: {
    server: appServer,
    config: appServerConfig,
    worker: appServerWorker,
  },
  content: `
App Server 是 OOC 的控制面 HTTP 服务，位于 src/app/server，使用 Elysia 实现。

职责：
- 将 stone / flow / runtime 等 OOC 内核能力暴露为 HTTP API
- 为 UI 和工程工具提供稳定的控制面入口
- 管理进程内 job、global pause、session pause 与 resume
- 提供只读 world 浏览接口与本地 debug HTML
- 只通过 HTTP 暴露 ui_methods，不暴露 llm_methods
  `.trim(),

  startup: {
    title: "启动约定",
    summary: "本仓库根是源码目录而非 world，必须显式传 --world",
    content: `
本仓库根目录是源码目录，**不是** world 数据目录。启动 app server 必须显式传
\`--world\`，否则 server 会把源码目录当成 world，写出 flows/ / stones/ 到代码树里。

约定 world 目录：\`./.ooc-world\`（已 gitignore）。

启动命令：

\`\`\`bash
bun --env-file=.env src/app/server/index.ts --world ./.ooc-world
\`\`\`

config.ts 解析顺序为 \`--world flag → OOC_WORLD_DIR env → OOC_BASE_DIR env →
process.cwd()\`，因此 .env 里也可固化 OOC_WORLD_DIR，但 CLI 起 server 时优先用
flag 明示，避免误用其它 env。
    `.trim(),
  },

  modules: {
    title: "模块",
    summary: "health / runtime / stones / flows / ui / debug-ui 六个模块",
    content: `
- **health**：GET /api/health
- **runtime**：LLM 配置、job 查询、global pause、debug 状态切换，以及 debug 文件读取
- **stones**：stone object 创建、读写 self/readme/data/server source、knowledge 目录/文件创建与更新、call_method
- **flows**：session 列表/创建、flow object 创建、thread 查询/继续、session pause/resume、call_method
- **ui**：GET /api/tree、GET /api/tree/file，为 web 提供 world / flows / stones 的只读目录树与文件读取
- **debug-ui**：GET /debug、GET /debug/chat.html，本地最小调试页面

runtime 当前已经形成一组稳定的控制面接口：

- GET /api/runtime/llm-config
- GET /api/runtime/jobs
- GET /api/runtime/jobs/:jobId
- GET|POST /api/runtime/global-pause/*
- GET|POST /api/runtime/debug/*
- GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug
- GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex

调试文件读取的实现边界：
- 这两条 debug 文件读取接口允许通过 query baseDir 覆盖 world 根目录；未传时
  回退到 \`process.cwd()\`，不是固定读取 server 启动时的 \`config.baseDir\`。
- 缺文件时返回 404；文件存在但 JSON 损坏时返回 500；成功返回的是已解析 JSON。

ui 模块只做 tree / file 的只读浏览，不负责 session、chat、stone knowledge 写入；
写操作继续走 flows / stones / runtime 模块。
    `.trim(),
  },

  treeAndDebugUI: {
    title: "UI / Debug UI 的真实能力边界",
    summary: "tree 整树返回 + dotfile 过滤 + marker；debug 页面已具备闭环调试",
    content: `
- \`GET /api/tree\` 当前是**服务端递归返回整棵目录树**，不是节点级懒加载
- tree 会过滤 dotfiles / dot directories，并在一级 \`flows/{sessionId}\`、
  \`stones/{objectId}\` 节点打上 \`marker=flow|stone\`，供 web 识别入口
- \`GET /api/tree/file\` 会做 world 根目录内的安全路径校验；绝对路径、.. 逃逸或
  非文件路径都会被拒绝
- \`/debug/chat.html\` 不是纯静态占位页；已具备 create stone、create session/object、
  continue root thread、自动刷新，以及查看 process events / thread context /
  API trace 的人工调试闭环
    `.trim(),
  },

  directoryConvention: {
    kind: "example",
    title: "目录约束（feature-based + one api per file）",
    content: `
\`\`\`
src/app/server/modules/<feature>/
├── index.ts
├── service.ts
├── model.ts
└── api.<action>.ts
\`\`\`

\`index.ts\` 只做 route composition；业务逻辑放在 \`service.ts\` 或 \`runtime/\` 下。
    `.trim(),
  },

  worker: {
    title: "Worker 与 Job 语义",
    summary: "build-thread / continue-thread / resume-thread 的 job 入队与执行规则",
    content: `
flow object 创建后总会创建 root thread，但只有带 \`initialMessage\` 时才会入队
run-thread job。

- **createFlowObject**：无 initialMessage 时只建 session/object/root thread，不自动跑模型
- **continueThread**：把用户消息写入 inbox，并请求 run-thread job
- **resumeSession**：扫描 session 下所有 paused thread，翻回 running，并为每个
  线程补一个 resume-thread job

实现细节：
- **run-thread job 去重**：按 sessionId + objectId 做去重；若该 object 已有
  queued/running job，控制面直接复用旧 job，而不是创建新 job
- **resume-thread job 不去重**：语义上是对某个 paused thread 的一次显式恢复
- **worker 标记 done ≠ 线程到达 done**：仅表示"这次 worker 调度完成"；
  workerMaxTicks 可能让线程停在 running / waiting / paused，等待下一次 job
- 默认生产配置启用 worker：\`OOC_WORKER_ENABLED !== "0"\`
- 测试中可通过 \`workerEnabled: false\` 关闭 worker，避免普通测试访问真实 LLM
- worker 轮询 queued job，成功 done、异常 failed

app server 管的不是"请求即完成"的同步动作，而是一层显式的 runtime orchestration：
建线程、入队、轮询、恢复都要通过 server 的 job 语义串起来。
    `.trim(),
  },

  resumeSemantics: {
    kind: "invariant",
    title: "Resume = 接着执行已拿到但未消费的 LLM 输出",
    summary: "pause 卡在 LLM 输出已拿到、tool 尚未执行；resume 接力的是后半轮",
    content: `
resume 不是"重跑一轮模型"，而是"接着执行上一次已经拿到但尚未消费的 LLM 输出"：

- server 从 \`threads/{threadId}/debug/llm.output.json\` 读取上一次保存的输出
- 若其中有 assistant text，会先补回 thread events
- 若其中有 tool calls，会逐个重新分派到 executable tools 执行
    `.trim(),
    rationale: `
不重跑模型可以避免一次 LLM 调用被 pause / resume 重复扣费；同时让 pause 拥有
"半轮粒度"语义——LLM 输出已经定型，仅 tool 执行被人为中断，恢复后从 tool 执行
开始继续推进，行为可预期。
    `.trim(),
  },

  errorAndRuntimeBoundary: {
    title: "错误模型与运行时边界",
    summary: "AppServerError 统一映射；pause/job/debug 是进程内状态而非 world 真相",
    content: `
- \`AppServerError\` 统一映射成 JSON 错误对象与明确的 HTTP 状态码，不一律 500
- \`pauseStore\` / \`jobManager\` / observable debug 开关都是**进程内状态**：
  提供稳定 API，但不是 world 持久化真相
- app server 启动时通过 \`setPauseChecker(...)\` 把 session/global pause 注入
  observable / thinkloop；web 只能查询和触发这些状态，不能自行推断
- ui/tree 与 stones/knowledge 的路径都必须经过 server 侧安全校验，防止越出
  baseDir 或 knowledge 根目录
    `.trim(),
  },

  testLayers: {
    title: "测试分层",
    summary: "service / routes / local e2e / real e2e 四层",
    content: `
- **service tests**：模块业务逻辑单测，快速稳定
- **routes tests**：controller / route 层接口测试，验证 schema 与路由装配
- **local e2e**：基于临时 baseDir 的控制面闭环，不依赖真实 LLM
- **real e2e**：真实 LLM 链路，默认跳过，显式开关才运行

运行 app server 真实端到端测试：

\`\`\`bash
RUN_REAL_APP_SERVER_TEST=1 bun test src/app/server/__tests__/real-app-server.test.ts
\`\`\`

真实测试会读取当前工作区 \`.env\`，没有时回退读取上层仓库 \`.env\`，并设置
\`OOC_PROVIDER=openai\`。
    `.trim(),
  },

  controlPlaneEvolution: {
    title: "控制面演进：让进程内状态可观测可切换",
    summary: "pause / debug 从 engine 内部开关提升为可查询可切换的 HTTP 能力",
    content: `
- runtime 模块不仅暴露全局 pause：
  - \`GET /api/runtime/global-pause/status\`
  - \`POST /api/runtime/global-pause/enable\`
  - \`POST /api/runtime/global-pause/disable\`
- observable debug 的进程内开关也变成 HTTP 能力：
  - \`GET /api/runtime/debug/status\`
  - \`POST /api/runtime/debug/enable\`
  - \`POST /api/runtime/debug/disable\`
- flows 列表附带 session 的 paused 状态，供 web 控制面直接展示与切换

设计原则：**控制面状态必须通过 server 明确出入口，而不是让 web 猜测进程内状态。**

换句话说：
- pause / debug 不再只是 engine 内部开关
- 它们被提升为"可查询、可切换、可验证"的控制面能力
- route 仍保持 one api per file，service 负责状态语义，web 只消费 HTTP 契约
    `.trim(),
  },
};
