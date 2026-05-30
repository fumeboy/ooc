/**
 * 文档维护说明（App Server 子树）
 *
 * 本文件是 App Server 概念子树，遵循 OOC 通用 DocTreeNode 规范:
 *
 * 1. children vs patches
 *    - children: app server "由什么组成"（启动、模块、运行时、错误模型、测试...）。
 *    - patches: 边界情况、设计取舍、与直觉相违的约定（例如 baseDir 覆盖、worker job
 *      去重规则、resume 半轮语义等）。
 *
 * 2. top-light, leaf-heavy
 *    - 根节点 content 只回答 "app server 是什么、由哪几块组成"。
 *    - 路由表、文件路径、行为契约下沉到对应的叶节点。
 *
 * 3. named 字典
 *    只收 content 中真出现且需要单独解释的术语（如 AppServerError、pauseStore、
 *    workerMaxTicks），不堆砌名词表。
 *
 * 4. todo / warnings
 *    - todo: 设计上承诺、代码未实现的能力。
 *    - warnings: 已知问题与易踩的坑（如忘了 --world 会污染源码树、旧 server 进程
 *      残留导致 404）。
 *
 * 5. 与源代码的一致性
 *    叶节点引用源码用 `src/app/server/...` 相对路径；不确定的路径不写。
 */

type DocTreeNode = {
    title: string;
    content?: string;

    named?: Record<string, string>;

    children?: Record<string, DocTreeNode>;
    patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]];
    sources?: [[any, string]];

    todo?: string[];
    warnings?: string[];
};

/**
 * App Server 文档树的根节点。
 *
 * 只回答 app server 在 OOC 中的角色与组成；具体路由、worker 语义、错误模型
 * 等下沉到 children / patches。
 */
