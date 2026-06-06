/**
 * 文档维护说明 (engineering.harness.doc)
 *
 * 本文件是 OOC "harness agents 组织结构" 的树形文档源，与 meta/object.doc.ts 同形态。
 * 维护原则节选 (完整原则见 object.doc.ts):
 *
 * 1. 树形拆解：模糊概念用 children / patches 拆，每层更具体。
 *    - children: 该节点 "由什么组成"。
 *    - patches: 补充说明 (边界、设计取舍、横切设计)。
 * 2. top-light / leaf-heavy：根节点只回答 "这是什么、由几块组成"；
 *    每个 Agent 的具体职责、关注子主题下沉到对应 child。
 * 3. content 体例：开头一两句定位 → 中段 bullet → 末段衔接源代码 / 对应维度文档。
 * 4. named：只放 content 中真出现且需要单独定位的术语
 *    (Supervisor / AgentOfX / 外循环 / 内循环 / dogfooding 等)。
 * 5. todo / warnings：
 *    - todo: 仍未拍板的设计取舍。
 *    - warnings: 已知漂移或落地缺口。
 * 6. 与现有文档一致：每个 AgentOfX 的子节点应引用 meta/object.doc.ts 中对应维度,
 *    避免与 object.doc.ts 重复定义维度本身,只描 "由谁负责、关注什么"。
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
 * Harness Agents 文档树的根节点。
 *
 * 这一层只回答 "OOC 自己作为 harness、谁负责实现什么"，
 * 作为 Supervisor + 各 AgentOfX 子节点 + 工作循环 / 自举性质等横切设计的阅读入口。
 */
