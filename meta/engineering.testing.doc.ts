/**
 * 文档维护说明 (engineering.testing.doc)
 *
 * 本文件是 OOC e2e 测试维度的"树形文档源"，与 meta/object.doc.ts 同形态。
 * 维护原则节选 (完整原则见 object.doc.ts):
 *
 * 1. 树形拆解：模糊概念用 children / patches 拆，每层更具体。
 *    - children: 该节点"由什么组成"。
 *    - patches: 补充说明 (边界、设计取舍、横切设计)。
 * 2. top-light / leaf-heavy：根节点只回答 "这是什么、由几块组成"；
 *    具体场景表、Good/OK/Bad 判定规则下沉到叶节点。
 * 3. content 体例：开头一两句定位 → 中段 bullet → 末段衔接源代码。
 * 4. named：只放 content 中真出现且需要单独定位的术语 (Good/OK/Bad、
 *    A/B 观察孔、真 LLM / mock LLM 等)。
 * 5. todo / warnings：
 *    - todo: 设计承诺、代码未实现 (例 scoreScenario fixture)。
 *    - warnings: 已知漂移 (例 md 写 .spec.ts、仓库实为 .pw.ts)。
 * 6. 与源代码一致：叶节点用仓库相对路径锚定真实测试文件。
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
 * Testing 文档树的根节点。
 *
 * 这一层只回答 OOC e2e 测试体系"在测什么、由哪几块组成"，
 * 作为 backend / frontend 两个入口子树以及横切设计 (评分基准、
 * 观察孔、不稳定性政策) 的阅读入口。单元测试不在本树覆盖范围内。
 */