export const root: DocTreeNode = {
    title: "App Server",
    content: `
App Server 是 OOC 的控制面 HTTP 服务，位于 src/app/server，基于 Elysia 实现。
它把 stone / flow / runtime 等内核能力暴露为 HTTP API，给 web 控制面、工程工具
和人工调试使用。

由以下几块组成:
- bootstrap: 启动入口、config 解析、错误模型、签名 hash
- modules: 按 feature 组织的路由模块（health / runtime / stones / pools / flows / ui / world-config）
- runtime: 进程内 job / worker / pause / resume / thread query 等运行时编排
- testLayers: service / routes / local e2e / real e2e 四层测试

设计取向上 app server 不是"请求即完成"的同步接口层，而是一层显式的 runtime
orchestration: 建线程、入队 job、轮询、恢复、pause/resume 都通过 server 的
job 语义串起来；进程内状态（pause / debug 开关）也通过 HTTP 暴露成可查询、
可切换的控制面能力，而不是让 web 去猜 engine 内部状态。
    `.trim(),

    named: {
        "App Server": "OOC 的控制面 HTTP 服务，基于 Elysia，位于 src/app/server",
        "控制面": "面向 web/工程工具/人工调试的稳定接口层，与 engine 内部 runtime 解耦",
        "ui_methods": "Object 暴露给 UI 调用的方法集合；只有它通过 HTTP 暴露",
        "window.commands": "Object 暴露给 LLM 调用的方法集合；不通过 HTTP 暴露",
    },

    children: {
        bootstrap: {
            title: "Bootstrap — 启动与配置",
            content: `
app server 的入口与启动期配置都在 src/app/server/bootstrap 与顶层 index.ts。

- src/app/server/index.ts: Elysia app 装配 + 启动入口
- src/app/server/bootstrap/config.ts: world 根目录解析
- src/app/server/bootstrap/errors.ts: AppServerError 与统一错误模型
- src/app/server/bootstrap/hash.ts: 启动期签名/校验工具
            `.trim(),
            children: {
                worldRoot: {
                    title: "world 根目录解析顺序",
                    content: `
config 解析顺序: \`--world flag → OOC_WORLD_DIR env → OOC_BASE_DIR env → process.cwd()\`。

本仓库根仅放代码与 meta，**不是** world 数据目录。约定 world 目录为
\`./.ooc-world\`（已 gitignore）。

启动命令必须显式传 \`--world\`:

\`\`\`bash
bun --env-file=.env src/app/server/index.ts --world ./.ooc-world
\`\`\`

.env 也可固化 \`OOC_WORLD_DIR\`，但 CLI 起 server 时优先用 flag 明示，避免误用
其它 env。
                    `.trim(),
                    warnings: [
                        "不带 --world 时 config 回退到 process.cwd()，把源码目录当 world，会在代码树写出 flows/ / stones/ —— 严禁。",
                    ],
                },
                port: {
                    title: "端口环境变量",
                    content: `
app server 读取的端口环境变量是 \`OOC_APP_PORT\`，不是 \`OOC_PORT\`。切端口后
若服务仍起在 3000，应优先检查环境变量名是否写对。
                    `.trim(),
                },
                errors: {
                    title: "AppServerError 统一错误模型 / onError 全覆盖包络",
                    content: `
所有控制面错误统一走 \`AppServerError\`（src/app/server/bootstrap/errors.ts），
映射成 JSON 错误对象与明确 HTTP 状态码，不一律返回 500。

**根因 #8（2026-05-24）onError 全覆盖**：src/app/server/index.ts 的 onError handler
不再只处理 AppServerError，而是统一所有错误来源为
\`{error:{code,message,details}}\` 包络：

- \`AppServerError\` → ERROR_HTTP_STATUS 映射（必须优先判定，避免
  AppServerError("NOT_FOUND") 被 Elysia 的 elysiaCode="NOT_FOUND" 错认成 route 未匹配）
- Elysia route 未匹配（elysiaCode="NOT_FOUND" / NotFoundError）→ 404 +
  details.{path,method}（修 R5 #38 /health 500、R6 #49 code+message 自相矛盾）
- Elysia ValidationError → 422，details 压缩为 \`[{path,expected,message}]\`，
  message 取首项 summary（修 R2 #8 >2KB 嘈杂；不再嵌套整个 schema JSON）
- 裸 fs ENOENT/EISDIR → 404 NOT_FOUND
- 兜底 → 500 INTERNAL_ERROR

**契约**：service 层错误一律 \`throw new AppServerError(code, msg, details)\`，
端点层不要 \`set.status=404; return {code,...}\` 裸返回——否则形态分裂（R3 #16 根因）。
                    `.trim(),
                },
            },
        },

        modules: {
            title: "Modules — feature-based 路由模块",
            content: `
src/app/server/modules 下按 feature 组织，每个 feature 一个目录，路由按
"one api per file"拆分:

\`\`\`
src/app/server/modules/<feature>/
├── index.ts        // 只做 route composition
├── service.ts      // 业务逻辑
├── model.ts        // schema / 类型
└── api.<action>.ts // 每个端点一个文件
\`\`\`

当前模块清单: health / runtime / stones / pools / flows / ui / world-config。
只有 ui_methods 走 HTTP 暴露，window.commands 不暴露。
            `.trim(),
            children: {
                health: {
                    title: "health",
                    content: `
最小存活探针。

- GET /api/health — src/app/server/modules/health/api.health.ts
                    `.trim(),
                },
                runtime: {
                    title: "runtime",
                    content: `
LLM 配置、job 查询、global pause、observable debug 开关、以及 debug 文件读取。
src/app/server/modules/runtime/。

稳定的控制面端点:
- GET /api/runtime/llm-config
- GET /api/runtime/jobs
- GET /api/runtime/jobs/:jobId
- GET  /api/runtime/global-pause/status
- POST /api/runtime/global-pause/enable
- POST /api/runtime/global-pause/disable
- GET  /api/runtime/debug/status
- POST /api/runtime/debug/enable
- POST /api/runtime/debug/disable
- GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug
- GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex
                    `.trim(),
                    named: {
                        "global pause": "进程内全局暂停开关，影响所有 thinkloop 调度",
                        "observable debug": "进程内 observable 调试开关，控制是否落 debug 文件",
                    },
                },
                stones: {
                    title: "stones",
                    content: `
stone object 的创建、读写与 call_method。src/app/server/modules/stones/。

覆盖能力:
- create-stone / list-stones / get-stone
- self / readme / data / executable-source 的 get/put/patch
- knowledge 目录与文件 (create/put)：**已迁到 pool 模块**（2026-05-24，根因 #3）；
  旧路径 \`/api/stones/.../knowledge/...\` 保留兼容，加 \`X-Deprecated: true\` header，
  下个 major 移除。新代码用 \`/api/pools/.../knowledge/...\`。
- call-method (ui_methods)

**🔥 HTTP 必经 versioning 契约（2026-05-24 root-cause #2）**：

所有写 stone 的 HTTP 操作（create-stone / put-self / put-readme / put-executable-source）
**必须走 stone-versioning 流程**：opens metaprog worktree → write in worktree →
commitWorktree → tryMergeSelf（self-scope ff merge）或 requestPrIssueReview（cross-scope）。

理由（设计哲学 - 契约 3：状态翻转唯一 owner）：
- 不存在 "uncommitted working tree" 半成品状态——HTTP 直写后 main worktree 看不到，
  openMetaprogWorktree 后 metaprog worktree 也看不到，dogfooding 第一步崩。
- HTTP 是 LLM 命令的薄包装；两条入口共享同一底层语义。
- 每个 stone 写操作都有 git commit，audit trail 完整。

实现细节: 见 src/app/server/modules/stones/versioning-helper.ts:wrapHttpWriteInWorktree。

注意 knowledge 文件 (create-knowledge-file / put-knowledge-file) **不在此契约内**：
那些写入 \`pools/objects/<id>/knowledge/\`（sediment knowledge, pool 层，不进 git）；
路径已迁到 \`/api/pools/...\`（详见 children.pools）；旧 \`/api/stones/.../knowledge/...\`
保留兼容并加 \`X-Deprecated\` header。
                    `.trim(),
                },
                pools: {
                    title: "pools",
                    content: `
pool 层 HTTP 入口。src/app/server/modules/pools/。

**为什么独立**（2026-05-24，根因 #3）：pool 是 OOC 三分（stone/pool/flow）的事实层，
不挂 branch、不进 git；knowledge / data / files 都在这里沉淀。旧实现把 knowledge 路径
挂在 \`/api/stones/.../knowledge\` 下，与实际写入位置（\`pools/objects/<id>/knowledge/\`）
**语义错位**——任何按路径 grep "knowledge" 的人都会被误导到 stone 上。

当前覆盖能力（一一对称旧 stones knowledge 路径）:
- POST /api/pools/:objectId/knowledge/directories
- POST /api/pools/:objectId/knowledge/files
- PUT  /api/pools/:objectId/knowledge/files (覆盖需 \`X-Overwrite-Confirm: true\`)

**反熵**：不引入新 service——复用 \`createStonesService\` 的 createKnowledgeFile /
putKnowledgeFile / createKnowledgeDirectory（这些函数本来就写到 pool 路径）；
路由是路径标签变化，不是新业务逻辑。

**deprecation 路径**：\`/api/stones/.../knowledge/*\` 保留并 set \`X-Deprecated: true\` +
\`X-Deprecation-Info: Use /api/pools/...\` header，同时 console.warn（非测试环境）。
下个 major 移除。
                    `.trim(),
                    todo: [
                        "后续扩展 pool 其它能力的 HTTP 入口（data csv / files / relations）时也在本模块加 route。",
                        "下个 major 删除 stones 的 deprecated knowledge routes。",
                    ],
                },
                flows: {
                    title: "flows",
                    content: `
session / flow object / thread 的生命周期与 call_method。
src/app/server/modules/flows/。

覆盖能力:
- create-session / list（含 paused 状态）/ seed-session
- create-flow-object / get-flow-object
- list-threads / get-thread / continue-thread
- pause-session / resume-session
- call-method (ui_methods)

flows 列表附带 session 的 paused 状态，供 web 直接展示与切换。
                    `.trim(),
                },
                ui: {
                    title: "ui",
                    content: `
为 web 提供 world / flows / stones 的只读浏览，以及 frontend 路径解析权威。
src/app/server/modules/ui/。

- GET /api/tree?scope=world|flows|stones&path=... — 服务端递归返回整棵目录树（非懒加载），
  过滤 dotfiles，并基于**目录下元数据文件存在性**打 \`marker=flow|stone|pool\`
  （详见 patches.treeMarkerByMetadata）。
- GET /api/tree/file — world 根目录内的安全文件读取，拒绝绝对路径 / .. 逃逸 / 非文件
- GET /api/file/read — 工程接口，绕过 baseDir 隔离读取任意本地文件，仅供受信任的本地 UI 使用
  （见 patches.pathSecurity）
- GET /api/objects/:scope/:objectId/client-source-url — 根因 #3 (2026-05-24)：
  frontend 不再硬编码 \`stones/<id>/client/index.tsx\` 路径，统一调本 endpoint
  拿 backend 权威解析的 \`{ absPath, fsUrl }\`；scope=stone | flow，flow 需带
  \`?sessionId=...&page=...\`。不存在 → 404 NOT_FOUND，frontend fallback 到
  StoneFallback / NotProducedYet。详见 patches.clientSourceUrl。

ui 只做只读浏览 + 路径解析，不负责 session、chat、knowledge 写入；写操作走
flows / stones / pools / runtime。
                    `.trim(),
                    todo: [
                        "src/app/server/modules/ui/api.list-flows.ts 定义了 GET /api/flows，但 index.ts 未 use(listFlowsApi)，service.ts 也没有 listFlows 实现，调用会 runtime TypeError —— 该文件是孤儿，需后续清理或补齐挂载。",
                    ],
                    patches: {
                        treeMarkerByMetadata: {
                            title: "tree marker 基于后端元数据权威（2026-05-24，根因 #3）",
                            content: `
**旧实现**：marker 用 path-prefix 启发式判断——\`parts[0]==="stones" && parts.length===2\` → marker=stone。
2026-05-21 stones 重组（加 \`<branch>/objects/\` 中间层）后 stone 路径变为 4 段，启发式失效，
sidebar tree 看不到 stone marker（R6 Issue #43 同源 facet）。

**新实现**：在 src/app/server/modules/ui/service.ts:markerFor() 中检查目录下的元数据文件：
- 含 \`.stone.json\` → marker="stone"
- 含 \`.pool.json\`  → marker="pool"
- 含 \`.flow.json\` 或 \`.session.json\` → marker="flow"
- 都不含 → undefined（普通目录）

元数据文件由 \`src/persistable/{stone,pool,flow}-object.ts\` 在 createXxxObject 时写入；
ui 只做 fs.access 存在性检查，不解析内容（便宜、解耦）。

**契约 1（接口 explicit）**: frontend 不再假设 backend 存储路径，所有 marker 由 backend
基于元数据权威给出；任何路径重组（如 2026-05-21 加 objects/ 中间层）都不会让前端漂移。
                            `.trim(),
                        },
                        clientSourceUrl: {
                            title: "client-source-url endpoint（2026-05-24，根因 #3）",
                            content: `
**为什么需要**：frontend \`ObjectClientRenderer\` 旧实现硬编码
\`\${WORLD_ROOT}/stones/\${id}/client/index.tsx\`；2026-05-21 stones 重组后实际路径变成
\`stones/main/objects/<id>/client/index.tsx\`，硬编码漂移，stone client 全部 404。

**新形态** (src/app/server/modules/ui/api.client-source-url.ts):
- GET /api/objects/stone/:objectId/client-source-url
  → { absPath, fsUrl } 用 \`stoneDir()\` 解析 \`stones/<branch>/objects/<id>/client/index.tsx\`
- GET /api/objects/flow/:objectId/client-source-url?sessionId=<sid>&page=<page>
  → { absPath, fsUrl } 用 \`objectDir()\` 解析 \`flows/<sid>/objects/<id>/client/pages/<page>.tsx\`
- 404 NOT_FOUND（文件不存在）/ INVALID_INPUT（缺 sessionId/page 等）

**frontend 调用**：\`ObjectClientRenderer\` 在 mount 时 \`requestJson\` 拿 fsUrl，
直接 \`import(fsUrl)\` 加载组件；endpoints.clientSourceUrl 是统一入口。

**契约 1**：frontend 不假设 backend 路径，所有 path 解析必经 backend resolver。
                            `.trim(),
                        },
                    },
                },
                // issues 模块已于 2026-05-26 随 issue 看板整套移除：
                // src/app/server/modules/issues/ 已删，/api/flows/:sid/issues* 路由不再注册
                // （权威移除声明见 meta/object.doc.ts root.warnings；勿重新引入）。
                // debug-ui 模块已于 2026-05-25 废弃删除：随路由协议演化失维
                // （体验官 Round 8 R8-1 报告 chat.html 仍调旧路由），
                // 用 web/ 前端控制面替代（详见 meta/app.client.doc.ts）。
            },
        },

        runtime: {
            title: "Runtime — 进程内 job / worker / pause / resume",
            content: `
src/app/server/runtime/ 提供 app server 的运行时编排基础设施。

组成:
- job-manager.ts: job 队列、入队、查询、状态机
- worker.ts: 轮询 queued job 的执行器
- pause-store.ts: 进程内 session/global pause 状态
- resume.ts: paused thread 的恢复语义
- thread-query.ts / thread-transition.ts: 线程查询与状态迁移
- types.ts: 运行时共享类型

app server 启动时通过 \`setPauseChecker(...)\` 把 session/global pause 注入
observable / thinkloop；web 只能查询和触发这些状态，不能自行推断。
            `.trim(),
            named: {
                "job": "一次 worker 调度任务，常见类型为 run-thread / resume-thread",
                "pauseStore": "进程内 pause 状态存储，非 world 持久化",
                "jobManager": "进程内 job 队列与状态机",
            },
            children: {
                jobs: {
                    title: "Job 类型与入队规则",
                    content: `
- **createFlowObject**: 无 initialMessage 时只建 session/object/root thread，**不**自动跑模型；
  带 initialMessage 时入队 run-thread job。
- **continueThread**: 通过 user.root 的 talk_window 派送（talk-delivery 双写
  user.outbox + callee.inbox），然后 enqueue run-thread job 给 callee 所属 object，
  而不是直接写入"当前 thread"的 inbox。
- **resumeSession**: 扫描 session 下所有 paused thread，翻回 running，并为每个
  线程补一个 resume-thread job。
                    `.trim(),
                },
                worker: {
                    title: "Worker 执行规则（事件驱动）",
                    content: `
worker **只跑队列**：从 jobManager 取 queued job 跑 → 成功标 done / 异常标 failed。
不再周期扫 fs 兜底入队（2026-05-24 根因 #5 改造，删除旧 enqueueOrphanRunningThreads
路径以避免 waiting thread 被 10 jobs/s 线性膨胀入队 → jobManager 内存无 cap 爆炸）。

- 默认生产配置启用 worker: \`OOC_WORKER_ENABLED !== "0"\`
- 测试中可通过 \`workerEnabled: false\` 关闭 worker，避免普通测试触达真实 LLM
- worker "标记 done" ≠ 线程到达 done；仅表示"这次 worker 调度完成"，
  \`workerMaxTicks\` 可能让线程停在 running / waiting / paused，等待下一次 job

**状态翻转 → enqueue 由事件源直接触发**（src/observable.notifyThreadActivated）：
- **talk-delivery**（caller talk_window.say → deliver 到 callee inbox）→ enqueue callee
- **do_window.continue**（父→子 / 子→父 inbox 写入）→ enqueue target thread
- **issue appendComment**（HTTP + LLM 命令两个入口都调）→ enqueue 所有订阅 thread（排除 author）
- **end command**（无 result 时手工 notify creator；带 result 时通过内部 continue/say 自动 notify）
- **resume**（HTTP resume-session）→ 显式 enqueue resume-thread job
- **seedSession / createFlowObject(initialMessage)/ continueThread** → flows/service.ts 显式 enqueue
- **scheduler yield**（runJob 单次跑满 \`workerMaxTicks\` 自然返回，且 thread.status 仍为 \`running\`）→
  worker 出口主动 \`notifyThreadActivated\` 把自己再入队一次，让长任务跨 job 续跑。
  设计取舍：长任务（如 supervisor 派单 + 验证多步链路）跑超过 15 轮是常态，
  不能让 maxTicks 切片成"静默卡死"；切片本身保留是为了让多 thread 公平共享 worker
  并避免单 thread 占用太久。"running 出 maxTicks → 自唤醒"是这两个目标的唯一兼容点。
  observability：runner 退出前在 thread.events 写一条 \`scheduler_yielded\`
  （category=context_change, kind=scheduler_yielded, reason=max_ticks），让 LLM 在下一个
  job 入口的 context 里看到"我被切片了"，且历史可追溯（区别于"自然 done / paused / failed"）。

启动期兜底（仅一次，非周期）：
- buildServer(workerEnabled=true) 启动 worker 时调 \`enqueueRunningThreadsAtBootstrap\`，
  把磁盘上 running/waiting 的 thread 入队一次。用于覆盖"上次 server crash / 重启后
  仍 running 的 orphan thread"场景；不阻塞启动，失败 warn 不抛。
                    `.trim(),
                    named: {
                        "workerMaxTicks": "单次 worker 调度允许推进的最大 tick 数。优先级：ServerConfig 显式字段 > env OOC_WORKER_MAX_TICKS > .world.json:workerMaxTicks > 默认 15。超出后线程留在中间态，若仍 running 则 runJob 出口自唤醒（见 scheduler yield）",
                        "notifyThreadActivated": "事件源（talk/do/issue/end/scheduler-yield）写完目标 inbox / 退出 thinkloop 后调用的薄通知；由 buildServer 注入 jobManager 后转成 createRunThreadJob",
                        "enqueueRunningThreadsAtBootstrap": "buildServer 启动时一次性扫描入队 orphan running thread，替代旧的周期扫兜底",
                        "scheduler_yielded": "thread.events 中的 context_change kind，由 runJob 在跑满 maxTicks 且 thread 仍 running 时写入；reason=max_ticks。LLM 下轮可见，区别于自然 done / paused / failed",
                    },
                },
            },
        },

        testLayers: {
            title: "测试分层",
            content: `
四层结构:
- **service tests**: 模块业务逻辑单测，快速稳定
- **routes tests**: controller / route 层接口测试，验证 schema 与路由装配
- **local e2e**: 基于临时 baseDir 的控制面闭环，不依赖真实 LLM
- **real e2e**: 真实 LLM 链路，默认跳过，显式开关才运行

运行真实端到端测试:

\`\`\`bash
RUN_REAL_APP_SERVER_TEST=1 bun test src/app/server/__tests__/real-app-server.test.ts
\`\`\`

真实测试会读取当前工作区 \`.env\`，没有时回退读取上层仓库 \`.env\`，并设置
\`OOC_PROVIDER=openai\`。
            `.trim(),
        },
    },

    patches: {
        jobDedup: {
            title: "Job 去重规则: run-thread 去重，resume-thread 不去重",
            content: `
- **run-thread job 去重**: 按 sessionId + objectId 做去重；若该 object 已有
  queued/running job，控制面**复用旧 job** 而不是创建新 job。
- **resume-thread job 不去重**: 语义上是对某个 paused thread 的一次显式恢复，
  每次调用都应入队一个新的 resume job。
            `.trim(),
        },

        resumeSemantics: {
            title: "Resume = 接着执行已拿到但未消费的 LLM 输出（半轮粒度）",
            content: `
resume 不是"重跑一轮模型"，而是"接着执行上一次已经拿到但尚未消费的 LLM 输出":

- server 从 \`threads/{threadId}/debug/llm.output.json\` 读取上一次保存的输出
- 若其中有 assistant text，会先补回 thread events
- 若其中有 tool calls，会逐个重新分派到 executable tools 执行

设计取舍: 不重跑模型可以避免一次 LLM 调用被 pause/resume 重复扣费；同时让 pause
拥有"半轮粒度"语义 —— LLM 输出已经定型，仅 tool 执行被人为中断，恢复后从 tool
执行处继续推进，行为可预期。
            `.trim(),
        },

        debugFileBaseDirOverride: {
            title: "Debug 文件读取允许 baseDir 覆盖",
            content: `
\`GET /api/runtime/.../debug\` 与 \`.../debug/loops/:loopIndex\` 两条端点允许通过
query \`baseDir\` 覆盖 world 根目录；**未传时回退到 \`process.cwd()\`**，不是
固定读取 server 启动时的 \`config.baseDir\`。

返回约定:
- 缺文件 → 404
- 文件存在但 JSON 损坏 → 500
- 成功返回已解析 JSON
            `.trim(),
        },

        processStateNotWorldTruth: {
            title: "pause / job / debug 是进程内状态，不是 world 真相",
            content: `
\`pauseStore\` / \`jobManager\` / observable debug 开关都是**进程内状态**:
提供稳定 HTTP API，但不是 world 持久化真相。

控制面演进的设计原则: **控制面状态必须通过 server 明确出入口，而不是让 web
猜测进程内状态。** 因此 pause / debug 从 engine 内部开关被提升为"可查询、
可切换、可验证"的控制面能力。
            `.trim(),
        },

        pathSecurity: {
            title: "路径安全校验",
            content: `
ui/tree 与 stones/knowledge 的路径都必须经过 server 侧安全校验，拒绝绝对路径、
\`..\` 逃逸、超出 baseDir / knowledge 根目录的访问。

**例外**: \`GET /api/file/read\`（src/app/server/modules/ui/api.read-any-file.ts）
是有意打破 baseDir 隔离的工程接口，service 层显式绕过隔离读取任意本地文件。
它只面向受信任的本地 UI / 调试场景，不应暴露到非可信网络。
            `.trim(),
        },

        superSessionReserved: {
            title: "SUPER_SESSION_ID 保留校验",
            content: `
\`SUPER_SESSION_ID\` 是 reflectable 维度专用的 session id，控制面创建路径会
显式拒绝它: \`createSession\` / \`seedSession\` / \`createFlowObject\` 在
src/app/server/modules/flows/service.ts:40-48 都做了保留校验。

含义: web / 工程工具不应通过控制面去"创建" super session；它由 engine 内部
按需材化，从外部看是只读保留命名。
            `.trim(),
        },

        moduleSingletonFallback: {
            title: "模块级单例 fallback 易在测试中串状态",
            content: `
\`src/app/server/modules/runtime/index.ts:16-17\` 与
\`src/app/server/modules/flows/index.ts:18-19\` 都在模块顶层声明了
\`default*\` 单例（pauseStore / jobManager 等），作为未注入时的 fallback。

后果: 多次 \`buildServer\` 若未显式注入 \`pauseStore\` / \`jobManager\`，会
**复用同一份 module-level 单例**，测试之间容易串状态（pause 未清、job 残留）。

实践: 集成 / e2e 测试请显式构造并注入各 store，不要依赖 fallback。
            `.trim(),
            warnings: [
                "未显式注入 pauseStore / jobManager 时，多个 buildServer 实例会共享 module-level 单例，导致测试间状态污染。",
            ],
        },

        treeIsFullDump: {
            title: "/api/tree 是整树返回而非懒加载",
            content: `
\`GET /api/tree\` 当前是**服务端递归返回整棵目录树**，不是节点级懒加载。
适合中小规模 world；超大 world 时需要重新设计。
            `.trim(),
            todo: [
                "若 world 规模显著增长，将 /api/tree 改为节点级懒加载或分页。",
            ],
        },

        staleServerProcess: {
            title: "本地联调: 404 但非全部 404 多半是旧 server 进程残留",
            content: `
本地控制面 API 出现"部分 404、部分正常"时，未必是代码没写进去，更常见是
**旧 server 进程还活着**占用端口，实际收到请求的是旧实例（路由表无最新变更）。

典型症状:
- \`GET /api/health\` 正常
- 某些旧路由也正常
- 但新加的路由（如 \`GET /api/runtime/debug/status\`）返回 404

排查原则:
- 先看端口监听: \`lsof -nP -iTCP:3000 -sTCP:LISTEN\`
- 若发现多个监听进程，先清理旧进程再启动新 server
- 不要只看 health 是否可用，要直接探测新增路由本身

背后原则: **控制面调试要先确认"你打到的是不是你以为的那个进程"。**
            `.trim(),
        },
    },
};