export const root: DocTreeNode = {
    title: "OOC Harness Agents 组织结构",
    content: `
    单人全栈模式已触及天花板——不是能力不够,而是注意力带宽不够。一个人同时思考顶层设计、写代码、调 UI、搭生态,每个方向都只能浅尝辄止。
    解法:**用 OOC 自己作为 harness**——把工程任务分配给一群 Agent (即 OOC 系统中的 Object),每个 Agent 各司其职,人类只负责操纵 (Steer)。

    模型: 1 个 Supervisor + 9 个 Agent (8 个 AgentOfX 对应 OOC 的能力维度,加 1 个 AgentOfExperience 体验官) — 见 meta/object.doc.ts:
    - Supervisor: 最高哲学设计层,思考 "OOC 应该是什么",输出 design 指引;不直接写代码。
    - AgentOfThinkable: 上下文构建、ThreadTree、思考循环的工程实现。
    - AgentOfExecutable: tool 原语 / command / window registry 的工程实现。
    - AgentOfCollaborable: ThreadMessage / talk-delivery / relation 协作机制的工程实现。
    - AgentOfPersistable: stone / flow 文件树、thread.json、relation 文件等持久化层的工程实现。
    - AgentOfVisible: stone client / flow client/pages / web 控制面 / 交互设计的工程实现。
    - AgentOfObservable: debug 落盘、ContextSnapshot、pause 协议、监控/日志的工程实现。
    - AgentOfProgrammable: stone server method 库、loader 热更、program command 的工程实现。
    - AgentOfReflectable: super flow 协议、memory 文档治理、元编程闭环的工程实现。
    - AgentOfExperience (体验官): 不绑定单一维度,以真用户视角横切体验 OOC、评估、发现问题、沉淀报告、产出 e2e 测试用例。

    **自举性质 (dogfooding) — 长期目标**: 这些 Agent 本身是 OOC 系统中的 Object,OOC 用自己构建自己 (详见 patches.bootstrapping)。
    **短期运行时**: dogfooding 当前还做不到;短期通过 Claude Code 暂行 (Supervisor = Claude Code 主会话;各 AgentOfX = Claude Code sub agent),详见 patches.interim_runtime。

    顶层叙述到此为止;每个 Agent 的具体职责、关注子主题见 children;工作循环、协作关系、自举闭环等横切设计见 patches。
    `,
    named: {
        "Harness": "构建让 Agent 高效准确工作的 \"环境支架\";本文档语境下指 OOC 系统自身作为这套支架",
        "Supervisor": "最高哲学设计层;思考 OOC 应该是什么,输出 design 指引,不直接写代码",
        "AgentOfX": "对应 OOC 某个能力维度的执行 Agent;名字直接拼维度名,例如 AgentOfThinkable",
        "Steer": "操纵;人类定义目标与约束的角色分工",
        "Execute": "执行;Agent 生成、测试、部署的角色分工",
        "dogfooding": "OOC 用自己构建自己;AgentOfX 本身就是 OOC 系统中的 Object",
        "外循环": "Supervisor 驱动的全局循环: 哲学思考 → 指导执行层 → 汇总反馈",
        "内循环": "每个 AgentOfX 自己跑的循环: 调研 → 设计 → 实现 → 测试 → 反馈",
        "OOC 维度": "thinkable / executable / collaborable / observable / reflectable / programmable / visible / persistable;见 meta/object.doc.ts",
    },
    children: {
        supervisor: {
            title: "Supervisor - 最高哲学设计层",
            content: `
            Supervisor 思考 "OOC 应该是什么",不思考 "OOC 怎么做"。

            职责:
            - 维护顶层设计文档: meta/object.doc.ts (8 个能力维度的概念边界与协作关系)、其它 meta/*.doc.ts (engineering.* 横切设计) 的裁决。
            - 应对各 AgentOfX 上报的根本性问题: 当某个 Agent 在执行层遇到 "这件事到底该不该做"、"X 维度与 Y 维度边界在哪" 时,把问题提到 Supervisor;Supervisor 的回答更新到对应 meta 文档。
            - 不直接写 src/ 代码;不直接 review PR;不与单条 command / API / UI 细节绑定。

            协作姿态:
            - 与 AgentOfX 之间是 "philosophical advisory" 关系: Supervisor 输出 design 指引,Agent 在执行中遇到的实践反馈反向喂给 Supervisor。
            - Supervisor 自己的反思 (super flow / reflectable) 会形成新的 design 指引,通过 meta 文档下发。
            `,
            named: {
                "design 指引": "Supervisor 输出的、写在 meta/*.doc.ts 中的边界 / 取舍 / 哲学判断",
                "philosophical advisory": "Supervisor 与执行 Agent 的协作模式: 仅在哲学根问题上介入",
            },
            sources: [["meta/object.doc.ts", "Supervisor 主要维护的顶层概念文档"]],
        },
        agent_of_thinkable: {
            title: "AgentOfThinkable - thinkable 维度的工程实现",
            content: `
            负责思考如何把 OOC 的 thinkable 能力落到代码里。关注:
            - LLM 交互模块: provider 适配 (OpenAI / Claude)、Responses-first item 模型。
            - ContextBuilder: 把 thread + ContextWindow + knowledge 组装成 LLM 输入。
            - ThreadTree: thread 派生、scheduler 调度、ThinkLoop 一轮流程。
            - Knowledge 渐进激活: activates_on / command path / synthesizer。

            内循环典型动作: 调研一个 ContextWindow 类型 → 在 src/thinkable/context/render.ts 加渲染逻辑 → 单测 → e2e。

            维度定义见 meta/object.doc.ts 的 thinkable child。
            `,
            sources: [["src/thinkable/", "thinkable 维度的实现根目录;概念定义见 meta/object.doc.ts:children.thinkable"]],
        },
        agent_of_executable: {
            title: "AgentOfExecutable - executable 维度的工程实现",
            content: `
            负责思考如何把 OOC 的 executable 能力落到代码里。关注:
            - Tool 原语层稳定性 (open / refine / submit / close / wait): 不轻易加新 tool。
            - Command 层: root commands (do / talk / program / ...) 与各 window 上的 commands。
            - ContextWindow 体系: WindowRegistry / WindowManager / 新 window type 接入。
            - command_exec form 生命周期 + 渐进式参数披露。

            内循环典型动作: 设计一个新 command → 决定它注册到哪个 window type → 写 knowledge() 函数 → 实现 exec → 单测 + e2e。

            维度定义见 meta/object.doc.ts 的 executable child。
            `,
            sources: [["src/executable/", "executable 维度的实现根目录;概念定义见 meta/object.doc.ts:children.executable"]],
        },
        agent_of_collaborable: {
            title: "AgentOfCollaborable - collaborable 维度的工程实现",
            content: `
            负责思考如何把 OOC 的 collaborable 能力落到代码里。关注:
            - ThreadMessage 模型与 inbox/outbox 协议。
            - do_window (同 object fork 子线程) 与 talk_window (跨 object 持续会话) 的语义边界。
            - talk-delivery 跨 object 派送的 5 步流程与 callee thread 创建。
            - creator window 恒在通道 (isCreatorWindow + cascade close 拒绝)。
            - relation_window peer 关系的专属 window type 与双 scope 编辑。
            - relation_knowledge 自动派生 (peer readme + self relation 占位)。

            内循环典型动作: 设计一种新协作模式 (例: 跨 object 广播) → 决定走 talk-delivery 还是新建一种 window → 实现 + 测试跨 object 派送的双写 / 状态翻转。

            维度定义见 meta/object.doc.ts 的 collaborable child。
            `,
            sources: [["src/executable/windows/", "talk/delivery.ts / talk/index.ts / do/index.ts / relation/index.ts 协作核心;概念定义见 meta/object.doc.ts:children.collaborable"]],
        },
        agent_of_persistable: {
            title: "AgentOfPersistable - persistable 维度的工程实现",
            content: `
            负责思考如何把 OOC 的 persistable 能力落到代码里。关注:
            - OOC world 目录结构 (stones/ + flows/ + 三类元数据 .stone.json / .flow.json / .session.json)。
            - thread.json 的最小读写 (writeThread / readThread) + stripVolatileForPersist 内存字段剥离。
            - relation 文件 session 级写盘 (src/persistable/flow-relation.ts:writeFlowRelation) + enqueueSessionWrite 串行化。
            - debug 文件层 (供 observable 调用)。
            - FlowObjectRef / ThreadPersistenceRef / StoneObjectRef 三种 ref 抽象。

            内循环典型动作: 设计一个新持久化资源 (例: 跨 session 的全局事件流) → 决定挂在 stones/ 还是 flows/ → 实现 ref + 路径函数 + read/write 接口 + 路径安全校验。

            维度定义见 meta/object.doc.ts 的 persistable child。
            `,
            sources: [["src/persistable/", "persistable 维度的实现根目录;概念定义见 meta/object.doc.ts:children.persistable"]],
        },
        agent_of_visible: {
            title: "AgentOfVisible - visible 维度的工程实现",
            content: `
            负责思考如何把 OOC 的 visible 能力落到代码里,同时也是 web 控制面 (app.client) 的实际操盘者。关注:
            - stone client (stones/<self>/client/index.tsx) 与 flow client/pages 的形状、读写、热更。
            - ui_methods 通道: 客户端通过 HTTP callMethod 调 server/index.ts。
            - web 控制面: 整体导航 (react-router URL state)、AppShell、ThreadHeader、SessionCreator、ContextSnapshotViewer 等核心组件。
            - agent-native UI: "任何用户能做的事 Agent 也能做" 的尚未落地的等价路径。
            - 客户端渲染入口 / object-client-renderer 的演化。

            内循环典型动作: 调研一个 UI 痛点 (例: 看不到 thread 子树状态) → 设计页面与 routing → 实现 React 组件 + 后端 API → Playwright e2e。

            维度定义见 meta/object.doc.ts 的 visible child;web 控制面细节见 meta/app.client.doc.ts。
            `,
            sources: [["web/", "web 控制面前端代码 (vite + React);stone/flow client 文件路径见 src/persistable/stone-client.ts;callMethod HTTP 入口见 src/app/server/modules/flows/service.ts;概念定义见 meta/object.doc.ts:children.visible;web 控制面具体设计见 meta/app.client.doc.ts"]],
            todo: [
                "agent-native UI 等价路径尚未实现 (current 仅 HTTP 暴露给客户端);属于本 Agent 的下一步重点",
            ],
        },
        agent_of_observable: {
            title: "AgentOfObservable - observable 维度的工程实现",
            content: `
            负责思考如何把 OOC 的 observable 能力落到代码里。关注:
            - LlmObservation 内存快照 (最近一次 LLM 输入/输出)。
            - Loop-level debug 落盘: loop_NNNN.{input,output,meta}.json 文件命名与 enableDebug 切换。
            - PauseChecker 注入点: tool call 执行之前的人工介入时机。
            - ContextSnapshot 与 system message XML 的同源关系: 让 UI 不必 re-parse XML。
            - "Agent 看不见就修不了" 的硬约束 (visibility-first): 任何系统状态都应进入 ProcessEvent 流或 contextSnapshot,不能留死区。

            内循环典型动作: 设计一种新观测点 (例: tool 调用耗时分布) → 在 thinkloop 周围加 hook → 落盘 + 暴露给 UI → 跑 e2e 确认 debug 文件结构。

            维度定义见 meta/object.doc.ts 的 observable child。
            `,
            sources: [["src/observable/", "observable 维度的实现根目录;debug 落盘工具见 src/persistable/debug-file.ts;概念定义见 meta/object.doc.ts:children.observable"]],
        },
        agent_of_programmable: {
            title: "AgentOfProgrammable - programmable 维度的工程实现",
            content: `
            负责思考如何把 OOC 的 programmable 能力落到代码里。关注:
            - ObjectMethod schema (description / params / knowledge / fn) 与 window.methods / ui_methods 分流。
            - loader 热更: 按 mtime 缓存 + ?t=mtime 破坏 import cache。
            - ProgramSelf 注入: program ts/js sandbox 收到的 self 对象。
            - program command 两条调用路径: exec 一行调 vs ts/js exec 里 self.callCommand。
            - 元编程闭环: 配合 reflectable 在 super flow 改 server/index.ts 后,下一次调用自动看见新方法。

            内循环典型动作: 调研某个高频 LLM 操作的提取需求 → 设计 ObjectMethod 形状与 knowledge() → 写到 stone server/index.ts → 跑 e2e 确认 exec 路径能拿到结果。

            维度定义见 meta/object.doc.ts 的 programmable child。
            `,
            sources: [["src/executable/server/", "server method 加载与 ProgramSelf 注入;exec 路径入口见 src/executable/tools/exec.ts;server/index.ts 读写见 src/persistable/stone-server.ts;概念定义见 meta/object.doc.ts:children.programmable"]],
        },
        agent_of_reflectable: {
            title: "AgentOfReflectable - reflectable 维度的工程实现",
            content: `
            负责思考如何把 OOC 的 reflectable 能力落到代码里,以及治理由 reflectable 落地形成的记忆与关系文档。关注:
            - super flow 协议: SUPER_SESSION_ID 校验、super alias target 翻译、REFLECTABLE_KNOWLEDGE 注入条件与正文质量、cross-session 派送语义。
            - 反思请求路径: 业务线程开 target='super' talk_window → talk-delivery 派送 → 反思 thread 看见 REFLECTABLE_KNOWLEDGE → 写 stones/<self>/knowledge/memory → 通过 creator talk_window 回复 + end。
            - 元编程闭环治理: 反思结论必须落到 memory 文件 (而不是只在 endSummary 里嘴上沉淀);确保下一轮 thread 真的能看见新认知。
            - memory 文档治理: kebab-case slug 规范、memory 文件命名一致性、过期/重复条目的合并与归档。
            - relation 与 self.md / readme.md 的写入边界: 哪些请求够格触发 self.md / readme.md 修改 (caller 必须明确请求);哪些只是普通 memory。
            - 与 AgentOfProgrammable / AgentOfVisible 的边界协调: super flow 默认不直接 patch server / client 产物,需要时走对应维度 Agent 定义的演化路径。

            内循环典型动作: 跑一遍 super flow 实测 → 检查 memory 是否真的落盘 + 内容是否够具体 → 发现 REFLECTABLE_KNOWLEDGE 漏洞 → 修协议 + 跑回归 e2e。

            维度定义见 meta/object.doc.ts 的 reflectable child。
            `,
            sources: [["src/thinkable/reflectable/", "reflectable 维度的实现根目录;super 常量见 src/executable/windows/_shared/super-constants.ts;注入条件见 src/thinkable/knowledge/synthesizer.ts;概念定义见 meta/object.doc.ts:children.reflectable"]],
        },
        agent_of_experience: {
            title: "AgentOfExperience - 体验官",
            content: `
            与其它 AgentOfX 不同,本 Agent 不绑定单一能力维度,而是以"真用户"视角横切体验整个 OOC。
            存在意义: 防止其它 AgentOfX 在抽象维度上空转,确保每一项改进对真实使用都有可观测影响。

            职责:
            - **真实体验**: 把 OOC 当 CodeAgent 真的跑业务任务 (重命名、重构、读 + 改、跨文件搜索 + 编辑、跨 object talk 等),不是看代码看出来的体验。
            - **评估功能**: 对照 design 期望与实际行为,落到 engineering.testing 的三档评分基准 (Good / OK / Bad)。
            - **发现问题**: 把卡顿 / 反直觉 / 死区 / Bug / 视觉漂移落到结构化报告——尤其抓 visibility-first 失守的地方 (Agent 看不到的状态、用户看不到的反馈)。
            - **沉淀报告**: 把问题落成 e2e 场景 + 经 talk_window 反馈给对应维度 AgentOfX / 经验写到自己的 memory / 哲学根问题抛回 Supervisor (super flow 反思请求)。
            - **编写 e2e 测试用例**: 每个新发现的问题都应转成 engineering.testing 维度下的一个具体场景 (backend / frontend 二选一或两份),保证回归不漂回去。

            内循环典型动作: 选一个真实任务跑 OOC → 用 visibility-first 视角对照三档评分 → 发现 Bad/OK → 提交 e2e 场景 PR + 经 talk_window 抛给对应维度的 AgentOfX 修复。

            协作姿态:
            - AgentOfExperience 不直接改 src/ 修 Bug (那是对应维度 AgentOfX 的事);它的输出是 e2e 场景与 talk_window 反馈。
            - AgentOfExperience 是其它 AgentOfX 内循环的"现实校准源"——其它 Agent 的"测试"步骤往往直接消费它写的 e2e 场景。
            - 与 Supervisor 是双向关系: Supervisor 出 design,体验官检验 design 在实践中是否成立;不成立时反过来挑战 design。

            进行体验前，先根据 meta/app.client.doc.ts 和 meta/app.server.doc.ts 熟悉 OOC 的 web 控制面与后端 API, 检查server是否已启动。
            `,
            named: {
                "体验官": "AgentOfExperience 的中文名;以真用户视角校准其它维度",
                "现实校准": "体验官的核心价值;让抽象维度的改进真正落到可观测的用户体验",
                "三档评分基准": "Good / OK / Bad;见 meta/engineering.testing.doc.ts",
                "visibility-first 失守": "系统某处状态对 Agent 或用户不可见,导致问题无法被自修复",
            },
            sources: [["meta/engineering.testing.doc.ts", "体验官产出的 e2e 场景去处;场景集 backend/frontend 索引、三档评分基准、观察孔 A/B 都在这里"]],
        },
    },
    patches: {
        work_loops: {
            title: "工作循环 - 外循环 + 内循环",
            content: `
            循环模型:

            **外循环 (Supervisor 驱动)**
            \`\`\`
            哲学思考 → 更新 meta 文档 → 指导执行层
                ↑                       ↓
            汇总反馈 ←── 各 AgentOfX 完成一轮内循环
            \`\`\`

            **内循环 (各 AgentOfX 自跑)**
            \`\`\`
            调研 → 设计 → 实现 → 测试 → 反馈
            \`\`\`

            两个循环的时间尺度不同:
            - 外循环慢: 一次外循环 = 一轮 design 调整 + 多个 Agent 各跑若干次内循环。
            - 内循环快: 单个 Agent 在一个工程任务上的完整 cycle (典型为一次 feature / 一次 bugfix)。

            外循环的 "汇总反馈" 步骤是 Supervisor 决定下一轮 design 走向的关键输入;
            反馈不一定走文档,可以走 talk_window 跨 object 反馈 或 super flow 的自反思 (reflectable.super_alias_target)。
            `,
            named: {
                "外循环": "Supervisor 驱动的全局循环",
                "内循环": "各 AgentOfX 在工程任务上自跑的循环",
                "汇总反馈": "外循环中各 Agent 把内循环结果回报给 Supervisor 的步骤",
                "经验沉淀": "每轮 harness 后把发现固化为 docs + memory + playbook 的常设环节 (见 experience_sedimentation)",
            },
        },
        experience_sedimentation: {
            title: "经验沉淀 - harness 循环的常设收尾环节",
            content: `
            harness 循环不止"发现 bug → 修 bug"; **每一轮都必须把发现固化成可复用知识**,否则
            下一轮(或下一个会话/Agent)会重蹈同一坑——循环不复利。沉淀是 harness 外循环的常设收尾。

            **每轮 harness 后的闭环节奏**:
            \`\`\`
            跑 harness → 收 Issue/快照 → 修问题 → 验证(gate+回归) → 沉淀 → 下一轮
                                                                  ↑ 常设,不可跳过
            \`\`\`

            **沉淀去三处**(按知识性质分流):
            1. **docs/ 复盘**: 一个会话/一轮 sweep 的成果 + 根因 + 设计决策 + 未决跟进,落
               \`docs/<date>-*-retrospective.md\`(锚 commit/报告)。给"为什么这么改"留长期可读记录。
            2. **memory**: 跨会话复用的认知——feedback(我该怎么工作,如方法论)/ project(在做什么)/
               reference。一句话能说清的坑不写三句(见 feedback_doc_concise)。
            3. **playbook / meta doc**: 若 harness 暴露的是"评判基线/概念描述已与实现漂移"(如 playbook
               仍写旧 overlay 落点),回流改 playbook / object.doc——否则下轮体验官按旧基线误判。

            **沉淀的判据**(什么值得沉淀): 非显然、会再次踩、改变了我的工作方式或系统的概念。
            纯一次性的修复细节(git 已记)不必再沉淀;"超时是 observability 症状,该增强可观测而非干等"
            这类方法论必须沉淀。

            **机械支撑**: harness 超时/卡住时,orchestrate 自动抓 \`/api/runtime/activity\` 快照
            (\`<dim>.timeout-snapshot.json\`)+ dashboard 备注,让"盲 TIMEOUT"自带诊断——沉淀的事实
            基础不再靠事后 tail 日志。

            与 dogfooding(bootstrapping)的关系: 长期态下"沉淀"即 AgentOfX 经 super flow 把经验写进
            自己 stone 的 memory(reflectable 闭环);暂行态由主会话写 docs/ + memory 代偿。
            `,
            named: {
                "经验沉淀": "把 harness 发现固化为 docs+memory+playbook 的常设收尾环节",
                "闭环节奏": "跑 harness → 收 Issue/快照 → 修 → 验证 → 沉淀 → 下一轮",
                "沉淀去三处": "docs 复盘 / memory(feedback·project) / playbook·meta doc 回流",
            },
            sources: [["packages/@ooc/tests/harness/orchestrate.ts + docs/2026-06-06-worktree-and-observability-retrospective.md", "超时快照机械支撑(captureActivitySnapshot→timeout-snapshot.json+dashboard 备注)+ 复盘文档范例;可观测三件套见 observable/log-aggregator.ts 与 /api/runtime/activity"]],
        },
        bootstrapping: {
            title: "自举 (dogfooding) - OOC 用自己构建自己 (长期目标)",
            content: `
            **这是长期目标,当前还做不到;短期形态见 patches.interim_runtime。**

            目标态: AgentOfX 本身是 OOC 系统中的 Object——不是仓库外另起的 LLM Agent,也不是手写的 shell 脚本。
            这一选择带来三个推论:

            1. **每个 AgentOfX 都有自己的 stone**: stones/agent_of_thinkable/ / stones/agent_of_executable/ / ...
               里面写 self.md (Agent 的工作风格)、knowledge/memory/ (沉淀)、server/index.ts (方法库)。

            2. **AgentOfX 之间通过 collaborable 协作**: 跨 Agent 派任务走 talk_window,跨 Agent 共享 peer 关系/上下文走 relation_window 与 do_window.move。
               不需要为 "OOC 工程协作" 单独发明协议,直接复用 OOC 自己的协作语义。

            3. **AgentOfX 的迭代走 reflectable**: Agent 完成一轮内循环后,通过 super flow 反思,把经验落到自己 stone 的 memory。
               下次启动新 thread 时,新 memory 作为 knowledge 自动出现在 context (thinkable.knowledge),行为随之演化。

            这条 dogfooding 链路反过来也是 OOC 系统的最强测试场: 如果 OOC 不足以撑起自己的工程协作,那它也撑不起任何外部场景的 multi-agent 协作。
            因此 AgentOfX 的实际使用本身就是 OOC 的 "真 LLM e2e" (engineering.testing 维度)。
            `,
            named: {
                "dogfooding": "用自己的产品构建自己的产品",
                "AgentOfX 的 stone": "每个 Agent 在 stones/ 下持有自己的身份 + 知识 + 方法库",
            },
            sources: [["meta/object.doc.ts:children.reflectable", "Agent 通过 super flow 演化自身的闭环;协作语义见 collaborable child;AgentOfX 的实际使用即真 LLM e2e,见 meta/engineering.testing.doc.ts"]],
        },
        interim_runtime: {
            title: "短期运行时 - Claude Code 暂行模式",
            content: `
            patches.bootstrapping 描述的"AgentOfX 本身是 OOC Object"是长期目标。
            短期 (当前阶段) 做不到 —— OOC 各能力维度还在持续演化,自身的协作链路尚未稳定到足以承载自己的工程协作。

            **短期方案: 通过 Claude Code 运行整个 harness 组织**
            - **Supervisor** = 人类 + Claude Code 主会话: meta/*.doc.ts 的编辑、design 决策、跨 Agent 协调、最终拍板都在主会话进行。
            - **各 AgentOfX** = Claude Code 的 sub agent: 在主会话用 Agent 工具 dispatch (subagent_type 选 general-purpose / Explore / Plan 等),
              把任务 prompt + 关键上下文 + 文件路径喂给子 Agent;子 Agent 执行完通过返回值汇报结果。
            - **AgentOfExperience** 同样走 Claude Code sub agent 形态,可以专门做"跑一个真实任务 + 起 e2e 场景 + talk_window 反馈"这条链路;也可由人类直接驱动,按需要拉 Claude Code 主会话辅助。

            **与长期 dogfooding 的差异 (即当前的妥协)**:
            - 没有 stones/agent_of_X/ 目录: 子 Agent 的"记忆"靠主会话每次注入的 prompt + 上下文,不在磁盘持久化。
            - 没有 talk_window / inbox 协作: 子 Agent 之间的协调通过主会话 (Supervisor) 中转;子 Agent 之间无法直接 talk。
            - 没有 super flow 自我演化: Agent 经验的沉淀靠人类写回 meta/*.doc.ts 或 docs/;子 Agent 自己改不了自己。

            **迁移路径**: 每当 OOC 某个能力维度成熟到可以承载工程协作 (例: talk-delivery 稳定 + relation 协作可用 + super flow 反思闭环跑通),
            就把对应的 Agent 从 Claude Code sub agent 形态迁移到 OOC 内部 Object 形态。完全迁移完成 = bootstrapping 实现 = dogfooding 落地。

            这条迁移路径本身也是 AgentOfExperience 的关键观察点: 每次迁移前后跑同一组场景,验证 OOC 自托管的 Agent 不输于 Claude Code 暂行模式。
            `,
            named: {
                "Claude Code 主会话": "承担 Supervisor 角色的人类-LLM 协作会话",
                "Claude Code sub agent": "通过 Agent 工具 dispatch 的子 Agent;以 prompt 形式接收任务,通过返回值汇报",
                "迁移路径": "OOC 某能力维度成熟即把对应 Agent 从 Claude Code 暂行模式迁到 OOC 自托管 Object",
            },
            sources: [["meta/engineering.testing.doc.ts", "迁移前后的回归校验入口;AgentOfExperience 通过这套 e2e 场景验证暂行 vs 自托管的等价性"]],
        },
        role_split: {
            title: "Steer vs Execute - 人类与 Agent 的角色分工",
            content: `
            harness 思想下的硬性分工:

            - **人类 (Steer)**:
              - 维护 Supervisor 的 design 指引 (写 meta/*.doc.ts 顶层 narrative)。
              - 在 Agent 内循环遇到根本性歧义时拍板。
              - 把握危险动作的 human-in-the-loop (例: 全局 pause / 删除 / 不可逆迁移)。
              - 决定 ui_methods 暴露面 (哪些 server 方法对外可见)。

            - **Agent (Execute)**:
              - 所有具体动作: open / refine / submit / wait / talk-delivery / write_file / 跑测试 / 改代码。
              - 把内循环结果回报给 Supervisor (通过 talk_window / super flow 反思)。
              - 在 stone 自己的 server method 库与 knowledge 文档中沉淀经验。

            两条边界:
            - 人类不直接写代码 = 人类不该陷入 "再多一行就让 Agent 干" 的拖延; Steer 的成本极高,Agent 的成本极低,任何 Execute 都应在 Agent 侧完成。
            - Agent 不擅自动哲学层决定 = AgentOfX 不修改 meta/object.doc.ts 顶层 narrative;若有歧义,通过 super flow 把问题抛给 Supervisor。
            `,
            named: {
                "Steer 的成本极高": "人类注意力带宽稀缺,任何可下放的动作都应该下放",
                "human-in-the-loop": "危险动作仍由人类批准的协议",
            },
        },
        test_session_hygiene: {
            title: "测试 session 卫生 - AgentOfVisible / AgentOfExperience 自验证产物隔离",
            content: `
            **背景**: interim_runtime 形态下, sub agent 跑回归常需要真发 \`POST /api/sessions\` 验证修复
            (例: AgentOfVisible 改 A6 后真创建一个 session 看 title 派生是否正确)。这些 session 会
            **落盘到 .ooc-world/flows/**, 污染 sidebar 列表, 影响后续体验官 UI 评审的真实性
            (体验官会被迫看到一堆 \`a8-verify-...\`, 干扰对真实使用场景的判断)。

            **规约 (2026-05-20, 派单时强制要求 sub agent 遵守)**:

            1. **sessionId 前缀约定**: 任何 sub agent 在自验证中创建的 session, sessionId 必须以
               \`_test_<agent>_<timestamp>\` 形式 (例: \`_test_visible_1779218044014\`)。
               下划线前缀让前端 sidebar 渲染时**显式跳过**这类 session。
            2. **前端过滤规则 (AgentOfVisible 实现)**: sidebar SessionList 默认隐藏 sessionId 以 \`_test_\` 起首的 session;
               提供一个 toggle 让人类按需展开 (默认折叠)。
            3. **回归后清理**: sub agent 完成自验证后应清理自己创建的 \`_test_*\` session;若没清, 由
               Supervisor 或人类在终审 comment 中点名催收, 或在下轮启动前用脚本批量 rm。
            4. **不依赖前端隐藏作为唯一防线**: 后端不强制拒绝普通 sessionId 命名以防破坏现有 user 创建;
               前端隐藏只是体验层卫生, 测试产物自身应主动清理。

            **派单模板加一条** (Supervisor 写给 sub agent 的 prompt 应包含):
            > 自验证产生的 session 一律用 sessionId 前缀 \`_test_<agent>_<timestamp>\`, 验证完毕后 rm 自己创建的目录。

            **跟历史污染的关系**: 2026-05-20 之前的 sub agent (A2-A8 / A1+B5 那几轮) 没有此约束,
            在 .ooc-world/flows/ 落了一批 \`web-*\` / \`regress-*\` / \`a8-verify-*\` 等污染 session,
            Supervisor 已在 Task #23 中手动清理。本规约从落地之后的派单开始强制执行。

            **🔥 进程卫生（2026-05-25 新加，比 session 卫生严重）**:

            体验官 Round 6 启动了一个长寿 vite dev server（port 5173）做 Playwright 体验,
            sub agent 退出时**没 kill 该 vite 进程**——它带着 sub agent 当时设置的 env
            （\`OOC_API_TARGET=http://127.0.0.1:7882\` Round 6 临时 port、\`OOC_WORLD_DIR=/tmp/ooc-exp6-world\`
            已删除的临时目录）**在用户本地一直跑了几天**, 让用户的浏览器永远 proxy 到死端口、
            world 错指、debug 永远 502。Supervisor 在用户报告"backend offline"时才发现。

            **规约**:

            1. **任何 sub agent 启动的 long-running 进程**（vite dev server / backend server /
               watch loop / playwright headless / 自己写的 daemon）**必须在 sub agent 退出前 kill**。
               典型实现：在 sub agent 脚本顶部 \`PIDS=()\`; 启动后 \`PIDS+=($!)\`; 末尾 \`trap 'kill "\${PIDS[@]}" 2>/dev/null' EXIT\`。
            2. **不要假设 sub agent 进程退出 → 子进程自动死**: macOS bun / node 默认不传 SIGHUP 给孙子进程,
               vite + react fast-refresh 是分叉 daemon, 与 sub agent shell 完全脱钩。**主动 kill 才安全**。
            3. **如果 sub agent 需要"暴露给用户后续会话用"的 server**, 必须 **明确告诉 Supervisor 并请求授权**,
               不要悄悄留下来。
            4. **诊断 hint**: 如果用户报告 "前端 offline / proxy 错 port / debug 502", 第一步检查
               \`ps eww <vite_pid>\` 看 env 是否带 \`/tmp/ooc-exp*\` 类临时路径 → 立即 kill + 提示用户重启。

            **派单模板加一条**:
            > 启动的 vite / backend / 任何 long-running 进程, sub agent 退出前必须 kill
            > (\`trap 'kill \${PIDS[@]}' EXIT\`); 不要悄悄留进程给 user 后续会话。
            `,
            named: {
                "_test_<agent>_<ts> 前缀": "sub agent 自验证 session 的约定 sessionId 形态",
                "sidebar 隐藏 _test_": "前端体验层卫生, AgentOfVisible 落地",
                "回归后清理": "sub agent 自己创建的 _test_* session 应主动 rm",
                "进程卫生": "sub agent 启动的 vite/backend/daemon 必须退出前 kill",
            },
            todo: [
                "AgentOfVisible 落地: SessionList 默认隐藏 _test_ 前缀 session, 加 toggle 展开;尚未实现",
                "Supervisor 派单模板补这两条; 派给体验官 UI 评审 / sub agent 自验证时显式加入约定 (session 前缀 + 进程 kill)",
            ],
        },
        design_doc_historization: {
            title: "Design doc 历史化模板 - 重大修订时如何标记 deprecated 内容",
            content: `
            **背景**: \`docs/<date>-<topic>.md\` 是 design 决策的时间快照, 重大后续修订时不应改写历史叙述
            (那是当时的决策, 抹掉等于丢失推理脉络), 但也不能让新读者把过时内容当现状。
            2026-05-24 AgentOfExperience 报告: \`docs/2026-05-23-stone-pool-flow-trinary-landing.md:53\`
            展示 \`sql/data.sqlite\` 作为当前 pool 形态, 但 05-24 已删 sql 改 csv——新读者会被误导。

            **模板规约 (2026-05-24, 重大修订时强制)**:

            1. **顶部指针段**: 文档第一段加块引用指针, 明确"原文中 X 表述以 N 月 N 日修订段为准"
               (避免读者只看到中间段就当现状)。例:
               \`\`\`
               > **2026-05-24 修订**: knowledge 进一步拆为 seed/sediment 二分——
               > 详见文末"YYYY-MM-DD 修订"段。原文中"X"以修订段为准。
               \`\`\`
            2. **内联 deprecated 标记**: 代码块 / 形态描述 / 关键 narrative **不删除**, 但加内联
               \`[OBSOLETE YY-MM] <原因>\` 标记或上方块引用警告, 让 \`grep\`-able 也可视。例:
               \`\`\`
               sql/data.sqlite  ← [OBSOLETE 05-24] bun:sqlite + WAL (已删除, 改用 data/<name>.csv)
               \`\`\`
            3. **修订段在文末**: 每次重大修订追加一段 \`## YYYY-MM-DD 修订: <主题>\`,
               含起因 / 边界变化 / 影响 / 涉及的 meta 与代码改动清单。修订段是当前权威, 顶部指针指向它。
            4. **历史段补行**: 文末"历史"小节 (如有) 加一行
               \`- **YYYY-MM-DD** (修订/二次修订/...): <一句话>\`, 与 git log 形成时间轴双轨。
            5. **指针 vs 改写的边界**: 永远不改写原文段落本身; 只追加修订段 + 内联 deprecated 标记 + 顶部指针。
               这保证 design 推理链可追溯, 不让"现状变化"反向擦除"历史决策"。

            **触发条件 (什么算"重大修订")**:
            - 该 doc 描述的设计被推翻 / 简化 / 拆分;
            - 文档内任何代码块 / 形态图与新代码不一致;
            - 顶层裁决 (如"二分扩三分"、"删 sql 改 csv") 在该 doc 落地后被改了。

            非重大修订 (typo / 措辞润色) 不必走此模板, 直接改即可。

            **历史符合度**: \`docs/2026-05-23-stone-pool-flow-trinary-landing.md\` 已按本模板补齐
            (2026-05-24 一次 + 二次修订段); 后续重大修订都应参照此例。
            `,
            named: {
                "顶部指针段": "文档头部块引用, 把读者指向文末修订段",
                "内联废弃标记": "[OBSOLETE YY-MM] 内联 grep-able 标记, 不删原文",
                "修订段在文末": "## YYYY-MM-DD 修订: <主题>; 含起因 / 边界 / 影响 / 改动清单",
                "指针而非改写": "永远追加, 不改写; 保 design 推理链",
            },
            todo: [
                "其他 docs/<date>-*.md (如 brainstorms/, plans/) 检查是否有未标记的 deprecated 内容, 按本模板补齐 (低优先, 触发条件出现时再处理)",
            ],
        },
        commit_hygiene: {
            title: "Commit 卫生 - 何时、以什么粒度、由谁触发 git commit",
            content: `
            **背景 (2026-06-03, session 1acc445b)**: 一次完整阶段 (fix thread crash +
            missing outbox messages) 完成后 Agent 没有主动 commit, 连续三次被用户催促
            "make git commit, 每次完成一阶段的变更后就进行一次 commit, 不要让我提醒你"。
            暴露了两条缺规: (1) "阶段完成" 的定义在 Agent 侧不清晰, (2) commit 触发
            被当作"用户显式请求"而非"工程 hygiene 默认行为"。

            **规约 (2026-06-03 起强制执行)**:

            1. **主动提交, 不需要用户提醒**: 任何一次"内循环"走完 (调研 → 设计 → 实现 →
               测试 → 反馈全部闭环、tsc clean、测试相对 baseline 无新增回归) 之后,
               Agent **必须立即提交**, 不需要等用户说 "make commit"。
            2. **"阶段完成" 的判定标准 (满足任一即触发)**:
               - 一个具体工单 / bug / small feature 端到端落地 (UI 或命令行真验证过);
               - 一轮 tsc + bun test 跑完, 相对 baseline 无新增失败;
               - 工作切换到不同主题 (例如从"修渲染 crash"切到"加 visible 组件"),
                 前一个主题的改动必须先 commit;
               - 用户在同一个会话中提出了新的、独立的指令方向。
            3. **Commit 粒度**: 一次 commit = 一个单一变更主题。不要把"修 crash + 加 visible
               组件 + 清理 builtins readable"揉在一次 commit 里 (session 1acc445b 前半段
               这些改动其实已经跨阶段, 但被一次性塞进了 18efee6——这是反例)。
            4. **Commit message 格式**: 延续仓库既有风格
               \`feat(ooc-6 M<数字> + M<数字>): <50 字以内描述>\`, 正文用 bullet 列出每个文件的
               行为变更; 不写"fix bug"这类空泛描述, 写清楚"修了什么、改了哪条链路"。
            5. **例外**: 正在一个子任务中间、离可工作状态还差很远时, 不要为了 commit 而 commit;
               但如果要离开超过 30 分钟 (或用户要求切题), 至少用 \`WIP: <主题>\` 先把工作存下来。

            **Supervisor 派单模板加一条**:
            > 每一阶段 (tsc clean + 测试无新增回归) 完成后**主动 commit**, 不要等我说 "make commit"。
            > Commit 粒度 = 一个单一变更主题; message 用 feat(ooc-6 Mx): 前缀。
            `,
            named: {
                "阶段完成": "满足 5 条判定标准之一, Agent 应主动 commit 的时点",
                "主动提交": "commit 是 Agent 的默认行为, 不需要用户显式触发",
                "单主题 commit": "一次 commit 只包含一个变更主题, 避免揉多个独立改动",
            },
            todo: [
                "把这条规约同步到 CLAUDE.md / 各 AgentOfX 的 prompt 模板中, 避免每次 Supervisor 手工加",
            ],
        },
        data_type_boundary_contract: {
            title: "数据类型边界契约 - TS 类型 ≠ 磁盘/网络实际数据",
            content: `
            **背景 (2026-06-03, session 1acc445b)**: 前端展示 outbox 消息时崩溃于
            \`undefined is not an object (evaluating 'text.replaceAll')\`。

            根因不是单一 bug, 而是三条边界失守的叠加:
            1. **TS 类型与磁盘真实数据脱节**: \`ThreadMessage.content: string\` 在类型上是必填,
               但手动 seed 的脚本写入 \`text\` 字段 (legacy 别名) 且把 \`content\` 留 null;
               磁盘 JSON 不经过 TS 编译期检查, 下游 render 信任了类型标注, 对 null 调
               \`.replaceAll()\` 直接崩溃。见 commit 0492cf6。
            2. **字段别名漂移**: 同一"消息正文"语义在链路里同时存在 \`content\` (canonical) 和
               \`text\` (legacy) 两个名字; "目标对象"同时有 \`targetObjectId\` (seed 脚本用) 和
               \`toObjectId\` (ThreadMessage canonical) 两个名字。各层消费者只实现了其中一个
               分支, 消息能不能展示取决于走了哪条写入路径。
            3. **底层构造器不做防御**: \`xmlText(value: string)\` 和 \`xmlComment(value: string)\`
               的参数类型是 \`string\`, 但调用方传 \`null/undefined\` 时 TS 在 any-cast 边界被绕开,
               函数内部也没兜底, 崩溃从最底层冒出, stack 离业务语义很远, 定位成本高。

            **规约 (2026-06-03 起强制执行)**:

            1. **所有"系统边界"的数据都要做运行时校验 / 兜底, 不能只靠 TS 类型**:
               - 系统边界 = 从磁盘 JSON 读 (thread.json / .stone.json / relation 文件)、
                 从 HTTP 请求 body 读、从别的 Agent / user 传来的消息。
               - 校验形式三选一 (按优先级):
                 (a) 有运行时 schema (zod / valibot / 手写 assert);
                 (b) 读取函数里做字段归一化 (例: \`body = msg.content ?? msg.text ?? ""\`);
                 (c) 最底层构造器兜底 (例: \`xmlText(v: string | null | undefined)\` 内部
                 \`v ?? ""\`)——这是最后防线, 不能替代 (a)(b)。
               - 禁忌: 看到 TS 类型写着 \`content: string\` 就默认运行时一定有值。
            2. **字段别名必须集中声明 + 所有消费者统一实现**:
               - 只要一个语义存在两个字段名 (canonical + legacy alias), 就必须在类型定义
                 旁边写一个 comment 列出所有别名, 并提供一个**唯一的归一化函数**
                 (如 \`normalizeThreadMessage(msg): ThreadMessage\`)。
               - 所有消费者 (render / formatter / service) 只通过归一化函数读数据,
                 不许在自己代码里随手写 \`msg.content ?? msg.text\` 这种散落在各处的兼容。
                 (本次 0492cf6 作为 hotfix 允许散落写法, 下一阶段要集中到一个 normalize 函数。)
            3. **底层 text / string 构造器必须接受 undefined/null**:
               - 任何接收字符串并在内部调 \`.replaceAll\` / \`.replace\` / \`.split\` 的函数,
                 参数类型都应放宽到 \`string | undefined | null\`, 并默认转空串。
                 典型名单: \`escapeXml / wrapCdata / shouldUseCdata / renderXmlTextValue /
                 escapeXmlComment / xmlText / xmlComment\` 系列 (已在 0492cf6 统一修完);
                 未来加新的 text-helper 也照此。
               - 理由: TS 的 any-cast 边界是客观存在的 (磁盘 JSON、跨进程消息、用户输入),
                 让崩溃从底层冒出是最差的可观测性, 不如"空串兜底 + 上层肉眼看见内容为空"。
            4. **写 seed / demo / test 数据时必须用 canonical 字段名**:
               - \`_seed_visible_demo.ts\` 这类手写 \`thread.json\` 的脚本, 严禁继续使用 legacy
                 字段。用什么字段名, 以 \`ThreadMessage\` / \`ContextWindow\` 等 TS interface 里
                 的声明为准; createdAt 用毫秒数字 (不是 ISO string); source / windowId /
                 fromObjectId / toObjectId 一个都不能缺。
               - 如果不确定 canonical 字段名, **先 grep 类型定义**, 不要猜。
            `,
            named: {
                "系统边界": "数据脱离 TS 编译期保护的地方: 磁盘 JSON / HTTP body / 跨 Agent 消息",
                "字段别名漂移": "同一语义有多个字段名, 不同消费者各实现各的兼容分支",
                "归一化函数": "集中处理字段别名 / 默认值 / 类型转换的唯一入口",
                "canonical 字段名": "TS interface 中声明的权威字段名, seed / test / demo 必须用它",
            },
            sources: [["xml.ts + render.ts + formatter.ts + _seed_visible_demo.ts", "四层修复对应文件: core/thinkable/context/xml.ts (null-safe text helpers)、core/thinkable/context/render.ts (messageBody content/text fallback)、web/src/domains/chat/formatter.ts (content/text + windowId/targetObjectId)、meta/storybook/_seed_visible_demo.ts (canonical ThreadMessage fields)"]],
            todo: [
                "下一阶段: 把散落的 msg.content ?? msg.text / targetObjectId ?? toObjectId 兼容集中到一个 normalizeThreadMessage() 函数, 避免各层重复写",
                "给 thread.json / .stone.json 的读取入口加 zod schema 或手写 assert, 防止脏数据静默通过",
            ],
        },
        layer_parallel_fix_pattern: {
            title: "跨层修复模式 - 一个数据问题的链路往往跨 server/core/web 三层",
            content: `
            **背景 (2026-06-03, session 1acc445b)**: 报告的是"outbox 消息没在页面上展示"。
            排查后发现这不是单个 bug, 而是三层各有各的问题, 必须三层一起修才闭环:
            - **core 渲染层** (\`packages/@ooc/core/thinkable/context/render.ts\` + \`xml.ts\`):
              信任了 TS 类型, 对 null content 调 replaceAll → thread status 直接 failed,
              整个上下文渲染中断。
            - **后端 seed 层** (\`packages/@ooc/meta/storybook/_seed_visible_demo.ts\`):
              手写的 thread.json 用了 legacy 字段名 (\`text\` / \`targetObjectId\` / ISO string
              createdAt) 且缺 windowId, 导致下游 formatter 无法把消息映射到 user target。
            - **前端展示层** (\`packages/@ooc/web/src/domains/chat/formatter.ts\`):
              \`buildOutboundMessageLinesForTargets\` 只从 \`talkWindowTargets[windowId]\`
              找 target, 且只认 \`m.content\`, 没 \`windowId\` / 字段是 legacy 名的消息直接被跳过。

            只修其中任何一层, 用户在 UI 上依然看不到消息: 修 core 只是让线程不崩,
            但 formatter 还是跳过; 修 formatter 只是兼容 legacy 字段, 但 core 已经崩了,
            thread 根本到不了展示环节; 修 seed 也不够, 因为 formatter/core 对边界数据
            的脆弱性仍在, 下次任何脏数据进来又会炸。

            **规约 (2026-06-03 起, 所有跨层链路问题强制执行)**:

            1. **修数据链路 bug, 先把三层都列出来再动手**: 任何"消息 / 文件 / 状态"类问题,
               在动手前先强制列出三层:
               - **生产层** (谁写数据 / 发请求 / seed 数据)
               - **传输/渲染层** (core 中的 context render / service layer)
               - **消费层** (web formatter / UI 组件)
               缺任何一层都先回答"这一层会不会也有问题"再动手。
            2. **三层修完才算闭环, 任何单层修复都不是 done**:
               - 修消费层 (formatter) 兼容 legacy 字段 = 缓解但未根治;
               - 修生产层 (seed) 用 canonical 字段 = 对新数据有效, 老数据仍会炸;
               - 修传输/渲染层 (xml/render) 兜底 null = 不崩但可能内容为空。
               三层都修完 = 老数据能退化展示、新数据严格规范、底层不崩溃。
            3. **测试时分别验证三层**:
               - 生产层: tsc + 跑 seed 脚本, 用 \`jq\` 或直接读 JSON 确认字段名与类型正确;
               - 传输/渲染层: 喂一条故意带 legacy 字段 / null content 的消息,
                 断言渲染不抛异常且 output 中能找到正文;
               - 消费层: 构造一条缺 windowId 但有 targetObjectId 的 outbox 消息,
                 断言 formatter 产出对应 ChatLine。
            `,
            named: {
                "生产-传输-消费三层": "数据链路的三个天然切面, 链路问题要三层一起看",
                "单层修复 ≠ done": "只修任何一层都会留下隐患, 三层都修复才算闭环",
            },
            todo: [
                "把这个三层清单模板放进 Supervisor 派 sub agent 修 bug 的 prompt 里",
            ],
        },
    },
    warnings: [
        "AgentOfX 各 stone (stones/agent_of_thinkable/ 等) 当前仓库内并未创建; 这是预期的——短期通过 Claude Code sub agent 暂行,不需要 stone 目录 (详见 patches.interim_runtime)。stones 的真正创建发生在该 Agent 从 Claude Code 形态迁移到 OOC 内 Object 形态的那一刻。",
    ],
};