export const root: DocTreeNode = {
    title: "OOC e2e Testing Strategy",
    content: `
    本维度回答："OOC 作为 CodeAgent 是不是真的能用"——通过端到端测试同时验证用户体验与 OOC 机制是否到位。
    单元测试不归本树管 (沿用各模块 __tests__/ 下的 bun:test 自然规范)。

    核心组成:
    1. 两个观察孔 (A/B): A=User story (任务是否真完成); B=OOC 机制 (LLM 走过的 windows / commands / talk-delivery 是否对)。两者同时通过才叫 e2e 通过。
    2. 三档评分基准 (Good / OK / Bad): 每个场景跑完根据可观察事实落到一档；通过门槛 >= OK；Bad 是真信号、OK 多发是黄信号。
    3. 入口分离: backend e2e (HTTP API + worker + LLM + 文件系统) 与 frontend e2e (Web UI + Playwright + 真后端 + 真 LLM) 各一份场景集，独立演进、共享策略。
    4. 横切政策: 真 LLM / mock LLM / 半真三种触发模式，env-gated；CI 单场景允许重试 1 次；OK/Good 趋势归档。
    5. 显式排除: 性能测试、并发隔离、跨浏览器兼容、schema 迁移。

    顶层叙述到此为止；具体场景表、fixture、judge 规则见 children.backend / children.frontend；评分基准与观察孔等横切设计见 patches。
    `,
    named: {
        "e2e": "end-to-end 测试; OOC 上下文中特指 \"用户真把 OOC 当 CodeAgent\" 那条完整链路",
        "观察孔 A": "User story 视角: 任务是否完成、文件是否真改、对话是否回到 user",
        "观察孔 B": "OOC 机制视角: LLM 走过的 commands / windows / talk-delivery 双写 / form 状态流转",
        "Good": "系统按设计的最优路径完成 (推荐命令 + 无绕行)",
        "OK": "任务完成但有可观察的浪费或绕行 (容忍区, 需趋势观察)",
        "Bad": "任务没完成 / 用户看不到结果 / 机制状态错乱; 通过门槛是 >= OK",
        "真 LLM e2e": "走真模型, env-gated, 默认 skip; OOC 主线 e2e 形态",
        "mock LLM e2e": "用脚本化 tool call 序列模拟 LLM, 仅验机制通, 不能替代真 LLM e2e",
        "backend 入口": "HTTP API: POST /api/sessions、continue、GET threads; 直接 app.handle 触发不起端口",
        "frontend 入口": "Web UI: SessionCreator、ChatPanel、ContextSnapshotViewer; Playwright 驱动真浏览器",
    },
    children: {
        backend: {
            title: "Backend e2e 入口",
            content: `
            测试对象: HTTP API + worker + LLM + 文件系统 + thread.json。
            不打开浏览器, 通过 Elysia app.handle(new Request(...)) 直调, 对 worker 执行后的副作用断言。

            范围边界:
            - 不测前端 React 组件 / UI 渲染 (归 frontend 子树)
            - 不测单元级 service 行为 (归各模块 __tests__/service.test.ts)
            - 通过门槛同根节点: 每个场景 tier !== "Bad"

            位置: tests/e2e/backend/*.e2e.test.ts; gate=RUN_BACKEND_E2E=1。
            工具栈、公共 fixture、场景集索引见 children。
            `,
            children: {
                stack: {
                    title: "工具栈与触发约定",
                    content: `
                    - 测试框架: bun:test (现有栈)
                    - HTTP 触发: Elysia app.handle(new Request(...)) 直调, 不必起真端口; 与 real-app-server.test.ts 一致
                    - LLM: 真 LLM via .env (OOC_API_KEY / OOC_BASE_URL / OOC_MODEL); 缺失自动 skip
                    - baseDir: 每场景 mkdtemp 一份, 测试后清理
                    - Worker: workerEnabled: true, workerPollMs: 50ms
                    - 等待完成: waitFor(jobId, status==done|failed) helper
                    - Gate: RUN_BACKEND_E2E=1 环境变量
                    `,
                    sources: [[
                        "src/app/server/__tests__/real-app-server.test.ts",
                        "smoke 测试, 走老 createFlowObject + initialMessage 路径; 与本套件互补不替代"
                    ]],
                },
                fixture: {
                    title: "公共 fixture",
                    content: `
                    位置: tests/e2e/backend/_fixture.ts。
                    职责:
                    - loadRealEnv(): 从 .env 加载 OOC_*
                    - startApp({ baseDir?, seedFiles? }): buildServer + 临时 baseDir + 可选 seed 源码文件
                    - postJson / getJson: fetch helper
                    - seedSession(app, sid, target, initialMessage): POST /api/sessions wrapper
                    - continueAndWait(app, sid, text): POST continue + 等 callee job done
                    - readCalleeThread(baseDir, sid, objectId, threadId): 验机制用
                    - scoreScenario({ thread, files, observations, rules }) -> { tier, details }: 通用评分裁判, 测试断言 tier !== "Bad", console.log(details) 让 CI 留趋势
                    `,
                    sources: [["tests/e2e/backend/_fixture.ts", "本子树共享 fixture 实际文件"]],
                    todo: [
                        "确认 scoreScenario 已在 _fixture.ts 中实现; 若缺, 补齐统一裁判函数",
                    ],
                },
                scenarios: {
                    title: "场景集 (S1-S4)",
                    content: `
                    覆盖 strategy 4.场景拆分原则的四类最小集: 改文件 / 纯读取 / 多轮对话 / 失败回路。
                    每个场景显式列出 Good/OK/Bad 判定条件 (基于测试结束时可观察事实, 非中间 LLM 表达)。
                    每场景跑完 tier !== "Bad"; CI 单场景允许重试 1 次。
                    `,
                    children: {
                        S1_rename: {
                            title: "S1 backend-rename-symbol-via-edit",
                            content: `
                            类别: 改文件。
                            Seed: baseDir/src/foo.ts 含 helperA / helperB 互调。
                            用户消息: 将 src/foo.ts 中 helperA 重命名为 helperZ。

                            Good: thread.status=done; helperA 计数=0、helperZ 计数 = 原 helperA 次数; assistant outbox 含 helperZ; LLM 至少 open 过一次 file_window.edit; 未用 program(language="shell") 改文件。
                            OK: 改对 + 回复了, 但用 sed/write_file 全覆盖, 或 file_window.edit 重试 >= 2 次才成功。
                            Bad: 文件没改/改错/多少改; thread 卡 running/waiting; assistant 无回复或语义错误。
                            `,
                            sources: [["tests/e2e/backend/backend-rename-symbol-via-edit.e2e.test.ts", "实际测试文件"]],
                        },
                        S2_search: {
                            title: "S2 backend-read-only-search",
                            content: `
                            类别: 纯读取。
                            Seed: baseDir/src/{a,b,c}.ts 各含若干 deprecatedFoo, 已知总数 N。
                            用户消息: 找出 src/ 下所有用到 deprecatedFoo 的位置。

                            Good: thread.status=done; 回复数字 = N; LLM 至少 open 过一次 root.grep; 所有文件未被修改; 未 open file_window.edit / write_file。
                            OK: 数字/位置正确但走 program(shell, grep), 或调对 grep 但没 open_match (LLM 自己复述)。
                            Bad: 数字错/没回复, 或修改了文件 (哪怕只改空白)。
                            `,
                            sources: [["tests/e2e/backend/backend-read-only-search.e2e.test.ts", "实际测试文件"]],
                        },
                        S3_multiturn: {
                            title: "S3 backend-multi-turn-followup",
                            content: `
                            类别: 多轮对话 (cross-object talk 真链路)。
                            Seed: baseDir/src/calc.ts 含简单 add(a, b)。
                            用户消息 #1: 询问 add 实现; 用户消息 #2: 让 assistant 加 sub(a, b)。

                            Good: 两轮 callee thread.status=done; 回复 #1 提到 add 细节; 第二轮后 calc.ts 含 sub 定义; user.root.outbox 有 2 条 user 消息、inbox 有 2 条 assistant 回复 (双写一致); assistant 复用同一 creator talk_window 应答, 未为第二轮 open 新 talk_window。
                            OK: 完成但第二轮 open 了新 talk_window (漂移), 或 sub 写位置奇怪/命名不规范。
                            Bad: 第二轮不回复/文件未更新, 或双写不一致 (caller.outbox.length != callee.inbox 中 source=user 数量)。
                            `,
                            sources: [["tests/e2e/backend/backend-multi-turn-followup.e2e.test.ts", "实际测试文件"]],
                        },
                        S4_recovery: {
                            title: "S4 backend-invalid-edit-recovery",
                            content: `
                            类别: 失败回路。
                            Seed: baseDir/src/dup.ts 含多处 count = 0 (让 file_window.edit 唯一匹配规则首次必失败); 首行注释帮 LLM 定位。
                            用户消息: 把【第一处】的 count = 0 改成 count = 1, 其它不要改。

                            Good: thread.status=done; 仅第一处改对 (精确 diff 可验); LLM 收到 "matches N times" 错误后主动扩大 old 上下文 (含前后行) 重试, 最终 file_window.edit 成功; assistant 在 outbox 解释发生了什么。
                            OK: 文件改对 + 有回复但退化到 program(shell) 或 write_file 全覆盖, 或 file_window.edit 重试 >= 4 次才成功。
                            Bad: 改错位置/多改/没改; 收到错误后 close 重 open 也不解决; thread 卡 running/waiting/failed; 收到错误后直接 end 不回复 user。
                            `,
                            sources: [["tests/e2e/backend/backend-invalid-edit-recovery.e2e.test.ts", "实际测试文件"]],
                        },
                    },
                },
                ordering: {
                    title: "推进顺序",
                    content: `
                    1. 先 fixture + S1 最小骨架, 跑通 "真 LLM + 真 server + 真 worker" 链路 (本身就挡 cross-object talk 回归)。
                    2. 再 S3 (多轮 talk), 验另一条独立通路。
                    3. S2 / S4 是 OOC 设计意图 (grep / edit 错误回路) 的更专注探针。
                    `,
                },
            },
            patches: {
                relation_to_integration: {
                    title: "与 integration / smoke 测试的关系",
                    content: `
                    - tests/integration/*.integration.test.ts (当前 21 个): 保留。这是 "绕过 server 直接构造 thread + 调 LLM" 的 LLM 行为单测, 与本 e2e 套件互补不替代。当 e2e 出现 Bad 时, 可下到 integration 层定位是 LLM 行为还是 OOC 实现问题。
                    - src/app/server/__tests__/real-app-server.test.ts: 保留作 smoke。走老 createFlowObject + initialMessage 路径, 本 e2e 套件走新 seedSession + cross-object talk 路径; 两条都要绿。
                    `,
                },
            },
        },
        frontend: {
            title: "Frontend e2e 入口",
            content: `
            测试对象: Web UI -> 前端 HTTP -> 后端 worker -> 真 LLM -> 回到前端渲染。
            真打开浏览器 (Chromium via Playwright), 用键盘鼠标级别操作完成用户故事, 验证用户视角下的端到端体验。

            范围边界:
            - 不测单元级 React 组件行为 (各组件 __tests__/*.test.tsx; 本期前端单测几乎缺失, 另立工作流补)
            - 不测纯 backend API 通路 (归 backend 子树; 前端 e2e Bad 时先看 backend 同场景是否绿)
            - 不测跨浏览器兼容 / 响应式 / 移动端
            - 通过门槛: tier !== "Bad"
            `,
            children: {
                stack: {
                    title: "工具栈与启动模型",
                    content: `
                    - 浏览器自动化: Playwright (@playwright/test); 跨平台、稳定、Bun 兼容、可截图
                    - 运行器: playwright 自带 (npx playwright test), 不走 bun:test; 本端独立调度
                    - Web app: Vite dev server (真 dev 体验)
                    - Backend: 后端进程独立 spawn, --world 指向临时 mkdtemp baseDir (前端 e2e 不复用 backend e2e 的 baseDir)
                    - LLM: 真 LLM via .env
                    - Gate: RUN_FRONTEND_E2E=1

                    启动模型 (每场景):
                    1. spawn 临时后端: bun --env-file=.env src/app/server/index.ts --world <mkdtemp>, 端口随机
                    2. spawn 临时 Vite dev: bun run web:dev --port <random>, 通过环境变量把后端 URL 注给前端
                    3. Playwright 打开 http://localhost:<vite-port>/
                    4. 测试结束清理两个进程 + 临时 baseDir
                    5. 跨场景串行 (不并发), 避免 LLM 资源争抢
                    `,
                    warnings: [
                        "strategy md 写测试文件后缀为 .spec.ts; 仓库实际为 .pw.ts (见 tests/e2e/frontend/*.pw.ts)。本树文档以仓库实况为准。",
                    ],
                },
                fixture: {
                    title: "公共 fixture",
                    content: `
                    位置: tests/e2e/frontend/_fixture.ts (含 _fixture-client.ts 辅助); playwright.config.ts 同目录。
                    职责:
                    - startBackend({ seedFiles? }) -> { baseDir, port, kill() }: spawn 后端并等就绪
                    - startWeb(backendUrl) -> { port, kill() }: spawn Vite + 注入 backend URL
                    - Playwright test.beforeAll/afterAll 串起两步, 把 baseURL + baseDir 暴露给场景
                    - createSessionVia(page, { targetObjectId, firstMessage }): 操作 SessionCreator 表单提交、等跳转
                    - waitForReply(page, { since }): 等 ChatPanel 新一条 assistant 消息
                    - sendFollowup(page, text): 在右下角 composer 输入并点 send
                    - readFsState(baseDir, relPath): 直读文件系统, 验 LLM 真改了文件
                    - readThreadJson(baseDir, sid, objectId, threadId): OOC 机制观察孔
                    - scoreScenario({ uiEvents, fs, thread, rules }) -> { tier, details }: 同 backend 风格评分裁判
                    `,
                    sources: [["tests/e2e/frontend/_fixture.ts", "Playwright fixture 主文件; 同目录另有 _fixture-client.ts (client 辅助) 与 playwright.config.ts (Playwright 配置)"]],
                },
                scenarios: {
                    title: "场景集 (F1-F5)",
                    content: `
                    F1 多轮对话起点; F2 改文件 (CodeAgent 核心); F3 纯读取 + UI 副作用 (search_window 真渲染);
                    F4 UI 单点 (talk_window inline composer); F5 UI layout 守护 (user thread 视角不应有右 chat panel)。

                    每场景 tier !== "Bad"; 重试 1 次政策同 backend。
                    `,
                    children: {
                        F1_first_reply: {
                            title: "F1 frontend-create-session-and-first-reply",
                            content: `
                            类别: 多轮对话起点 ("用户第一次接触 OOC")。
                            Seed: 空 baseDir (或一个 README.md)。
                            操作: 打开首页 -> SessionCreator (target=assistant, first message="hi") -> 提交 -> 等 session 项出现 -> 等右侧 chat panel 出现 assistant 第一条消息。

                            Good: 30s 内完成; assistant 回复 DOM 可见非空; ContextSnapshotViewer 能看到 callee thread 的 creator talk_window, transcript >= 2 条; callee thread.json 状态 = done 或 waiting; user.root.outbox 含 hi, inbox 含回复; 浏览器无 console.error / unhandled rejection。
                            OK: 60s 内完成 (慢但成); 或 ContextSnapshotViewer 初始只渲 fallback inbox; 或浏览器有非致命 console.warn。
                            Bad: 30s 内无回复; 文件系统有回复但 UI 不更新 (前端 polling 链路坏); UI 出现 "backend offline" 错误条; 浏览器 console.error。
                            `,
                            sources: [["tests/e2e/frontend/frontend-create-session-and-first-reply.pw.ts", "实际测试文件"]],
                        },
                        F2_rename: {
                            title: "F2 frontend-rename-symbol-via-chat",
                            content: `
                            类别: 改文件 (user 通过 web 让 assistant 改代码的核心体验)。
                            Seed: baseDir/work/src/foo.ts 含 helperA 跨 2-3 处; 后端启动 --world 指向 baseDir。
                            操作: 建 session, first message = 重命名 helperA -> helperZ -> 等回复 -> 不再操作 UI, 直读 fs 验证。

                            Good: foo.ts 中 helperA 计数=0、helperZ 计数 = 原 helperA; UI 给出非空回复且提到 helperZ; ContextSnapshotViewer 至少 1 个 file_window; thread.json 中 LLM 至少 open 过一次 file_window.edit; 未用 program(shell) 改文件。
                            OK: 文件改对 + 回复出现但用 sed/write_file 全覆盖, 或 LLM 重试 >= 2 次才成功。
                            Bad: 文件没改/改错; assistant 不回复/UI 无更新; thread 卡 running/waiting。
                            `,
                            sources: [["tests/e2e/frontend/frontend-rename-symbol-via-chat.pw.ts", "实际测试文件"]],
                        },
                        F3_search: {
                            title: "F3 frontend-search-and-open-match",
                            content: `
                            类别: 纯读取 + UI 副作用 (验 search_window 真渲染 + open_match 真 spawn file_window)。
                            Seed: baseDir/work/src/{a,b,c}.ts 各含若干 deprecatedFoo。
                            操作: 建 session, first message = 找出所有 deprecatedFoo 位置 -> 等回复 -> 在 ContextSnapshotViewer 找 search_window 节点 (badge=SEARCH) -> 点开详情验 matches 列表。

                            Good: 回复数字与实际命中数一致; 文件未被修改; ContextSnapshotViewer 至少 1 个 type=search window 节点, 点开后右侧显示 matches[] 含 path+line+snippet; 左树该节点 badge 显示 0 inbox / 0 outbox (search_window 不参与消息流); LLM 至少 open 过一次 root.grep。
                            OK: 数字位置正确但走 program(shell, grep), ContextSnapshotViewer 无 search_window 节点 (机制偏但用户视角能用); 或 search_window 出现但 matches 缺 snippet。
                            Bad: 数字错/没回复; 修改了文件; 浏览器 console.error (render 层崩)。
                            `,
                            sources: [["tests/e2e/frontend/frontend-search-and-open-match.pw.ts", "实际测试文件"]],
                        },
                        F4_inline_composer: {
                            title: "F4 frontend-user-talk-window-composer",
                            content: `
                            类别: UI 单点 (验证 inline composer 真能用)。
                            Seed: 空。
                            操作: 建 session (first="hi") -> 等首轮回复 -> ContextSnapshotViewer 切到 user.root thread -> 找到 target=assistant 的 talk_window 节点点开 -> 在右侧详情底部 inline composer 输入"再说一句"点 Send -> 等 assistant 回复。

                            Good: 30s 内完成; 第二条回复在 ContextSnapshotViewer 的 talk_window transcript 内可见; user.root.outbox 长度=2; callee assistant thread.inbox 中 source=user 也=2。
                            OK: 完成但需要刷新页面才看到第二条回复, 或 inline composer 输入有滞涩/焦点跳。
                            Bad: inline composer 不可见/不可输入/Send 没响应; assistant 不回复; 浏览器 console.error。
                            `,
                            sources: [["tests/e2e/frontend/frontend-user-talk-window-composer.pw.ts", "实际测试文件"]],
                        },
                        F5_no_right_panel: {
                            title: "F5 frontend-no-right-panel-on-user-thread",
                            content: `
                            类别: UI layout 守护 (user 不能跟自己对话, 所以 user thread 视角不应有右侧 chat panel)。
                            Seed: 空。
                            操作: 建 session -> 等首轮回复 -> 切 thread switcher 到 user.root -> 截图整页。

                            Good: 右侧 chat panel 不存在 (DOM 无 .right-panel 或被 collapsed); 中间 MainPanel 占据原右侧空间 (grid 切到 app-layout-no-right); ThreadHeader 仍在 breadcrumb-bar 可见; 浏览器无 console.error。
                            OK: 右侧 chat panel 仍在 DOM 但被 CSS 隐藏 (功能/视觉 ok, 但留了未来脆点)。
                            Bad: 右侧 chat panel 出现并显示 ChatComposer (user 跟自己对话的 UX 漏洞); 切换后 layout 错乱 (中间 panel 被压缩/overflow)。
                            `,
                            sources: [["tests/e2e/frontend/frontend-no-right-panel-on-user-thread.pw.ts", "实际测试文件"]],
                        },
                    },
                    patches: {
                        extra_specs: {
                            title: "策略未列、仓库实存的额外场景",
                            content: `
                            tests/e2e/frontend/ 下还存在两个 .pw.ts 文件未在 strategy md 中列出:
                            - frontend-object-client-renderer.pw.ts
                            - frontend-routing-and-client-tree.pw.ts

                            它们可能属于后加的 UI 守护场景或 client renderer 探针; 维护本树时应根据其实际语义补入 children 或迁移到独立子树。
                            `,
                            todo: [
                                "确认 frontend-object-client-renderer.pw.ts 与 frontend-routing-and-client-tree.pw.ts 的归类, 决定是补 F6/F7 节点还是另立子树",
                            ],
                        },
                    },
                },
                ordering: {
                    title: "推进顺序",
                    content: `
                    1. F1 先做 — 跑通整套 (spawn 后端 + Vite + Playwright + 真 LLM); 后续场景共享这套 fixture。
                    2. F2 / F3 是 CodeAgent 核心体验, 与 backend e2e 的 S1 / S2 一起验证两条路径。
                    3. F4 / F5 是 UI 改动的护栏, 防 "用户视角 ok 但机制漂移" / "机制 ok 但 UI 错乱"。
                    `,
                },
            },
            patches: {
                relation_to_backend: {
                    title: "与 backend e2e 的关系",
                    content: `
                    - 同一用户故事在 backend (S1-S4) 与 frontend (F1-F5) 应能映射到对方; 这是分层的初衷 — backend 先绿 -> frontend 才有底气。
                    - 调试失败时: 先看 backend e2e 同场景是否绿。backend 绿 + frontend Bad -> 锁定 UI 问题; 两端都 Bad -> 后端/LLM/协议层。
                    - 新增 backend 场景时考虑是否在 frontend 加对应; 反之亦然 — 不强求 1:1, 但显著的核心体验应两端都覆盖。
                    `,
                },
            },
        },
    },
    patches: {
        observation_holes: {
            title: "两个观察孔 (A + B)",
            content: `
            横切设计: e2e 的 "是否好用" 必须同时通过两个观察孔。

            - A. User story: 用户给一个真实任务 (如 "在 src/foo.ts 中把函数 X 改名为 Y"), 任务是否完成、文件是否真改、对话是否回到 user。视角: 用户。
            - B. OOC 机制: LLM 走了什么 commands / 创建了什么 windows / talk-delivery 双写是否正确 / form 状态是否正常流转。视角: OOC 设计者。

            两孔同时通过才算 e2e 通过:
            - 只看 A 会漏 OOC 自身退化 (任务完成了但用 shell sed 而非 file_window.edit)
            - 只看 B 会漏 "机制都对了但用户看不到回复"
            `,
        },
        scoring_tiers: {
            title: "三档评分基准 Good / OK / Bad",
            content: `
            横切判定规则:
            - Good: 系统按设计的最优路径完成 (thread.status=done; 用户能看到回复; 用了 OOC 推荐命令而非 shell; 无 form 重启 / talk_window 误关闭)。
            - OK: 任务完成但有可观察的浪费或绕行 (多开 form 又关 / shell 改文件 / talk_window 被 close 又重开 / 命令重试多次后成功)。
            - Bad: 任务没完成, 或完成但用户看不到结果, 或机制状态错乱 (thread 卡 running/waiting; user.root 收不到回复; on-disk 文件未变更; form 一直 executing; callee.inbox 与 caller.outbox 不一致)。

            判定规则:
            - 每个场景必须显式列出 Good / OK / Bad 的判定条件
            - 判定基于 "测试结束时观察到的事实" (thread.json / 文件系统 / outbox), 不基于 LLM 中间表达
            - Good 应是 "任意一次跑都成立" 的最低保证, 不是 "理想 LLM 一次完成"
            - OK 是 LLM 行为漂移的容忍区; OK 不等于放行, 是需要趋势观察的状态

            测试运行后: 断言要求 >= OK (Bad -> 失败, OK/Good -> pass); 同时把命中的档 + 关键观察值打到 stdout, 便于翻 CI 历史看趋势。
            `,
        },
        scenario_principles: {
            title: "场景拆分原则",
            content: `
            每个 e2e 场景同时符合:
            1. 真实任务 — 来自 "OOC 作为 CodeAgent" 的真实使用场景, 最好能映射到一句话的用户意图。
            2. 可证明的副作用 — 测试结束时有 fs / HTTP / thread.json 上的状态可查, 能区分 "LLM 嘴上说做了" vs "真做了"。
            3. 机制可见 — 能从 thread.contextWindows / events 看到 LLM 走过的窗口轨迹, 便于诊断 "为什么是 OK 不是 Good"。

            命名: <entry>-<verb-noun>-<distinguisher> (例 backend-rename-symbol-via-edit、frontend-create-session-and-reply)。

            最小场景集 (每份子文档至少覆盖): 1 个纯读取 + 1 个改文件 + 1 个多轮对话 + 1 个失败回路。
            `,
        },
        flakiness_policy: {
            title: "不稳定性与 LLM 行为漂移政策",
            content: `
            真实 LLM 有方差。同一 prompt 跑两次可能选不同路径。本策略态度:
            - 不强求 Good — 通过门槛是 >= OK
            - Bad 是真信号 — 几乎一定是 OOC 真错了 (协议文本误导 / 命令实现 bug / 通路断了), 不是 LLM 一次发挥
            - OK 多发是黄信号 — 连续 N 次都 OK 不到 Good, 说明 OOC 引导力在某处不够, 回看协议文本
            - 重试政策 — CI 上每个场景允许重试 1 次; 两次都 Bad 才视为失败; 重试需打日志记录原因
            - OK / Good 趋势归档 — 每次 CI 跑出来的 "命中档 + 关键观察值" 应留作 artifact, 便于人审查退化信号
            `,
        },
        trigger_modes: {
            title: "触发方式与 LLM 真假",
            content: `
            三种模式:
            - 真 LLM e2e: LLM 真 (env 配齐); env-gated 默认 skip; CI 在 RUN_E2E=1 (含 RUN_BACKEND_E2E / RUN_FRONTEND_E2E) 下跑; 主要 e2e 形态。
            - mock LLM e2e: 模拟 LLM, 输出固定脚本化 tool call 序列; 默认跑; 验 "机制通" 的快速回归; 不验 "LLM 是否被协议正确引导"。
            - 半真 e2e: 真 LLM + mock 工具; 仅作探查不进 CI; 临时定位 "是 LLM 误判还是工具实现错"。

            主线 e2e 是真 LLM 那条; mock LLM 仅作机制回归补丁, 不能替代真 LLM e2e。
            `,
        },
        out_of_scope: {
            title: "显式不写什么 (out of scope)",
            content: `
            排除在本策略外:
            - 单元测试: bun:test 散布在各模块 __tests__/, 沿用既有规范
            - 性能测试 / 压测: 不在本期范围
            - 多用户并发 / 多 session 隔离: 不在本期范围 (OOC 当前是单租户开发者工具)
            - 跨浏览器兼容: frontend e2e 只针对当前主开发浏览器 (Chromium)
            - 数据持久化迁移: thread.json schema 变更属于另一条工作流
            `,
        },
        related_conventions: {
            title: "相关 conventions / 约束",
            content: `
            - fail-loud 原则: docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md; e2e 的 Bad 档判定直接受这条约束。
            - 写文档 / 写新 e2e 测试本身也适用 verify-as-you-go: docs/solutions/conventions/agent-doc-work-verify-as-you-go-2026-05-15.md (加一个场景 -> 立刻跑一次确认能挂能过)。
            `,
        },
    },
};
