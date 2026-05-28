/**
 * 文档维护说明
 *
 * 本文件是 OOC 概念体系的"树形文档源"。所有 doc 节点都遵循 DocTreeNode 形态，
 * 形成一棵从根到叶不断细化的概念树。维护时请坚持以下原则:
 *
 * 1. 树形拆解模糊概念
 *    遇到一个含义模糊、信息量大的概念时，不要把所有细节堆在同一节点的 content 里，
 *    而是把它拆成 children / patches。每多走一层，概念就应该更清晰、范围更收敛。
 *    - children: 该节点"由什么组成"，下一层每个孩子负责一个明确子概念。
 *    - patches: 该节点的补充说明（特殊逻辑、边界情况、设计取舍），不是新的子概念。
 *
 * 2. 复杂度卸载（top-light, leaf-heavy）
 *    - 越顶层 → 信息密度越低、概念越泛、偏介绍性，让读者快速建立心智模型。
 *      根节点回答"这是什么、由几块组成"；不要在根节点谈具体字段、具体算法、具体文件。
 *    - 越深层 → 信息密度越高、概念越具体，偏设计与实现细节。
 *      叶节点可以直接引用 src/ 下的真实文件、字段名、行为契约。
 *    - 一个节点的 content 如果开始堆代码细节或边界条件，通常是信号:该往下拆一层。
 *
 * 3. content 的体例
 *    - 顶部用一两句话回答"这个节点在说什么"。
 *    - 中段用编号列表或 bullet 列出该节点的核心组成 / 关键事实。
 *    - 末段（可选）给出与其他节点的衔接、与代码的对应关系。
 *    - 避免在 content 里重复 children 的具体细节；上层只做导航，细节交给下层。
 *
 * 4. named 词典
 *    只收录 content 中真正出现、且读者可能需要单独定位的术语。
 *    不是术语堆叠表；同一术语在不同节点可以有不同侧重的解释。
 *
 * 5. todo / warnings
 *    - todo: 设计上承诺、代码里未实现的能力（如 compress tool）。
 *      明确写出当前在源码的什么位置占位、缺什么，方便后续推进。
 *    - warnings: 已知的问题
 *
 * 6. 与源代码的一致性
 *    - 文档断言"代码里有 X"时，应在叶节点附近用文件路径锚定，避免漂移。
 *    - 当源代码变动时，先核对叶节点的事实陈述；顶层介绍性内容通常不需要跟着抖动。
 *
 */

type DocTreeNode = {
    title: string; // 文档节点标题
    content?: string; // 文档节点内容

    named?: Record<string, string>; // content 中提到的名词的词典

    children?: Record<string, DocTreeNode>; // 该节点的主要组成部分
    patches?: Record<string, DocTreeNode>; // 该节点的补充(比如特殊逻辑、边界情况等)
    relations?: [[DocTreeNode, string]]; // 该节点与其他节点的关系， [0] 为其他节点，[1] 为关系描述
    sources?: [[any, string]]; // 该节点与源代码的关系， [0] 为源代码，[1] 为关系描述

    todo?: string[]; // 该节点需要完成的任务
    warnings?: string[]; // 该节点的问题
};
/**
 * Object 文档树的根节点。
 *
 * 这一层只回答 Object 在 OOC 中是什么，
 * 作为后续能力维度子树的阅读入口。
 */
export const root: DocTreeNode = {
    title: "OOC 概念",
    content: `
    OOC(Object Oriented Context) 以面向对象的方式组织上下文，以面向对象的方式构建 MultiAgent 系统

    OOC 是一种 AI Agent 架构，以面向对象编程的哲学为基础，分别在上下文工程、 MultiAgent 编排、GenUI、Agent 自我迭代 等工程方向提出设计:
    1. Agent 的上下文可以由 Object 组成，LLM 可以看见 Object 信息，也可以看见 Object 所具有的 Method, Object Method 为 Context 提供交互能力，LLM 可以通过调用 Object Method 来操作上下文，比如信息加载、信息压缩、信息清理。
    2. 一个 Agent 是一个 Object, 具有数据字段和程序方法，Object 之间可以协作、对话、派生新对象，形成 MultiAgent 系统。
    3. Object 模式的 Agent 具有元编程能力: 它可以为自己编写程序方法，可以编辑自己的数据字段，可以为自己编写知识文档，通过元编程能力，OOC 系统具有自我迭代、自我进化的可能。

    面向对象 是基础哲学，在具体实现中，不同领域可能会有自己的 Object 去进行实现。

    Agent 具有 stone、pool、flow 三种持久层（World 级三分，2026-05-23 起）:
    - stone: 象征"静"——持有 Object 的长期身份与设计源码（self.md / readme.md / server / client / knowledge 五件套），跨 session 共享，进 git review。其中 \`knowledge/\` 是 **seed knowledge**（人类设计的初始知识库），可挂 eval gate。
    - pool:  象征"积"——持有 Object 跨 session 累积的事实数据（data / knowledge / files 三件套），不进 git。data 用 csv（不用 sql；详见 persistable.pool.children.data_pool）；knowledge 是 **sediment knowledge**（运行时由 reflectable / collaborable 沉淀的 memory / relations）。
    - flow:  象征"动"——一个 Object 可以参与多个 session，每个 session 下有一个 flow，每个 flow 都有自己的 session 级数据字段和程序方法。

    Agent 由 8 个**内在能力维度**组合。判定一个东西是不是维度的标准是: 它是否**构成 Agent 的「自我」(self-constitutive)**（判定轴详见 patches.dimension_criterion）。按此标准 8 维度分两组:

    运行时底座（Agent 据以存在、思考、行动的基础）:
    - thinkable: 可以思考
    - executable: 可以行动
    - collaborable: 可以协作
    - observable: 可观测、记录、debug
    - persistable: 可以持久化存储

    自我塑造三件套（Agent 改写"自己"的三个面，OOC 自我进化主张的载体）:
    - reflectable: 自我反思、经验沉淀、元编程（改自己的知识）
    - programmable: 为自己编写函数方法（改自己的方法 / server 方法库）
    - visible: 为自己编写 UI 页面（改自己的界面）

    **extendable** 是**非维度的外接集成层**（不在 8 维度内）: 把外部世界（飞书 / notion / slack / github 等）按统一模板接入为可调用的 Window 与 command。它够的是**外部世界**，而外部系统不构成 Agent 自我，故不是维度（实现见 src/extendable/，首个 case 见 meta/case.feishu-integration.doc.ts，详见 children.extendable）。

    两条贯穿全维度的横切设计:
    - 对象关系三轴（详见 patches.object_relations）: 自我(super) / peer 平等(talk) / parent-child 层级。Supervisor 即这棵 object 树的 root parent。
    - agent-native parity 公理（详见 patches.agent_native_parity）: 每个维度都有"人类面 / agent 面"两个消费方，设计时都要回答这两面分别是什么。
    `,
    named: {
        "OOC": "Object Oriented Context, 以面向对象的方式组织上下文，以面向对象的方式构建 MultiAgent 系统",
        "OOC Agent": "OOC 系统中的 Object 模式的 Agent, 具有数据字段和程序方法",
        "thinkable": "OOC Agent 由几个维度组合，thinkable 是其中之一，定义 Agent 的思考能力",
        "executable": "OOC Agent 由几个维度组合，executable 是其中之一，定义 Agent 的行动能力",
        "collaborable": "OOC Agent 由几个维度组合，collaborable 是其中之一，定义 Agent 的协作能力",
        "observable": "OOC Agent 由几个维度组合，observable 是其中之一，定义 Agent 的可观测能力",
        "reflectable": "OOC Agent 由几个维度组合，reflectable 是其中之一，定义 Agent 的元编程能力",
        "programmable": "OOC Agent 由几个维度组合，programmable 是其中之一，定义 Agent 持有/演化自身函数方法库的能力",
        "visible": "OOC Agent 由几个维度组合，visible 是其中之一，定义 Agent 持有/演化自身 UI 页面的能力",
        "persistable": "OOC Agent 由几个维度组合，persistable 是其中之一，定义 Agent 的持久化存储能力",
        "extendable": "非能力维度的外接集成层：把外部世界（飞书 / notion / slack 等）按统一模板接入为可调用的 Window 与 command；实现见 src/extendable/",
        "stone": "OOC 持久层之一（静）：长期身份与设计源码（含 seed knowledge），进 git review",
        "pool": "OOC 持久层之一（积）：跨 session 累积的事实数据（含 sediment knowledge），不进 git",
        "flow": "OOC 持久层之一（动）：session 级临时数据与程序",
        "seed knowledge": "人类在 stone 中预置的初始知识库（stones/<self>/knowledge/）；进 git review，可挂 eval gate",
        "sediment knowledge": "Agent 运行时由 reflectable / collaborable 沉淀的知识（pools/<id>/knowledge/memory + relations）；写就生效，不进 git",
        "self-constitutive": "维度判定轴: 一个能力是否构成 Agent 的「自我」；是则为维度，否则为外接层/协议（详见 patches.dimension_criterion）",
        "运行时底座": "thinkable/executable/collaborable/observable/persistable，Agent 存在与运作的基础五维",
        "自我塑造三件套": "reflectable/programmable/visible，Agent 改写自己知识/方法/界面的三维",
        "agent-native parity": "横切公理: 用户能做的事 agent 也能做；每维度都有人类面/agent 面两个消费方（详见 patches.agent_native_parity）",
        "对象关系三轴": "自我(super) / peer 平等(talk) / parent-child 层级，三种不同权力语义的关系（详见 patches.object_relations）",
        "Supervisor": "world 级最顶层 parent object；harness 的 1 Supervisor + N Agent 即 object 树的一个实例，Supervisor 是 root parent",
    },
    children: {
        "thinkable": {
            title: "OOC Agent thinkable 概念",
            content: `
            Thinkable 描述 Object 的思考能力。

            核心组成:
            1. LLM 交互模块: 思考的核心是与 LLM 交互，常规需要适配 OpenAI 和 Claude provider，并以 Responses-first 的 item 模型表达消息、tool call 与 tool result。
            2. ContextBuilder 模块: 设计如何构建 LLM 输入（context），通过统一的抽象信息单元 ContextWindow 来构建 context，ContextWindow 具有名为 command 的方法供 LLM 调用。
            3. 函数调用模块: LLM 通过 4 个基础 tool 操作世界——exec（唯一的"调用 command"原语）/ close（关 window）/ wait（等 IO）/ compress（压上下文）。exec(window_id?, command, args?) 调某 window 上的 command，window_id 缺省为 root（全局 command）。
            4. 类 SubAgent 模式支持: 思考的过程通过 thread 承载，thread 可以派生子 thread，形成一个 Thread Tree，每个 thread 可以并行思考。

            ContextWindow 是信息展示单元，也是可操作对象，挂载名为 command 的窗口方法供 LLM 交互。

            渐进式披露的多步 command 调用: LLM 调 exec(window_id, command, args)；若 args 不齐或会引入新 knowledge path，系统创建一个 command_exec form 并激活该 command 的初始知识，告诉 LLM 怎么填；LLM 通过 exec(form_id, "refine", args) 多次累积参数（每次可触发更细的知识激活），最后 exec(form_id, "submit") 执行。例如打开文件 = exec(command="open_file", args={path})，文件以 file 类型 ContextWindow 进入 LLM 输入。close 关闭一个 ContextWindow。

            Thinkable 围绕上述模块拆分为以下子维度:
            - identity: Object 如何认识自己，以及如何被其他 Object 认识。
            - llm: 如何把 OOC 的内部消息模型适配到 OpenAI / Claude 等 provider。
            - context: Object 本轮能看见的全部世界，由若干 ContextWindow 组成。
            - knowledge: Object 拥有什么知识，以及知识如何按 command path 渐进激活。
            - thread: Object 的思考过程如何被拆成一棵可并行、可等待、可恢复的 Thread Tree。
            - thinkloop: 单个 thread 内一轮 "构造 context -> 调用 LLM -> 执行 tool -> 写入事件" 的循环。
            `,
            named: {
                "Thinkable": "Object 的思考能力维度，描述 Object 如何构造 context、调用 LLM、运行 thread 与 thinkloop",
                "identity": "Object 对自己的自我描述，以及对外暴露给其他 Object 的介绍",
                "LLM": "Large Language Model, Object 思考时调用的模型服务",
                "Context": "Object 每一轮思考时能看见的全部信息，是 Object 的世界边界",
                "ContextWindow": "Context 的统一抽象信息单元，既是信息展示单元，也是可操作对象，挂载名为 command 的窗口方法",
                "Knowledge": "Object 持有的 markdown 知识文档，可按 command path 渐进激活进入 Context",
                "Thread": "Object 思考过程的运行时节点，多个 thread 组成 Thread Tree",
                "Thread Tree": "thread 派生子 thread 形成的树形结构，多个 thread 可并行思考",
                "ThinkLoop": "单个 thread 内的一轮思考循环",
                "Command": "ContextWindow 上挂载的窗口方法，由 LLM 通过 exec tool 调用（args 不齐时经 command_exec form 的 refine/submit 推进）",
                "exec/close/wait/compress": "LLM 的 4 个基础 tool：exec 调某 window 上的 command（含 form 的 refine/submit）/ close 关 window / wait 等 IO / compress 压上下文",
                "form ContextWindow": "执行 command 时由 open 创建的表单型 ContextWindow，承载渐进式参数填充与知识激活",
                "ProcessEvent": "thread 运行中产生的过程事件，包括 LLM 输出、tool 调用和上下文变化",
            },
            children: {
                "identity": {
                    title: "identity - Object 的双面身份",
                    content: `
                    Identity 描述 Object 如何认识自己，以及如何被其他 Object 认识。

                    OOC 中的 Object 至少有两层身份文本:
                    1. self.md: Object 写给自己的身份说明，进入自己的 LLM instructions，用于定义目标、风格、知识背景、行为偏好。
                    2. readme.md: Object 写给外部世界的介绍，用于让其他 Object 或 user 理解 "我是谁、我能做什么、什么时候该找我"。

                    self.md 偏内向，是 Object 的自我约束。
                    readme.md 偏外向，是 Object 在协作网络中的名片。

                    这两个文件共同决定 Object 在系统中的人格边界:
                    - Object 如何解释任务。
                    - Object 如何选择行动风格。
                    - 其他 Object 如何发现它、引用它、与它协作。
                    `,
                    named: {
                        "self.md": "Object 写给自己的身份文档，每轮进入自己的 LLM instructions",
                        "readme.md": "Object 写给外部世界的介绍文档，供 user 和其他 Object 理解它的能力与边界",
                    },
                },
                "llm": {
                    title: "llm - Object 与大语言模型交互",
                    content: `
                    LLM 模块描述 Object 如何调用大语言模型。

                    OOC 内部采用 Responses-first 的 Item 模型表达 LLM 输入输出:
                    - message: 普通 system / user / assistant 文本。
                    - function_call: LLM 发起的 tool 调用。
                    - function_call_output: tool 调用结果。
                    - reasoning: 模型 thinking 记录。

                    Responses-first 的意义是把 tool call 和 tool result 当成一等结构，而不是把它们拼回一段 transcript 文本。
                    这样 debug、resume、tool call 对齐、provider 适配都会更稳定。

                    Provider 层负责把 OOC 内部模型翻译到具体模型服务:
                    - OpenAI Responses API 可以直接接收 input items。
                    - Claude Messages API 需要 transport 层把 function_call 翻译成 tool_use，把 function_call_output 翻译成 tool_result。

                    LLM 模块只负责 "如何请求模型"，不负责 "模型能做什么"。
                    模型能做什么由 executable 暴露的 tool / command 决定。
                    `,
                    named: {
                        "Responses-first": "OOC 内部优先采用 OpenAI Responses 风格的 item 模型表达 LLM 输入输出",
                        "function_call": "LLM 发起的结构化 tool 调用",
                        "function_call_output": "某次 function_call 对应的工具执行结果",
                        "provider": "具体模型服务适配层，如 OpenAI provider、Claude provider",
                        "transport": "把 OOC 内部消息模型转换为 provider wire format 的适配层",
                    },
                    patches: {
                        "reasoning_not_replayed": {
                            title: "reasoning 不应作为普通上下文反复喂回",
                            content: `
                            reasoning 是模型本轮的思考过程，主要用于 debug 和回放。

                            如果把 reasoning 作为普通上下文反复喂回，容易导致:
                            - LLM 开始 meta-thinking，思考自己的思考。
                            - transcript 体积快速膨胀。
                            - 旧推理过程干扰当前任务判断。

                            因此 reasoning 更适合记录，而不是作为下一轮思考的主要输入。
                            `,
                        },
                    },
                },
                "context": {
                    title: "context - Object 每轮思考时看见的世界",
                    content: `
                    Context 是 Object 每次思考时能看见的全部信息。

                    OOC 的关键约束是: Object 不知道 Context 之外的任何事情。
                    系统即使在内存或文件系统里拥有更多状态，只要没有进入该 Object 当前 thread 的 Context，对这个 Object 来说就不存在。

                    Context 通常由两层组成:
                    1. 稳定状态层: 以 system prompt / XML 形式描述当前 Object 的身份、知识、窗口、任务、环境。
                    2. 过程事件层: 以 LLM messages / input items 形式描述历史事件，比如用户消息、assistant 输出、function_call、function_call_output。

                    这两层不能混用:
                    - system prompt 表达 "我现在拥有什么"。
                    - process events 表达 "我之前经历了什么"。

                    Context 的主要组成（参见 src/thinkable/context/index.ts ThreadContext）:
                    - status: 调度状态（running / waiting / done / failed / paused）。
                    - inbox / outbox: 当前 thread 的协作消息。
                    - contextWindows: 当前打开的信息窗口与行动窗口（统一抽象）。
                    - events: 当前 thread 的历史 ProcessEvent 流（字段名为 events，类型为 ProcessEvent[]）。
                    - threadLocalData: 程序窗口等运行时共享的线程局部数据。
                    - parentThreadId / creatorThreadId / creatorObjectId / childThreadIds / childThreads: 线程树拓扑与父子关系。
                    - persistence: 持久化锚点（缺失时只在内存运行）。

                    以下三块不是 ThreadContext 的字段，但在每轮 buildInputItems 时合成进 LLM 输入:
                    - self: 由 persistence 派生 stone 路径，读取 self.md 注入到 LlmGenerateParams.instructions（loadSelfInstructions）。
                    - knowledge: 由 collectExecutableKnowledgeEntries(thread.contextWindows, thread) 从窗口状态派生为 knowledge_window 集合。
                    - [ooc:paths]: 由 buildPathsItem 合成的环境路径 system message（world_root / object_id / object_stone_dir / object_flow_dir / session_id / current_thread_id / current_thread_dir）。
                    `,
                    named: {
                        "Context": "Object 当前思考轮次可见的全部世界",
                        "system prompt": "稳定状态层，描述当前 context 快照",
                        "process events": "历史轨迹层，描述 thread 运行过程中发生过什么；在 ThreadContext 中字段名为 events",
                        "inbox": "其他 thread 或 Object 投递给当前 thread 的消息",
                        "outbox": "当前 thread 发出的消息",
                        "contextWindows": "当前 thread 持有的结构化信息窗口集合",
                        "instructions": "LlmGenerateParams.instructions，由 self.md 合成而非 ThreadContext 字段",
                        "[ooc:paths]": "每轮注入的环境路径 system message，承担 env 类信息的职责",
                    },
                    children: {
                        "context_window_reference": {
                            title: "Context 与 ContextWindow 的关系",
                            content: `
                            ContextWindow 是 Context 中最重要的结构化单元。

                            传统 prompt 往往把文件、搜索结果、任务说明、工具说明全部拼成文本。
                            OOC 则把这些内容建模为不同类型的 ContextWindow:
                            - file_window 展示文件。
                            - knowledge_window 展示知识。
                            - talk_window 展示对话。
                            - do_window 展示子线程任务。
                            - program_window 展示程序执行过程。
                            - search_window 展示一次 glob / grep 的命中。
                            - command_exec window 展示一次 command 调用的表单状态。

                            因此 Context 不是一段字符串，而是一组可被打开、关闭、更新、执行 command 的窗口对象。
                            ContextWindow 的完整行动语义归属于 executable。
                            `,
                        },
                    },
                },
                "knowledge": {
                    title: "knowledge - Object 拥有的知识",
                    content: `
                    Knowledge 是 Object 持有的 markdown 知识文档。

                    一篇 knowledge 文件由 frontmatter + markdown body 组成:
                    - frontmatter: yaml 头部，承载元信息字段。
                      - title: 知识标题。
                      - description: 一句话描述，让 LLM 知道这篇知识是否相关。
                      - activates_on: 渐进式披露规则（trigger map）。形态：
                        \`Record<triggerExpr, "show_description" | "show_content">\`。
                        三类 trigger（详见 src/thinkable/knowledge/triggers.ts）：
                        - \`"window::<type>"\` — 任意 open 的该类 window 出现时命中（\`"window::root"\` 等价"任何时候"）
                        - \`"command::<window_type>::<command>"\` — 该 window 上正在开同名 command form 时命中
                        - \`"super"\` — 仅在 super flow 中命中
                        多 trigger 命中取 **max**（show_content > show_description）。
                    - markdown body: frontmatter 之外的正文，构成 KnowledgeDoc.body。

                    Knowledge 的核心设计是渐进式激活:
                    LLM 还没进入某个行动路径时，只看到少量描述或完全看不到。
                    当 LLM 打开某个 command_exec window，并逐步 refine 参数时，系统逐条 evaluate 各篇 knowledge 的 trigger map，命中级别取 max。

                    例如:
                    - 在 root 上打开 program command form 时，\`"command::root::program"\` 命中。
                    - 任何 talk_window open 时，\`"window::talk"\` 命中——seed 的"我跟人 talk 该露面"类型 knowledge 持续可见。
                    - 显式 open_knowledge 时，把某篇知识作为 knowledge_window 打开（force-full）。

                    这样可以避免所有知识一股脑进入 Context，控制 token 体积，同时让 LLM 在需要时获得足够指导。

                    Knowledge 的两个来源（2026-05-24 起 seed / sediment 二分，详见 persistable.stone.children.seed_knowledge 与 persistable.pool.children.knowledge_pool）:
                    - **seed knowledge**: \`stones/<self>/knowledge/<slug>.md\`——人类设计的初始知识库，进 git review、可挂 eval gate。
                    - **sediment knowledge**: \`pools/objects/<self>/knowledge/{memory,relations}/\`——运行时由 reflectable / collaborable 自动沉淀，不进 git。

                    synthesizer **双源扫描**：seed 与 sediment 都被加载，frontmatter + activates_on 协议统一；
                    LLM 看到的不分来源（只看到激活后的 knowledge_window 正文）。
                    `,
                    named: {
                        "frontmatter": "markdown 文档头部的结构化元信息",
                        "activates_on": "knowledge 声明自身何时进入 Context 的激活规则（trigger map: 表达式 → 级别）",
                        "trigger": "activates_on 中的 key 表达式，三类：window::<type> / command::<window_type>::<command> / super",
                        "show_description / show_content": "activates_on 的两种激活级别；多 trigger 命中取 max",
                        "knowledge_window": "把 knowledge 正文作为 ContextWindow 展示给 LLM 的窗口",
                        "seed knowledge": "stones/<self>/knowledge/，人类设计的初始知识库；进 git review",
                        "sediment knowledge": "pools/<id>/knowledge/{memory,relations}/，运行时沉淀；不进 git",
                        "双源扫描": "synthesizer 同时扫 stone seed 与 pool sediment，统一渐进激活",
                    },
                    patches: {
                        "activation_scope": {
                            title: "自动激活知识的生命周期",
                            content: `
                            由 command_exec window 自动激活的 knowledge 应该跟随这次 command 生命周期。

                            当 command_exec window 关闭或执行结束后，本次自动激活的知识不应永久堆在 Context 里。
                            如果 LLM 希望长期保留某篇知识，应通过显式 open_knowledge 打开 knowledge_window。
                            `,
                        },
                        "domain_axis": {
                            title: "B-tree 协议：领域父子继承",
                            content: `
                            **背景**：现有 \`activates_on\` 提供的是"任务进度轴"——根据 LLM 当前 command path 渐进激活；
                            但**领域层级轴**（从大领域到子领域）此前没有协议表达，导致 sentry/* 类一组同领域 Agent
                            的公共知识无处放：放 \`stones/main/knowledge/\` 全局可见但其实没人加载、放每个子 Agent 自己的
                            \`knowledge/\` 又会重复 N 份。

                            **协议**：knowledge 激活的实际是二维 grid：
                            - 横轴 = 任务进度（command path / form refinement）—— 既有 \`activates_on\`
                            - 纵轴 = 领域层级（B-tree 父子继承）—— 本协议新增

                            纵轴通过**物理嵌套** + **frontmatter 显式声明** 两件事解决：

                            ## 1. 物理嵌套（B-tree）

                            子 Agent 物理嵌套在 parent 的 \`children/\` 子目录下：

                            \`\`\`
                            stones/<branch>/objects/sentry/
                            ├── .stone.json
                            ├── self.md
                            ├── readme.md
                            ├── knowledge/
                            │   ├── sentry_intro.md      (frontmatter inheritable: true)
                            │   └── sentry_factor.md     (frontmatter inheritable: true)
                            └── children/
                                ├── sentry_event/        (子 Agent，objectId="sentry/sentry_event")
                                ├── sentry_event_factor/ (子 Agent)
                                └── sentry_factor_group/ (子 Agent)
                            \`\`\`

                            **objectId 路径编码**：嵌套子 Agent 的 objectId 用 "/" 编码层级：
                            - \`sentry\` → \`stones/<branch>/objects/sentry/\`（顶层）
                            - \`sentry/sentry_event\` → \`stones/<branch>/objects/sentry/children/sentry_event/\`
                            - \`a/b/c\` → \`stones/<branch>/objects/a/children/b/children/c/\`

                            实现：\`src/persistable/common.ts:nestedObjectPath\` 把 objectId split("/")，segments 间插入 \`children/\` marker；\`stoneDir\` 调用它得到物理布局。

                            ## 2. frontmatter 继承门控

                            knowledge 文件的 frontmatter 必须显式声明 \`inheritable: true\` 才能被子 Agent 继承：

                            \`\`\`yaml
                            ---
                            title: 哨兵主链路
                            inheritable: true        # 必须显式 true，缺省 / false 都不下传
                            ---
                            \`\`\`

                            缺省（不写此字段）= 不下传——这个**默认安全**的设计避免了"父级 knowledge 大量误下传膨胀子 Agent context"。

                            ## 3. loader 加载顺序（CSS-cascade 语义）

                            \`loadKnowledgeIndex\` 加载顺序（前者被后者覆盖）：

                            1. **祖先 seed**：从 root → immediate parent，扫每个祖先 \`stones/.../<ancestor>/knowledge/\`，
                               仅纳入 \`inheritable: true\` 的文件
                            2. **self seed**：扫 \`stones/.../<self>/knowledge/\`（自然 override 父级同 idPath）
                            3. **self sediment**：扫 \`pools/objects/<self>/knowledge/\`（保留原有 sediment 覆盖 seed 语义）

                            子 Agent 自己的 knowledge 永远**override** 父级（CSS cascade，更具体的覆盖更宽泛的）。

                            ## 4. sediment 不下传

                            **祖先的 pool（sediment knowledge：memory / relations）默认不下传**：

                            - sediment 是该 Agent 私有的运行时认知（reflectable / collaborable 沉淀），跨 Agent 共享有隐私问题
                            - loader 只扫祖先 \`stoneKnowledgeDir\`，不扫祖先 \`poolKnowledgeDir\`
                            - 即便 sediment 文件 frontmatter 写了 \`inheritable: true\` 也不下传——是 loader 路径选择决定的，不是 frontmatter 决定的

                            如确需跨 Agent 共享某条认知，应该把它从 sediment 提升到 stone seed 并标 \`inheritable: true\`，进 git review。

                            ## 5. 边界 / 已知未解决

                            本期（MVP）只实现：
                            - \`stoneDir\` 的 "/" 路径解析
                            - knowledge loader 的祖先继承
                            - frontmatter \`inheritable\` 字段

                            **暂不解决**（标记为已知 issue，按需后续推进）：
                            - listStones() 不递归扫 children/，nested Agents 不在 list 输出里
                            - web sidebar / \`/stones/:id\` URL 路由对 "/" 编码的 objectId 处理
                            - flow 侧 \`flows/<sess>/objects/<id>/\` 对嵌套 objectId 的展开（路径会自然嵌套，但 readdir 类扫描需更新）
                            - eval gate 跨层语义、context budget 距离衰减、DAG 多继承
                            - 已有 sentry_event_factor 等 8 个平铺 sentry_* Agent 的物理迁移

                            实现锚点：
                            - \`src/persistable/common.ts:stoneDir\` / \`STONE_CHILDREN_SUBDIR\`
                            - \`src/persistable/stone-object.ts:ancestorObjectIds\` / \`stoneChildrenDir\`
                            - \`src/thinkable/knowledge/loader.ts:loadKnowledgeIndex\`
                            - \`src/thinkable/knowledge/types.ts:KnowledgeFrontmatter.inheritable\`
                            - 测试：\`src/thinkable/knowledge/__tests__/loader-inheritance.test.ts\`
                            - 首个使用：\`.ooc-world/stones/main/objects/sentry/\`（parent stone + 3 份 inheritable knowledge）
                            `,
                            named: {
                                "B-tree": "Agent 物理嵌套形成的树（每个 Agent 可有 children/ 子目录），与 children 之间多分支即 B-tree",
                                "inheritable": "knowledge frontmatter 字段，true 才下传给子 Agent",
                                "CSS-cascade": "更具体的（子级）覆盖更宽泛的（父级）—— web CSS 经典语义",
                                "objectId 路径编码": "用 \"/\" 分隔多级，stoneDir 解析时插入 children/ marker",
                            },
                        },
                    },
                },
                "thread": {
                    title: "thread - Object 思考过程的运行时节点",
                    content: `
                    Thread 描述 Object 思考的运行时结构。

                    一个 Object 在一次 session 中不只有一条线性对话，而是可以形成一棵 Thread Tree。
                    每个 thread 是一个独立的思考节点，持有自己的 Context、ContextWindow、inbox、outbox、events 和 status。

                    Thread Tree 的意义:
                    1. 焦点隔离: 主任务不必被子任务细节污染。
                    2. 作用域隔离: 不同子任务可以激活不同 knowledge 和窗口。
                    3. 并行执行: 多个 running thread 可以由 scheduler 分别推进。
                    4. 协作显式化: 跨 thread 信息流必须经过 message / transcript，而不是共享内存。

                    Thread 的典型状态:
                    - running: 可被 scheduler 选中执行下一轮 ThinkLoop。
                    - waiting: 等待某个 talk_window 或 do_window 上的未来 IO。
                    - done: 当前任务完成，但新 inbox 消息可以重新唤醒。
                    - failed: 发生严重错误，后续消息也可以让它重新进入 running。
                    - paused: 被控制面暂停，等待人工检查或 resume。

                    子线程通常由 do command 创建。
                    父线程通过 do_window 观察子线程状态，子线程完成后通过 creator window 把结果回报给父线程。
                    `,
                    named: {
                        "Thread Tree": "一个 Object 在 session 中形成的线程树，根线程可以派生子线程",
                        "scheduler": "调度 running thread 的运行时组件",
                        "do_window": "父线程中代表某个子线程任务的窗口",
                        "creator window": "子线程用于向创建者回报结果的初始窗口",
                    },
                    patches: {
                        "no_shared_context": {
                            title: "thread 之间不共享 Context",
                            content: `
                            thread 之间不能直接读取彼此的 contextWindows / events / threadLocalData；
                            跨线程影响必须显式经过 inbox / outbox、do_window transcript 或 talk_window transcript，
                            所有协作痕迹都能被观察、回放和 debug（详见 collaborable.patches.no_shared_state_across_threads）。

                            唯一例外: do_window.move 提供 ContextWindow 的跨 thread ref / 移交语义
                            （详见 collaborable.patches.cross_thread_window_sharing 与 executable.context_window.children.sharing）。
                            `,
                        },
                        "thread_plan_deprecated": {
                            title: "thread.plan 字段废弃 (P2)",
                            content: `
                            **ThreadContext.plan: string 字段被废弃**。

                            原因: 一个字符串 plan 不足以表达 sub plan 嵌套、跨 thread share、进度回流等更结构化的协作需求。
                            升级路径: plan 升格为 first-class plan_window (详见 executable.children.context_window.children.plan_window)。

                            迁移规则:
                            - 新代码: **绝不**读写 thread.plan; 完全走 root.plan command 创建 plan_window
                            - 旧代码 (如有): 在 B2 实施时一并扫除; ThreadContext type 中 plan 字段移除
                            - thread.json 历史数据: 历史 plan 字符串数据丢弃 (无迁移; OOC 当前不承诺历史 thread 兼容)

                            访问 plan 内容的新姿势:
                            - LLM: 看 contextWindows 中 type==="plan" 的 PlanWindow
                            - UI: ContextSnapshotViewer 渲染 PlanWindow tree
                            - server method: 走标准 ContextWindow 查询（如 \`self.findWindowsByType("plan")\`）

                            这是 P2 决策（user 拍板, 完全废弃 thread.plan 而非保留为 fallback summary）;
                            原因: 维护两条 plan 数据源会产生不一致风险。
                            `,
                        },
                        "subthread_vs_child_agent": {
                            title: "sub-thread vs child Agent - 委派任务时分的是什么",
                            content: `
                            "让别的执行体替我干活"在 OOC 里有两种机制，性质和代价完全不同，doc 别处分散在 thinkable / persistable，这里集中对比:

                            - fork sub-thread（同 object，do command + do_window）: 把自己"分身"成并行子线程。子 thread **共享我这个 object 的 seed / pool**，只有 session / thread-local 状态独立。临时，session 结束即归档，无独立身份。分的是**算力**。
                            - 建 child Agent（跨 object，物理嵌套在 stones/.../<self>/children/<child>/）: 一个**独立 object**，有自己的 stone(seed) / pool(sediment) / 自己的 super / 自己的 self.md，通过 talk 协作。持久、跨 session，可被别的 Agent 独立发现 / 引用。分的是**身份与经验**。

                            分界线: 是否需要**跨 session 的持久身份 + 独立经验积累**。
                            - 一次性、本 session 内、共享我知识的并行 / 探索 / 分治 → fork sub-thread。
                            - 需要跨 session 复用、需要自己的 pool 沉淀专精领域经验、需要被独立 talk 到的长期专精角色 → child Agent。

                            固化触发器: 当**同一类 sub-thread 任务在多个 session 反复出现、且每次都要重新喂同样的领域知识**，就该把它固化成 child Agent——把反复用的领域知识沉淀进 child 的 seed knowledge（接 thinkable.knowledge 的 B-tree 继承）。child Agent 存在的理由，正是它持有 sub-thread 不该常驻的专精 seed。

                            一句话: sub-thread 分"算力"，child Agent 分"身份与经验"。parent-child 的修改权 / 治理见 root.patches.object_relations。
                            `,
                            named: {
                                "sub-thread": "同 object 内 do command 派生的临时子线程，共享 seed/pool，无独立身份",
                                "child Agent": "跨 object 的持久下属，物理嵌套在 parent/children/<child>/，有独立 seed/pool/super",
                                "固化触发器": "同类 sub-thread 任务多 session 反复 + 重喂领域知识 → 升级为 child Agent",
                            },
                        },
                    },
                },
                "thinkloop": {
                    title: "thinkloop - 单个 thread 的思考循环",
                    content: `
                    ThinkLoop 是单个 thread 内的一轮思考循环。

                    一轮 ThinkLoop 的典型顺序:
                    1. 构建 Context: 从 Object、thread、window、knowledge、message 中组装当前世界。
                    2. 构造 LLM 输入: 把稳定状态和过程事件转换成 provider 可消费的 input items。
                    3. 调用 LLM: 带上可用 tool schema，让模型产生 assistant text 或 tool call。
                    4. 记录输出: 把 assistant text、reasoning、function_call 写入 thread.events（ProcessEvent[]）。
                    5. 检查 pause/debug: 必要时把 input/output 落盘，允许人工观察或介入。
                    6. 分派 tool call: 把 exec / close / wait / compress 调用交给 executable。
                    7. 更新 thread 状态: 可能继续 running，也可能 waiting、done、failed、paused。

                    ThinkLoop 只处理 "当前 thread 的下一轮"。
                    多个 thread 谁先执行、谁后执行，由 scheduler 决定，不属于 ThinkLoop 自身。
                    `,
                    named: {
                        "tool schema": "暴露给 LLM 的工具调用协议",
                        "debug": "把 LLM 输入输出落盘，供观察和回放",
                        "pause": "在执行 tool call 前暂停，让人工可以检查或修改本轮输出",
                    },
                    patches: {
                        "tool_error_not_fatal": {
                            title: "普通 tool 调用失败不直接终止 thread",
                            content: `
                            tool 调用失败通常是参数不完整、目标 window 不存在、资源暂时不可用等可恢复错误。

                            更好的处理方式是把错误写入 function_call_output 或 context_change，让下一轮 LLM 看见错误并自行修正。
                            只有 buildContext 失败、LLM 调用失败等严重错误才应把 thread 置为 failed。
                            `,
                        },
                    },
                },
                "context_budget": {
                    title: "context_budget - 控制 Context token 体积的压缩策略",
                    content: `
                    Context 不是无限的。一个 thread 跑得越久，contextWindows 累积越多、events 流越长、单 window 内容越大，
                    最终都会撞 LLM 的 token 上限。OOC 的 context 是
                    结构化对象集合（windows[] + events[] + knowledge + ...），压缩必须按 OOC 自己的本性来：每个 window
                    type 自负责自己的折叠（与 renderXml 同协议），events 流走独立的 ring + 摘要。

                    三档压缩状态 (compressLevel 0|1|2):
                    - 0 live: 完整渲染。
                    - 1 folded: 仅 title + summary + 一条 expand 命令；信息可恢复。
                    - 2 snapshot: 仅元信息 (title + status + 持久化指针)；细节按需从 stone/flow 持久化层读回。

                    三路触发并行 (互不替代):
                    - 主动: LLM 调 compress tool (见 executable.tools.children.compress)，自觉判断 "context 太杂"。
                    - 自然衰减: ThinkLoop 每轮按 status / age 自动 fold idle window (见 patches.natural_decay)。
                    - 紧急兜底: 接近 budget.hard 时强制降级 (见 patches.emergency_guard)。

                    visibility-first: 每次压缩落一条 ProcessEvent (type=context_compressed)；LLM / debug / UI 永远可见。

                    **LLM 主动节流的精细补充**：单 window 内部体量由 viewport 协议管理
                    （见 executable.context_window.patches.viewport_protocol）—— file / knowledge window 的
                    \`set_viewport\` 调整行+列范围；与 compressLevel 正交（compress 是 window 之间宏观；
                    viewport 是 window 内部微观）。

                    设计完整版见 docs/2026-05-25-context-compression-design.md。
                    `,
                    named: {
                        "compressLevel": "ContextWindow 当前压缩档位; 0=live, 1=folded, 2=snapshot",
                        "compress tool": "LLM 主动入口; 见 executable.tools.children.compress",
                        "events_summary": "events 流中段折叠后形成的特殊 ProcessEvent type",
                        "budget.soft / budget.hard": "stone 级配置的 token 阈值; soft 触发警告, hard 触发自动降级",
                        "context_compressed": "每次压缩动作落盘的 ProcessEvent type; visibility-first 不变量",
                    },
                    patches: {
                        "type_dispatch": {
                            title: "type-dispatch - 每个 window type 自负责 compressView",
                            content: `
                            WindowTypeDefinition 加可选字段 compressView(window, level, ctx) → XmlNode[]。
                            render.ts 调度器读 window.compressLevel: level=0 走 renderXml; level≥1 走 compressView,
                            缺省时 fallback 到通用 title-only 渲染。
                            绝不让一个全局算法压所有东西。
                            每个 type 自定义 fold 时保留什么 (file 保 path+行数, search 保 query+命中数,
                            talk 保 peer+消息数, do 保 child id+status...)。
                            compressView 与 renderXml 同协议; 启动期同样 fail-loud (如配 hook 但未注册则抛错)。
                            `,
                        },
                        "natural_decay": {
                            title: "自然衰减 - status / age 驱动的自动折叠",
                            content: `
                            ThinkLoop 在 buildContext 前跑一次 applyNaturalDecay。规则:
                            - idle-fold: window status ∈ {done, archived, closed, idle, failed} 持续 N 轮 → level 0→1。
                            - age-fold: window 自上次被 exec 操作起 M 轮无访问 → level 0→1。
                            - double-fold: level 1 状态再持续 K 轮 → level 1→2。
                            - cascade: parent fold 时所有 child fold 同档。
                            默认 N=3, M=10, K=8; 各 Object 可在 stones/<self>/config/context-budget.json 调参。

                            **豁免规则**：
                            - root: thread 同生命周期, 不可关闭
                            - command_exec.status ∈ {open, executing}: 真活动 form (LLM 正在用 / exec 在跑)
                            - **command_exec.status === "failed": 不豁免**（failed 不是焦点; LLM 可能永远不回头修; 让它走自然衰减 fold）
                            - command_exec.status === "success": 不会到衰减阶段 (success 自动从 contextWindows 移除)

                            当前：仅 open/executing 豁免，failed 参与衰减（复用既有 idle-fold 而非发明新 GC 机制）。
                            完整 design 见 docs/2026-05-27-failed-form-gc-design.md。
                            `,
                        },
                        "emergency_guard": {
                            title: "紧急兜底 - 接近 budget 时强制降级",
                            content: `
                            ThinkLoop 第 1 步估算当前 thread 若全 level 0 渲染的 token (粗估 JSON.stringify length / 4)。
                            - 超 budget.soft (默认 100K): 在 system prompt 顶部插入 <context_budget_warning>; LLM 自行决定是否 compress。
                            - 超 budget.hard (默认 180K): 系统自动 level 0→1, 再超自动 level 1→2, 最后 fold events_summary。
                            每一步落 ProcessEvent。emergency 路径不调用 LLM 生成 summary, 仅按 type 默认 fallback 折叠
                            (避免引入幽灵 LLM 流量)。
                            `,
                        },
                        "events_ring": {
                            title: "events 流单独治理 - head/tail ring + 中段摘要",
                            content: `
                            events 不属于 window 系统, 走独立协议:
                            events = [head_ring(J=10), <events_summary count=N earliest latest/>, tail_ring(K=40)]
                            中段 events 超容时, 由 LLM 在 compress(scope=events, summary=...) 调用中提供摘要文本——
                            不在后台偷偷调用 LLM (no ghost LLM traffic)。原 events 仍留在 thread.json (持久化不真删),
                            仅 LLM 视图中替换为 summary 节点。
                            `,
                        },
                        "invariants": {
                            title: "不变量 - 压缩协议的硬约束",
                            content: `
                            压缩协议必须满足:
                            1. 可见性: 每次压缩落 ProcessEvent (type=context_compressed); silent-swallow ban 同样适用。
                            2. 可逆性: 所有 level≥1 window 自动挂 expand command; exec(window_id, "expand") 恢复 level 0。
                            3. type-dispatch 不破: 不允许 render.ts 出现 switch-by-case; compress 只走 compressView hook。
                            4. 持久化不丢: compressLevel 字段进 thread.json (默认值 0 时不序列化); 原 events fold 后留盘。
                            5. 无幽灵 LLM 流量: events 摘要由 LLM 在 compress 调用中主动产出, 系统不偷偷调用 LLM 生成摘要。
                            `,
                        },
                    },
                    sources: [["docs/2026-05-25-context-compression-design.md", "完整 design (含 4 个高频 type 的 compressView 建议表 + P0a~P0f 分阶段实施 + 风险清单)"]],
                    todo: [
                        "实施分阶段见 docs/2026-05-25-context-compression-design.md §6 (P0a meta 已落, 进入 P0b)",
                    ],
                },
            },
        },
        "executable": {
            title: "OOC Agent executable 概念",
            content: `
            Executable 描述 Object 的行动能力。

            Thinkable 让 Object 能思考，Executable 让 Object 能改变世界。
            在 OOC 中，LLM 不直接调用任意函数，也不直接读写任意状态；它只能通过一组稳定的 tool 原语与 ContextWindow 交互。

            Executable 的核心分层:
            1. Tool 原语层: exec / close / wait / compress，是 LLM 直接看见的稳定接口（4 个）。
            2. Command 层: do / talk / program / plan / todo / end / open_file / open_knowledge / write_file / glob / grep 等具体行动；form 自身的 refine / submit 也是 command_exec window 上的命令。
            3. ContextWindow 层: 行动产生或操作的上下文对象，比如 file_window、talk_window、program_window、do_window、plan_window、custom window。
            4. Registry / Manager 层: 注册不同 window type 的 command、render、close hook、basicKnowledge。
            5. Knowledge Activation 层: 根据 command path 自动激活执行所需知识。

            因此，Executable 不是 "给 LLM 一堆工具"。
            它是一套以 ContextWindow 为中心的行动协议: LLM 通过 exec 在某 window 上调一条命令；
            args 齐全立即执行，args 不齐时系统创建一个 command_exec form，LLM 后续通过
            \`exec(form_id, "refine"/"submit")\` 推进。
            `,
            named: {
                "Executable": "Object 的行动能力维度，定义 LLM 如何通过 tool、command、ContextWindow 改变系统状态",
                "Tool": "LLM 直接可调用的稳定原语：exec / close / wait",
                "Command": "具体行动单元，挂在某 window 上注册；如 do/talk/program 在 root 上、refine/submit 在 command_exec 上",
                "ContextWindow": "可展示、可操作、可挂载 command 的上下文窗口对象",
                "WindowType": "ContextWindow 的类型分支，如 root/file/program/talk/do/knowledge/search/plan/custom",
                "CommandExec": "一次 command 调用过程对应的临时窗口；自身注册 refine/submit 命令",
                "WindowRegistry": "注册各类 window type 行为的机制",
                "WindowManager": "管理 thread.contextWindows 增删改查和生命周期的机制",
            },
            children: {
                "tools": {
                    title: "tools - LLM 直接调用的行动原语",
                    content: `
                    Tool 是 LLM 直接看见和调用的稳定接口。

                    OOC 不鼓励为每个能力都暴露一个新 tool。
                    相反，tool 集合尽量保持稳定，新的能力通过 command 和 window type 扩展。

                    基础 tool（当前实现 4 个，src/executable/tools/index.ts OOC_TOOLS）:
                    - exec: 在某 window 上调用一条 command。args 齐全 + 不引入新 path/knowledge 时立即执行；
                      否则创建 command_exec form 让 LLM 后续推进。
                    - close: 关闭一个 ContextWindow（form / do_window / todo_window 等）。
                    - wait: 声明当前 thread 等待某个 talk_window / do_window 的未来 IO。
                    - compress: 控制 thread 上下文体积（折叠 window / fold events）。见 children.compress。

                    Tool 层的设计目标是让 LLM 学会少量稳定动作:
                    - 需要执行命令时 exec。args 不全 → 系统给你 form，再继续 exec(form_id, "refine"/"submit")。
                    - 用完后 close。
                    - 没有未来输入就 end，有未来输入才 wait。
                    `,
                    named: {
                        "exec": "在某 window 上调用一条 command 的工具原语；可能立即执行或创建 form",
                        "close": "关闭 window 或取消行动入口的工具原语",
                        "wait": "让当前 thread 等待未来 IO 的工具原语",
                        "compress": "控制 thread 上下文体积的元 tool；见 children.compress",
                    },
                    children: {
                        "compress": {
                            title: "compress - 控制 thread 体积的元 tool",
                            content: `
                            compress 是控制 thread 上下文体积的元 tool, 与 exec/close/wait 不同——
                            它操纵 thread 自身 (windows[] + events[]) 而非具体某个 window 的行动。

                            签名:
                            compress(args: {
                                scope: "windows" | "events" | "auto",
                                targetIds?: string[],
                                level?: 1 | 2,
                                summary?: string,
                            })

                            三种 scope:
                            - windows: 主动折叠指定 window (targetIds 必传); 各 window 走注册的 compressView 渲染折叠态。
                            - events: LLM 自己 fold 中段 events; LLM 自写 summary 文本, 不引入 ghost LLM traffic。
                            - auto: 让系统按当前 budget 自动决策 (提前触发 thinkable.context_budget.patches.emergency_guard 路径)。

                            与 thinkable.context_budget 配套: compressView hook 协议、自然衰减、emergency guard、不变量
                            都在那里定义。compress 是 LLM 视野内的 first-class action, 让 "控制自身上下文体积"
                            不再是会话外的指令。

                            为什么 compress 是 tool 而非 command (与 stable_tool_surface patch 不冲突):
                            command 挂在某 window 上, 操纵 window-local 状态; compress 操纵 thread 自身的 windows[] +
                            events[] 集合, 没有合适的 window 可挂。这是与 close/wait 一样的"操纵 thread 自身"类元 tool。
                            `,
                            named: {
                                "scope=windows": "主动折叠指定 window 集合",
                                "scope=events": "LLM 自写 summary fold events 中段",
                                "scope=auto": "让系统按 budget 自动决策",
                                "expand": "level≥1 window 自动挂载的恢复 command; exec(window_id, \"expand\") 复位 level 0",
                            },
                            sources: [["src/executable/tools/compress.ts", "compress 已实现（OOC 第 4 个 LLM tool, 注册于 src/executable/tools/index.ts OOC_TOOLS）; 当前仅 scope=windows 落地, scope=events/auto 抛 not-implemented; 完整协议见 docs/2026-05-25-context-compression-design.md §4.5"]],
                        },
                    },
                    patches: {
                        "stable_tool_surface": {
                            title: "tool surface 应保持稳定",
                            content: `
                            LLM 直接学习的是 tool 原语。
                            如果每新增一个能力就新增一个 tool，模型的行动面会不断变化，调试和知识激活也会复杂化。

                            因此新能力应优先表现为新的 command 或新的 window type，而不是新的顶层 tool。
                            `,
                        },
                        "form_lifecycle_via_commands": {
                            title: "form lifecycle 下沉为 command_exec 的命令",
                            content: `
                            旧版本曾有 5 个原语 open/refine/submit/close/wait，其中 refine/submit 仅服务 form lifecycle。

                            迁移后：open 并入 exec（exec 是唯一"调 command"原语）；refine/submit 不再是顶层 tool，
                            而是 CommandExecWindow 上注册的两条命令；通过 \`exec(form_id, "refine", args={...})\` /
                            \`exec(form_id, "submit")\` 调用，与 do_window.continue / talk_window.say / custom 命令同构。
                            LLM tool surface = exec / close / wait / compress（4 个），但行为表达力不变。
                            `,
                        },
                    },
                },
                "commands": {
                    title: "commands - 具体行动单元",
                    content: `
                    Command 是 LLM 通过 exec 间接调用的具体行动。

                    LLM 通常不是直接 "调用 program 函数"，而是:
                    1. exec(command="program", args={ language: "shell", code: "..." }) → args 齐全立即执行
                    2. 或 exec(command="program") → 系统创建 form，后续 exec(form_id, "refine", args={...}) + exec(form_id, "submit")
                    3. command 产生副作用，比如创建 program_window 或派生 plan_window。

                    root window 注册一组顶层 command（与 src/executable/windows/root/index.ts ROOT_COMMANDS 一致）:
                    - do: 派生子 thread，创建 do_window。
                    - talk: 与 user 或其他 Object 对话，创建 talk_window。
                    - program: 执行 shell / javascript / typescript 程序，创建 program_window。
                    - plan: 更新当前 thread 的 plan。
                    - todo: 创建可见待办 todo_window。
                    - end: 标记当前 thread 完成。args = { reason?, summary?, result? }。其中 result 是子 thread
                      想带回父 thread 的一段文本——传 result 时 end 会**自动调用
                      creator window 的 continue/say** 把内容写入 transcript（等价于子主动 reply），并
                      auto-archive 父侧 creator window（do_window 类）。如果不传 result，end 只标记本轮结束，
                      不触发任何 reply。注意：result 是便捷糖，**不是回报通道**——明确的多段对话仍应通过
                      creator window.continue / say 完成。
                    - open_file: 把文件作为 file_window 引入 Context。
                    - open_knowledge: 把知识文档作为 knowledge_window 引入 Context。
                    - write_file: 创建或覆盖文件，并通常打开对应 file_window。
                    - glob: 按文件名模式搜索，创建 search_window。
                    - grep: 按文件内容正则搜索，创建 search_window。
                    - metaprog: 开元编程 worktree 沙箱，自改 stones/<branch>/objects/<self>/ 方法库 / 界面 / 身份。
                    - open_feishu_chat: 把飞书群会话作为 feishu_chat_window 引入 Context。
                    - open_feishu_doc: 把飞书文档作为 feishu_doc_window 引入 Context。

                    （共 14 个全局 command，与 src/executable/windows/root/index.ts ROOT_COMMANDS 一致。）

                    其它 window 上也注册命令（do_window: continue/wait/close；talk_window: say/wait/close；
                    file_window: edit/reload/set_range/close；command_exec: refine/submit；custom: Object 自定义 ...）。
                    Object 自定义 commands 通过 server/index.ts 的 \`export const window\` 注册到 type=custom 的 self window 上。

                    Command 与 knowledge 通过 trigger 协议协作：
                    每个 command_exec form 在 thread 中处于 open 状态时，对应的
                    \`"command::<parent_window_type>::<command>"\` trigger 进入命中状态；
                    knowledge 的 frontmatter \`activates_on\` 中声明同样表达式即按需激活。
                    （历史上 command 还会派生 commandPaths 子路径如 program.shell，但新 trigger
                    模型只到 command 粒度；语言/参数分支由 knowledge 正文自己分支，不再走 path。）
                    `,
                    named: {
                        "root window": "每个 thread 隐含存在的根窗口，注册顶层 command",
                        "do": "派生子 thread 的 command",
                        "talk": "开启或继续对话的 command",
                        "program": "执行程序的 command",
                        "plan": "创建 / 更新 plan_window 的 command（root.plan）",
                        "todo": "创建待办窗口的 command",
                        "end": "结束当前 thread 的 command",
                        "open_file": "把文件载入 Context 的 command",
                        "open_knowledge": "把知识文档载入 Context 的 command",
                        "write_file": "写入文件的 command",
                        "glob": "按路径模式查找文件的 command",
                        "grep": "按内容正则查找文件的 command",
                        "metaprog": "开元编程 worktree 沙箱自改自身 stone 的 command",
                        "open_feishu_chat": "把飞书群会话载入 Context 的 command",
                        "open_feishu_doc": "把飞书文档载入 Context 的 command",
                        "refine / submit": "command_exec window 上注册的两条命令；用 exec(form_id, ...) 触发",
                        "do_window.move": "do_window 上注册的命令；通过本 do_window 把 ContextWindow 以 ref / move 模式分享给对端 thread；归还路径按 id 自动识别 lent_out ↔ owner 配对",
                    },
                    patches: {
                        "command_path_activation": {
                            title: "Command Path 驱动知识激活",
                            content: `
                            command path 是一种渐进式语义披露机制。

                            例:
                            - exec(command="talk") 时，只激活 talk 基础知识。
                            - refine({ context: "continue" }) 后，激活 talk.continue 知识。
                            - refine({ type: "relation_update" }) 后，再激活 talk.relation_update 知识。

                            这样 LLM 只有在真正进入某条行动路径时，才看到该路径的完整操作说明。
                            `,
                        },
                        "do_window_move": {
                            title: "do_window.move - 跨 thread 共享 ContextWindow 的统一通道",
                            content: `
                            do_window 上注册的 \`move\` 命令，是父子双向传递 ContextWindow（ref / move 两种模式）的唯一机制；
                            形态为 \`exec(window_id=<do_window_id>, command="move", args={ window_id: <target>, mode: "ref" | "move" })\`。
                            root.do.share_windows 是其语法糖（创建 do_window 后顺序调 move，一次性带走多个 windows）。

                            完整的 ref / move / 归还语义、多层嵌套、自动归还、id 配对协议、可分享 window 类型，
                            详见 collaborable.patches.cross_thread_window_sharing（与 executable.context_window.children.sharing）。
                            `,
                        },
                    },
                },
                "permission": {
                    title: "permission - command 级三档准入控制",
                    content: `
                    OOC 元编程闭环让 Agent 可以改自己的 server / self / 文件系统;
                    每条 command 必须有"该不该让 LLM 直接执行"的三档判定。
                    按 OOC 本性,
                    permission 是 CommandTableEntry 上的一个声明字段, 与 description / params / knowledge
                    / fn 同层级, runtime 在 thinkloop 分派 tool call 之前查询。

                    三档语义:
                    - **Allow** (默认): 无人工介入直接执行。适合纯读 / 控制流 (open_file, glob, grep, compress, close, wait, plan, end)。
                    - **Ask**: 触发 PauseChecker, thread 进 paused 状态, 等待人工 approve/reject。适合写副作用 (write_file, relation_update, program, super flow 改 self.md)。
                    - **Deny**: 系统直接拒绝, 在 events 流写一条 function_call_output, 让 LLM 看见原因。适合"永远不该让 LLM 直接干"的事 (本轮: 程序自改 server/index.ts; 未来 plan mode 通过后再放开)。

                    声明 + 配置 = 最终决定:
                    - **声明**: CommandTableEntry.permission 字段, 由 command 作者填写。
                    - **配置**: stones/<self>/objects/<id>/config/policies.json 可 override 任意 command 的 permission (用户/Supervisor 微调)。
                    - **runtime 决定**: policies.json 优先, 否则用 CommandTableEntry 声明; 都没填默认 Allow (向后兼容)。

                    设计原则:
                    - **可见性**: 三档决策每一种都至少落一条 ProcessEvent (permission_allowed 不必落, allow 是默认; permission_ask / permission_denied 必须落)。
                    - **可恢复**: Ask 暂停后, approve 必须能让 thread 恢复并真正执行原 tool call (不是"批准了但没执行")。
                    - **Deny 信息流**: 拒绝必须写 function_call_output, 让 LLM 看见原因; 不能让 LLM "以为成功"。
                    - **演化 PauseChecker, 不替换**: 旧 setPauseChecker (thread => bool) 全局开关保留向后兼容; 新 setPermissionDecider (thread, call) => Decision 是细粒度入口, thinkloop 优先用 decider, 没注入则 fallback 到默认 policy 表 + PauseChecker。

                    完整 design (含分阶段实施 + command 默认 policy 表 + 风险清单) 见
                    docs/2026-05-25-permission-model-design.md。

                    与 agent-native parity 的关系: Ask 档的 approve/reject 当前是纯**人类面**（控制面 HITL）。
                    按 root.patches.agent_native_parity，它的 **agent 面**（如 Supervisor / parent 作为 agent
                    审批 children 的高赌注 command，呼应 root.patches.object_relations 的 cross-object PR review）是
                    演化方向，当前尚未实现——属 parity 公理下的显式缺口。
                    `,
                    named: {
                        "PermissionLevel": "\"allow\" | \"ask\" | \"deny\"",
                        "CommandTableEntry.permission": "command 的声明字段; 缺省 allow",
                        "policies.json": "stones/<self>/objects/<id>/config/policies.json; runtime 覆盖声明",
                        "PermissionDecider": "(thread, call) => Decision | Promise<Decision>; 通过 setPermissionDecider 注入",
                        "permission_denied / permission_ask": "ProcessEvent type; 落盘 + visibility-first",
                    },
                    patches: {
                        "thinkloop_integration": {
                            title: "thinkloop 接入点 - 在 dispatchToolCall 之前查权限",
                            content: `
                            thinkloop 协议 (src/thinkable/thinkloop.ts) 在第 6 步分派 tool call 之前
                            插入 decidePermission 查询:
                            1. 记录 reasoning / text / function_call 到 thread.events。
                            2. 走老的 isPausing (向后兼容路径)。
                            3. 对每个 pending tool call: decidePermission(thread, call) →
                               - allow: 继续 dispatchToolCall;
                               - ask: 写 permission_ask ProcessEvent + thread.status="paused" + return (与现有 pause 时序一致);
                               - deny: 写 permission_denied ProcessEvent + 合成 function_call_output ("denied: <reason>") + 跳过分派, 让下一轮 LLM 看到。
                            4. 没注入 PermissionDecider 时, 默认 policy 表生效 (CommandTableEntry.permission || allow)。

                            这种顺序复用了现有 pause 的"安全暂停点"——assistant output 已记录可被人查看, tool call 还没执行。
                            `,
                            named: {
                                "decidePermission": "thinkloop 调用的查询函数; 内部走 policies.json + CommandTableEntry + Decider",
                                "permission_ask 时序": "与现有 pause 复用; thread.status='paused' 后等控制面 approve/reject",
                            },
                        },
                        "approve_reject_path": {
                            title: "approve / reject 路径 - 控制面的 HITL 入口",
                            content: `
                            当 thread.status="paused" 因 permission_ask 触发时, 控制面 (Web UI / CLI) 可以:
                            - **approve**: 标记对应 permission_ask event 为 approved, thread 回 running,
                              下一轮重新走该 tool call (这次 decider 返回 allow)。
                            - **reject**: 同 deny 路径——写 permission_denied (reason="user-rejected"), 合成
                              function_call_output, 让 LLM 看见。

                            HTTP API: POST /api/threads/<id>/permission { eventId, action: "approve"|"reject", reason? }
                            (具体路径与现有 runtime 控制面接口风格一致, 由 AgentOfVisible 实施期决定)。
                            `,
                        },
                        "command_default_table": {
                            title: "command 默认 permission 表 (草案)",
                            content: `
                            allow (纯读 / 控制流):
                            - open_file / glob / grep / open_knowledge
                            - compress / expand / close / wait / end
                            - plan / todo.*
                            - do (fork 子线程; 子线程的 root command 各自 gate)
                            - talk / talk_window.say (协作主线; 内部副作用 command 自有 gate)

                            ask (写副作用):
                            - write_file
                            - relation_update
                            - program (shell) / program (ts/js)
                            - super flow 中改 self.md / readme.md
                            - delete_* 任何删除类

                            deny (本轮硬拦):
                            - 程序自改 stones/<self>/server/index.ts (元编程闭环未成熟前)

                            这是 design 草案; 具体 command 名以仓库实际注册为准, 实施期 (Q0d) 校准。
                            未在表中的 command 默认 allow。
                            `,
                        },
                        "invariants": {
                            title: "不变量 - permission 协议硬约束",
                            content: `
                            1. 向后兼容: 未声明 permission 的 command 默认 allow; 旧 setPauseChecker 保留。
                            2. 可见性: ask / deny 必落 ProcessEvent; allow 不必 (是默认)。
                            3. 可恢复: approve 后 thread 必须真正执行原 tool call (不是"批准了但跳过")。
                            4. Deny 信息流: 必写 function_call_output, 让 LLM 看见拒绝原因。
                            5. 配置错误容错: policies.json 缺失 / JSON 错 / 字段拼错 → fallback 到声明默认, 不抛崩溃。
                            6. silent-swallow ban: permission 决策不允许静默; 与 observable.silent-swallow ban 一致。
                            `,
                        },
                    },
                    sources: [["docs/2026-05-25-permission-model-design.md", "完整 design (含 Q0a~Q0d 分阶段 + 默认 policy 草案 + 风险清单 + Supervisor 拍板记录)"]],
                    todo: [
                        "Q0e 抽专用 program_self_modify command 或在 write_file exec 中加路径前缀检查 (stones/*/server/index.ts → deny); Plan Mode 落地前保持 deny",
                        "Q0e Stone 作者的 permission 声明传递: programmable.loader 把 ObjectWindowDefinition.commands[*].permission 透传到 CommandTableEntry (custom window proxy 当前一律缺省 allow, 由 stone 作者自行声明)",
                        "远景: Auto Mode (AI 分类器) / Plan Mode (LLM plan + user approve) / OS-level Sandbox 集成——本轮全部不做",
                    ],
                    warnings: [
                        "Q0d 截止 2026-05-25 状态: 6 项 command 已填 ask (write_file / root.program / program_window.exec / file_window.edit / relation.edit / metaprog); deny 0 项 (列 Q0e); 其余 command 缺省 allow",
                        "自改 stones/<self>/server/index.ts 当前**没有硬拦** — 通过 metaprog 整族 ask + write_file ask 形成弱约束; Q0e 需补硬 deny",
                    ],
                },
                "context_window": {
                    title: "ContextWindow - Context 中可操作的信息单元",
                    content: `
                    ContextWindow 是 thread 持有的上下文单元。

                    它既是信息展示单元，也是行动挂载点。
                    一个 window 可以被渲染进 Context，让 LLM 看见；也可以注册自己的 command，让 LLM 对它继续操作。

                    所有 ContextWindow 至少具有以下语义字段:
                    - id: window 的唯一标识。
                    - type: window 类型，如 root / file / talk / program。
                    - title: 给 LLM 和人类看的标题。
                    - status: 当前状态，具体枚举由 window type 决定。
                    - parentWindowId: 父窗口 id，用于形成窗口树。
                    - createdAt: 创建时间，用于观察和调试。

                    ContextWindow 的设计意义:
                    1. 统一 Context 中的可见实体: 文件、知识、搜索结果、对话、子线程、程序执行都可以是 window。
                    2. 统一 LLM 的操作对象: LLM 不直接改 thread 字段，而是 open/close/refine/submit 某个 window。
                    3. 统一渲染和生命周期: 每种 window type 自己定义如何展示、如何关闭、有哪些 command。
                    `,
                    named: {
                        "id": "ContextWindow 的唯一标识",
                        "type": "ContextWindow 的类型分支",
                        "status": "ContextWindow 的状态，具体语义由 type 决定",
                        "parentWindowId": "父窗口 id，用于表达窗口树关系",
                        "render": "把 window 转换为 LLM 可读 Context 的过程",
                    },
                    children: {
                        "command_exec_window": {
                            title: "command_exec window - 一次行动调用的表单窗口",
                            content: `
                            command_exec window 是 LLM 调用 command 时产生的临时窗口。

                            它类似一个 form。**四态状态机**（open / executing / success / failed）：

                            \`\`\`
                            open → executing → success  (自动从 contextWindows 移除)
                                            ↘ failed   (保留 + result 含错; 可 refine 回 open 重 submit)
                            \`\`\`

                            状态语义:
                            - **open**: 参数未提交。可 refine 累积 args, submit 触发执行
                            - **executing**: exec 函数运行中。短暂状态; LLM 不应在此态做动作
                            - **success**: 执行成功; **自动从 contextWindows 移除**, 下一轮 LLM 看不到这个 form
                            - **failed**: 执行失败; result 含错误信息;
                              **可以 refine 修回 open 状态再 submit** (refine 时累积新 args + 清旧 result + 切回 open)

                            command_exec window 让 "函数调用" 不再是一次性黑盒。
                            LLM 可以看见自己正在填写什么参数、还缺什么、激活了哪些知识、执行结果是什么。

                            **失败修复路径**：
                            - submit 失败 (form 进 failed) → refine 修正 args → 自动切回 open → 重 submit
                            - 不再需要 close + 重 open (那会丢失 form 已累积 args 与已激活 knowledge)
                            - close 仍可用作 "彻底放弃这次调用" 的兜底, 但不是失败修复首选

                            **历史 thread.json 含 status="executed" 的 form**: readThread 反序列化时
                            把 "executed" 迁移为 "failed" (保守; 让 LLM 能 refine 修复)。

                            完整 design 见 docs/2026-05-27-form-status-success-failed-design.md。
                            `,
                            named: {
                                "open": "form 初始态; 可 refine / submit",
                                "executing": "exec 函数运行中; 短暂状态",
                                "success": "执行成功; 自动从 contextWindows 移除",
                                "failed": "执行失败; result 含错; 可 refine 回 open 重 submit",
                                "refine-from-failed": "failed 状态可调 refine, 累积 args + 清 result + 状态切回 open",
                                "executed → failed 迁移": "readThread 反序列化时把历史 executed 转 failed, 保留 LLM 修复能力",
                            },
                        },
                        "sharing": {
                            title: "sharing - 跨 thread 共享 ContextWindow",
                            content: `
                            BaseContextWindow 的可选字段 \`sharing: SharingState\` 表达"这个 window 当前
                            的所有权与可见性状态"。缺省 = owner-live（当前 thread 独占持有，可正常操作）。

                            两种 sharing kind（plan §do_window.move）:

                            - **kind="ref"**：当前 thread 持有的是只读引用；snapshot 是分享时刻的 freeze。
                              真 owner 在 ownerThreadId 所在 thread 那边继续 live；之后 owner 改动不会同步。
                              ref 上不能 exec 任何命令（仅可 close 释放本地引用）。
                            - **kind="lent_out"**：当前 thread 曾是 owner，已把 owner 移交给 borrowerThreadId。
                              自己看到的是分享时刻的 snapshot，临时只读；borrower thread 结束/归还时自动恢复 live。
                              lent_out 上所有命令（含 close）都被拒绝。

                            **id 协议**：window 跨 thread move 时 id 严格保持不变；按 id 配对识别 lent_out ↔ owner，
                            实现归还路径自动识别（borrower 用 do_window.move 把 window 还回原 owner，对端按 id 找
                            自己的 lent_out 占位 → 视为归还）。

                            **持久化**：sharing.snapshot 是嵌套 ContextWindow，JSON-safe，自然落 thread.json。

                            **render**：sharing 状态的 window 用 snapshot 内容渲染，title 加前缀
                            \`[ref → owner@thread:X]\` / \`[已借给 thread:Y]\`，并标 \`read_only="true"\` 属性。
                            `,
                            named: {
                                "SharingState": "BaseContextWindow.sharing 的联合类型；kind=ref|lent_out",
                                "snapshot": "分享时刻的 ContextWindow freeze 副本（不带 sharing 字段）",
                                "id 协议": "跨 thread move 保留同一 id；用于归还路径自动识别 lent_out ↔ owner 配对",
                            },
                        },
                        "render_dispatch": {
                            title: "render dispatch - window type-dispatch 接口契约",
                            content: `
                            **设计原则**：context XML 的渲染采用 "接口 explicit" 契约：每个 window type
                            必须在 \`WindowTypeDefinition.renderXml\` 上注册自己的渲染 hook；render.ts 退化为
                            纯调度器，不再 switch-by-case。

                            **调度器职责**（src/thinkable/context/render.ts）：
                            - 通用外壳：\`<window id type status [sharing read_only]>\` + \`<title>\`
                            - 调度到 \`def.renderXml(ctx)\` 取 type-specific 子节点（XmlNode[]）
                            - 通用尾部：每个 window 末尾输出 \`<commands hint="...">\` 节点（列出该 type 注册的
                              command 名 + 调用形态），让 LLM 直接看到当前 window 上可调命令，无需翻 knowledge 猜
                            - 子 window 折叠（按 parentWindowId 嵌套到 \`<sub_windows>\`）

                            **启动期 fail-loud**：windows/index.ts 在所有 side-effect import 完成后调用
                            \`assertAllRenderHooksRegistered()\`，缺 renderXml 的 type 立即抛错——不让"空白 XML"
                            的问题流到 LLM context 才被发现。
                            `,
                            named: {
                                "WindowTypeDefinition.renderXml": "RenderHook 类型 (ctx) => XmlNode[] | Promise<XmlNode[]>，注册到 WindowRegistry",
                                "调度器": "src/thinkable/context/render.ts:renderWindowNode；无 switch，按 def.renderXml 调度",
                                "<commands> 节点": "通用层为每个 window 输出的命令面索引；空 commands 表的 window 跳过该节点",
                                "assertAllRenderHooksRegistered": "src/executable/windows/_shared/registry.ts；启动期校验所有 type 已配齐 renderXml",
                            },
                            sources: [["src/thinkable/context/render.ts", "调度器实现 + commands 元数据节点；接口契约（缺 hook 抛错）"]],
                        },
                        "skill_index_window": {
                            title: "skill_index window - stone skills 索引",
                            content: `
                            skill_index 是 LLM 看到的 stone skills 公共与私有索引（plan §skills 支持）。
                            每个 skill 是一个独立目录，含 \`SKILL.md\`（带 frontmatter description）+ 任意辅助文件。

                            **双层 skills 目录**（plan §D1）:
                            - **branch 级**（公共，跨 Object 共享）：\`stones/<branch>/skills/<skill-name>/SKILL.md\`
                            - **object 级**（仅 self）：\`stones/<branch>/objects/<self>/skills/<skill-name>/SKILL.md\`
                            - 同名 skill 时 object 级优先；展示时 scope 徽标区分来源

                            **生成方式**（plan §D2 + 用户补充）:
                            - 完全由 \`thinkable/knowledge/synthesizer.ts:collectExecutableKnowledgeEntries\` 派生
                            - 每轮渲染时调用 \`persistable/stone-skills.ts:listBranchSkills\` + \`listObjectSkills\`
                            - 内部 10s TTL 缓存，避免 readdir + readFile 在每轮 thread render 都跑
                            - **空时不注入**：如果两层目录都没有 skill，skill_index 不出现在 contextWindows 里
                            - 不持久化（thread.json 中不出现）；reload 后由 synthesizer 重新派生

                            **使用协议**：LLM 通过 \`exec(command="open_file", args={ path: "<skillFilePath>" })\` 打开
                            具体 SKILL.md 阅读完整说明；OOC 不实现 SKILL.md 内的字段（user-invocable / allowed-tools 等）；
                            那些字段是 SKILL.md 自由约定，由 LLM 自行处理。

                            不注册任何 command；onClose 拒绝（与 root 同级，理论不会被 close）。
                            `,
                            named: {
                                "SkillEntry": "{ name, description, skillFilePath, scope: \"branch\" | \"object\" }",
                                "SkillIndexWindow": "type=\"skill_index\"，固定 id \"skill_index\"，单例每 thread 一个；status=\"active\"",
                                "stones/<branch>/skills/": "branch 级公共 skills 目录",
                                "stones/<branch>/objects/<self>/skills/": "object 级私有 skills 目录",
                                "10s TTL 缓存": "stone-skills.ts 模块级缓存；skills 改动 ≤10s 后才反映",
                            },
                            sources: [["src/persistable/stone-skills.ts", "skills 目录扫描器与 10s 缓存；listBranchSkills / listObjectSkills；clearStoneSkillsCache 测试钩子。SkillIndexWindow 派生在 src/thinkable/knowledge/synthesizer.ts:collectExecutableKnowledgeEntries §1.6"]],
                        },
                        "plan_window": {
                            title: "plan_window - 行动计划窗口（支持 sub plan + share to sub thread）",
                            content: `
                            plan_window 是 thread 的行动计划窗口，由 root.plan command 创建。
                            plan 升格为 first-class ContextWindow（不再是 thread.plan 字符串字段；详见 patches.thread_plan_deprecated）。

                            **数据形态**（src/executable/windows/plan/types.ts）:
                            \`\`\`
                            type PlanWindowStep = {
                              id: string;                  // plan 树内唯一稳定 id
                              text: string;                // 步骤描述
                              status: "pending" | "in-progress" | "done" | "blocked";
                              subPlanWindowId?: string;    // 若该 step 展开为 sub plan，指向 child plan_window.id
                            }
                            type PlanWindow = BaseContextWindow & {
                              type: "plan";
                              title: string;
                              description?: string;
                              steps: PlanWindowStep[];
                              parentPlanWindowId?: string; // 父 plan_window.id（root plan 无此字段）
                              parentStepId?: string;       // 父 plan 中哪个 step 把当前 plan 作为 sub
                              status: "active" | "done" | "archived";
                            }
                            \`\`\`

                            **commands**（注册到 plan_window）:
                            - update_plan: 更新 title / description
                            - add_step: 在 steps 末尾追加一个 step
                            - update_step: 修改某 step 的 text / status
                            - expand_step: 把某 step 展开为 sub plan_window（创建 child plan_window + 写回 subPlanWindowId）
                            - collapse_subplan: 反向; archive sub plan_window + 清 subPlanWindowId
                            - mark_done: plan_window status → "done"
                            - close: 关闭 plan_window（cascade close 所有 sub plan）

                            **sub plan 嵌套**:
                            - sub plan_window 由 expand_step 自动创建，挂在父 plan 的某 step 上
                            - 父子链由 parentPlanWindowId + parentStepId 维护（单向引用）
                            - 嵌套深度无硬限制，但 renderXml 默认不内联渲染 sub plan（避免无限嵌套），LLM 通过 subPlanWindowId 单独 open

                            **跨 thread sharing**（与 do_window.move 同协议）:
                            - 父 thread 通过 \`exec(command="do", args={ task, share_windows: ["plan-window-abc"] })\` 派生子 thread
                            - 复用现有 sharing kind="ref" / "lent_out"（meta/object.doc.ts:executable.context_window.children.sharing）
                            - **ref 模式**: 子 thread 只读看父 plan（不能 exec 命令），适合"子看父 plan 但不改"
                            - **move 模式**: 子拿 owner，父变 lent_out（临时只读）；子可 update_step + expand_step；do_window archive 时自动归还
                            - **进度回流**: move 模式自动归还时父收到子改动后的最新 plan；ref 模式靠子用 talk 报告再让父自己 update_step

                            **renderXml**（与 file / talk / do 同协议）:
                            - level 0 (live): <plan_window id status><title/><description/><steps count><step id status sub_plan_window_id?/>...</steps><commands/></plan_window>
                            - level 1 (folded): title + status + step count + done/total 比例
                            - level 2 (snapshot): title + status

                            **可被 share**: 是（在 executable.context_window.children.sharing 的可分享 type 列表里）。

                            **持久化**: 走标准 ContextWindow 持久化（thread.json 内）；不单独 plan-file。
                            完整设计见 docs/2026-05-26-remove-issue-add-subplan-design.md §3。
                            `,
                            named: {
                                "PlanWindowStep": "plan 内单个 step；含 id / text / status / subPlanWindowId?",
                                "expand_step": "把某 step 展开为 child plan_window 的 command；写回 subPlanWindowId",
                                "share_to_sub_thread": "通过 do.share_windows 把 plan_window 以 ref/move 模式传给子 thread；归还后父见到进度",
                            },
                            sources: [["src/executable/windows/plan/", "plan_window 实现；renderXml / commands / compressView 与 file/talk/do 同协议"]],
                        },
                    },
                    patches: {
                        "cascade_close": {
                            title: "关闭 window 时需要考虑子窗口",
                            content: `
                            因为 ContextWindow 通过 parentWindowId 形成窗口树，关闭一个父窗口时通常需要处理其子窗口。

                            是否允许关闭、是否级联关闭、关闭时是否需要释放资源，由该 window type 的 onClose hook 决定。
                            `,
                        },
                        "viewport_protocol": {
                            title: "viewport - 精细化控制单 window 渲染体量",
                            content: `
                            每个有"长内容"的 window type 都应提供 \`viewport\` 字段（行+列范围）让 LLM 精细控制
                            渲染给自己的内容量。viewport 与 thinkable.context_budget 的 compressLevel 同层但正交：
                            compressLevel 由系统/LLM 在整个 window 之间做"宏观压缩"；viewport 由 LLM 在单个
                            window 内部做"微观节流"。

                            **当前已实施**（file_window / knowledge_window）：

                            \`viewport: { lineStart, lineEnd, columnStart, columnEnd }\` — open 时默认
                            **0-200 / 0-200**（前 200 行 × 每行前 200 字符）。LLM 通过 \`set_viewport\` 命令
                            调整：

                            \`\`\`
                            exec(window_id="<id>", command="set_viewport",
                                 args={ line_end: 1000 })            # 看前 1000 行
                            exec(..., args={ line_start: 200, line_end: 400 })  # 看 200-400 行
                            exec(..., args={ column_end: 500 })       # 行宽扩到 500 字符
                            \`\`\`

                            未传字段保留当前值（partial merge）。约束 fail-loud：非负整数 / line_start ≤ line_end / column_start ≤ column_end。

                            **渲染溢出标记**：
                            - 行数超 lineEnd → 末尾追加 \`…(+N more lines)\`
                            - 行长超 columnEnd → 行尾 \`…(+N more)\`
                            - columnStart > 0 时行首 \`(+N before)…\`

                            **viewport vs edit**：viewport 仅影响**渲染**给 LLM 的内容；
                            \`file_window.edit\` 的 old/new 匹配仍按文件完整内容——不需要先扩 viewport 才能精确替换。

                            **共享实现**：src/executable/windows/_shared/viewport.ts 提供 DEFAULT_VIEWPORT /
                            mergeViewport / applyViewport / executeWindowSetViewport（被 file + knowledge 共用）。

                            **其它 window type 的信息量轴设计提案**（**未实施**，仅作 design proposal；
                            后续按需逐个落地）：

                            - **talk_window / do_window**：transcript message range（最近 N 条 / idx 区间）→ 推荐
                              \`set_transcript_window\` command，args = { messages_tail?: N, messages_range?: [i, j] }；
                              默认 tail=20 条
                            - **search_window**：matches 区间 → \`set_results_window\` args = { matches_start, matches_end }；
                              默认 0-50
                            - **program_window**：exec 历史区间 → \`set_history_window\` args = { history_tail?: N }；
                              默认 tail=10
                            - **plan_window**：展开深度 / 当前 step 高亮 → \`focus_step\` (step_id) + \`set_depth\` (max_depth)；
                              默认全展开
                            - **relation_window**：sections 选择（peer_readme 收起 / self_long_term 展开）→
                              \`set_sections\` args = { peer_readme: "full"|"summary"|"hidden", self_long_term: ... }
                            - **command_exec window**：args 显示（高频 refine 时多冗余）→ \`set_args_display\`
                              args = { mode: "full"|"summary" }
                            - **custom window**：交由 stone 作者决定（programmable 维度），不强加协议

                            **设计原则**：viewport-like 协议是"LLM 主动节流"的精细补充，与
                            thinkable.context_budget.patches.natural_decay（系统被动衰减）一起组成完整的
                            上下文体量治理。

                            **取舍记录**：
                            - column 截断按**字符**（非 grapheme cluster / 非 markdown 语义）— markdown 表格 / 代码块
                              超 columnEnd 会被截尾；LLM 看到 \`…(+N more)\` 自然知道扩窗。可接受的初版近似。
                            - 默认 200/200 偏保守——LLM 看一个长函数（>200 行）需显式 set_viewport，是有意为之
                              （强制 LLM 表态"我要看这么多"，避免悄悄塞满 context）。
                            `,
                            named: {
                                "viewport": "{ lineStart, lineEnd, columnStart, columnEnd } — 单 window 的渲染窗口大小",
                                "DEFAULT_VIEWPORT": "0-200 / 0-200；open 时填默认；可通过 set_viewport 调整",
                                "set_viewport": "file_window / knowledge_window 上的命令；partial merge + fail-loud",
                                "overflow marker": "行数 / 列长超限时的标记字符串，让 LLM 知道窗口外还有内容",
                            },
                            sources: [["src/executable/windows/_shared/viewport.ts", "viewport 协议共享实现（types + helpers + exec 入口）"]],
                            todo: [
                                "其它 window type（talk/do/search/program/plan/relation/command_exec）的信息量轴尚未实施",
                                "viewport 默认值是否对'看长函数'场景过紧——待 AgentOfExperience 真实体验后回调",
                            ],
                        },
                    },
                },
                "window_types": {
                    title: "window types - 内置 ContextWindow 类型",
                    content: `
                    OOC 内置多种 ContextWindow type。

                    这些 type 不是 UI 组件分类，而是 LLM 的上下文对象分类（共 14 种，与 src/executable/windows/_shared/types.ts WindowType 联合一致）:
                    - root: 每个 thread 隐含存在的根 window，注册顶层 command。
                    - command_exec: 一次 command 调用的临时 form window。
                    - do: 子 thread 的父侧窗口，展示子任务状态与 transcript。
                    - talk: 与 user 或其他 Object 的持续会话窗口。
                    - todo: 可见待办窗口。
                    - program: 程序执行窗口，可多次 exec。
                    - file: 文件内容窗口，支持 viewport / set_viewport / set_range（遗留）/ reload / edit / close。
                    - knowledge: 知识文档窗口，承载显式打开或协议合成的 knowledge；explicit 来源支持 viewport / set_viewport。
                    - search: glob / grep 搜索结果窗口，支持 open_match。
                    - relation: 跨 Object 关系窗口；含 peer stone readme 只读 + self-relation 双层（见 children.relation_window）。
                    - skill_index: stone skills 索引窗口；每轮由 synthesizer 派生。
                    - custom: Object 自定义窗口（server/index.ts \`export const window\` 注册的 self window）。
                    - feishu_chat: 飞书群会话窗口。
                    - feishu_doc: 飞书文档窗口。
                    - plan: 行动计划窗口；支持 sub plan 嵌套 + 通过 do.share_windows 共享给子 thread (见 B 段设计)。

                    每个 window type 都应该回答四个问题:
                    1. 它在 Context 中如何渲染给 LLM？
                    2. 它支持哪些 command？
                    3. 它何时可以 close，close 时有什么副作用？
                    4. 它需要向 LLM 注入什么 basicKnowledge？
                    `,
                    named: {
                        "root": "thread 的隐含根窗口，提供顶层 command",
                        "command_exec": "一次 command 调用的临时窗口",
                        "do_window": "父 thread 观察和继续子 thread 的窗口；注册 continue/wait/close/move 命令；archive 时自动归还所有 borrowed owner windows（plan §do_window.move）",
                        "talk_window": "与 user 或其他 Object 对话的窗口",
                        "todo_window": "可见待办窗口",
                        "program_window": "程序执行窗口",
                        "file_window": "文件内容窗口；含 viewport 字段（行+列范围）精细控制渲染体量；详见 patches.viewport_protocol",
                        "knowledge_window": "知识文档窗口；explicit 来源支持 viewport 同 file_window",
                        "search_window": "搜索结果窗口",
                        "plan_window": "行动计划窗口；可嵌套 sub plan; 复用 do_window.move sharing 协议共享给 sub thread",
                        "skill_index_window": "stone skills 索引窗口；每轮由 synthesizer 派生（10s TTL 缓存），列出 stones/<branch>/skills 与 stones/<branch>/objects/<self>/skills 下的所有 SKILL.md；空时不注入；详见 children.skill_index_window",
                    },
                },
                "registry_and_manager": {
                    title: "WindowRegistry / WindowManager - window 行为注册与管理",
                    content: `
                    WindowRegistry 和 WindowManager 是 ContextWindow 体系的运行时支撑。

                    WindowRegistry 负责注册每种 window type 的行为:
                    - commands: 这个 window 上能调用哪些 command。
                    - renderXml: 这个 window 如何渲染进 Context。
                    - onClose: 关闭这个 window 时如何处理资源和约束。
                    - basicKnowledge: 这个 window 出现时要注入哪些基础说明。

                    WindowManager 负责管理某个 thread 的 contextWindows:
                    - 插入 window。
                    - 查找 window。
                    - 更新 window。
                    - 关闭 window。
                    - 根据 parentWindowId 维护窗口树关系。

                    这两个机制让系统可以继续扩展新的 window type，而不需要把所有行为写死在一个巨大 switch 里。
                    `,
                    named: {
                        "WindowRegistry": "注册 window type 行为的中心",
                        "WindowManager": "管理 thread.contextWindows 生命周期的组件",
                        "renderXml": "window 渲染为 Context XML 的函数",
                        "onClose": "window 关闭时执行的生命周期 hook",
                        "basicKnowledge": "某个 window type 出现时自动注入给 LLM 的基础知识",
                    },
                },
                "knowledge_activation": {
                    title: "knowledge activation - 行动过程中的知识激活",
                    content: `
                    Executable 与 Knowledge 的连接点是 knowledge activation。

                    当 LLM 打开 command_exec window 时，对应的 \`command::<window_type>::<command>\`
                    trigger 进入命中状态；当任何 type 的 window 处于 open 时，对应的
                    \`window::<type>\` trigger 持续命中。

                    激活出来的 knowledge 会进入 Context，指导 LLM 如何继续填写参数或执行动作。

                    这形成一个闭环:
                    1. LLM open 一个 command。
                    2. 系统展示该 command 的基础知识（command trigger 命中）。
                    3. LLM refine 参数。
                    4. 系统逐条 evaluate 各篇 knowledge 的 trigger map，max 出最终激活级别。
                    5. LLM submit 执行。

                    这个闭环让 OOC 可以把复杂能力拆成多步披露，而不是在一开始把所有说明都塞给 LLM。

                    **activator trigger 求值**（2026-05-28 起；详见 src/thinkable/knowledge/triggers.ts）：

                    src/thinkable/knowledge/activator.ts:computeActivations 对每篇 knowledge：
                    1. 逐条解析 frontmatter.activates_on 的 trigger key
                    2. 对每个 trigger 调 \`evaluateTrigger(trigger, thread)\` 求值
                    3. 把命中 entries 的 level 取 max（show_content > show_description）作为该篇激活级别

                    三类 trigger：
                    - \`"window::<type>"\` — \`thread.contextWindows\` 含 status="open" 且 type === <type> 的 window 时命中。
                      root window 每个 thread 都有，故 \`"window::root"\` 等价"任何时候"——这是旧 \`[root]\` 的自然替代。
                    - \`"command::<window_type>::<command>"\` — \`thread.contextWindows\` 含 type="command_exec" 的 open form，
                      其 parentWindow.type === <window_type> 且 form.command === <command> 时命中。
                    - \`"super"\` — \`thread.persistence?.sessionId === SUPER_SESSION_ID\` 时命中（仅 super flow）。
                    `,
                    named: {
                        "knowledge activation": "根据 trigger map 把相关 knowledge 注入 Context 的过程",
                        "progressive disclosure": "渐进式披露，只在需要时展示更具体的信息",
                        "trigger": "activates_on 的 key 表达式；三类：window::<type> / command::<window_type>::<command> / super",
                        "evaluateTrigger": "纯函数：(trigger, thread) -> boolean；activator 内部对每篇 knowledge 多 trigger 取 max",
                    },
                },
            },
        },
        "collaborable": {
            title: "OOC Agent collaborable 概念",
            content: `
            Collaborable 描述 Object 之间如何协作。

            OOC 的协作不是"调用对方的函数"，而是"消息 + 持续会话窗口"。
            所有跨 thread / 跨 object 的影响都必须经过显式的 inbox/outbox 与窗口，
            thread 之间不共享内存。这让协作痕迹始终可观察、可回放、可 debug。

            核心组成:
            1. ThreadMessage 模型: 跨 thread 传递的最小消息单元，承载 from/to、object、window 归属与 source。
            2. do_window: 同 object 内 fork 出的子线程对话窗口；source="do"。
            3. talk_window: 跨 object 的持续会话窗口；source="talk"（LLM 发）或 "user"（控制面代用户发）。
            4. talk-delivery: 跨 object 派送的统一入口（解析 callee、必要时创建 callee thread、双写 thread.json）。
            5. creator window: 每个新 thread 启动时的"恒在通道"，指向创建方；不可 close。

            因此 collaborable 是 thinkable 和 executable 之上的协作语义层:
            thread 用消息说话，用 ContextWindow 持续维护一段对话或一个共享议题。

            在对象关系三轴（详见 root.patches.object_relations）中，collaborable 主要承载 **peer 平等轴**
            （同级 Agent 平等协作，只能 talk 说服、不能支配对方）；自我轴见 reflectable，parent-child
            层级轴见 patches.parent_child_hierarchy。
            `,
            named: {
                "Collaborable": "Object 的协作能力维度，定义 thread/object 间如何用消息与窗口协作",
                "ThreadMessage": "跨 thread 的最小消息单元，记录 from/to、object、window 归属与 source",
                "inbox / outbox": "thread 接收 / 发出消息的列表，是跨 thread 影响的唯一通道",
                "do_window": "同 object 内 fork 子线程的对话窗口",
                "talk_window": "跨 object 持续会话窗口",
                "talk-delivery": "跨 object 派送消息的统一入口",
                "creator window": "thread 启动时指向创建方的恒在窗口",
            },
            children: {
                "messages": {
                    title: "messages - ThreadMessage 模型",
                    content: `
                    ThreadMessage 是跨 thread 协作的最小单元（src/thinkable/context/index.ts ThreadMessage）。

                    关键字段:
                    - id: 消息 id，由创建方生成；caller / callee 双方记录同一个 id 便于跨 thread 关联。
                    - fromThreadId / toThreadId: 发送方与接收方 thread id。
                    - fromObjectId: 发送方所属 flow object id；跨 object talk 时由 talk-delivery 写入，便于 UI 标注发送方身份。
                    - content: 消息正文。
                    - createdAt: 创建时间戳（不承担强一致时钟语义）。
                    - source: 消息来源，"do" / "talk" / "user" / "system"。
                    - windowId: 消息归属的 window id；talk_window.say 时设为该 talk_window 的 id。
                    - replyToWindowId: 消息回复到哪个 window；render 层据此把消息归入对应 talk_window 的 transcript。

                    消息进入 callee.inbox 时，系统同时 push 一条 \`context_change / inbox_message_arrived\` ProcessEvent，
                    让 LLM 看到"新消息到达"这件事而不是只看到一条无来由的 inbox 项。

                    caller / callee 共享同一 messageId，但各自视图下 windowId 可能不同:
                    - caller 视图: windowId = caller talk_window.id（自己的发件箱）。
                    - callee 视图: replyToWindowId = callee 侧对应的 talk_window.id（参见 resolveCalleeReplyToWindowId）。
                    `,
                    named: {
                        "id": "消息 id；caller/callee 双方共享同一个值",
                        "source": "消息来源枚举: do / talk / user / system",
                        "windowId": "消息归属的窗口 id（发件方视角）",
                        "replyToWindowId": "消息回复到的窗口 id（收件方视角）",
                        "inbox_message_arrived": "context_change 类的 ProcessEvent，告诉 LLM 新消息到达",
                    },
                },
                "do_vs_talk": {
                    title: "do vs talk - 同 object fork vs 跨 object 会话",
                    content: `
                    do_window 与 talk_window 长得像，但语义不同。判定规则在 src/executable/windows/_shared/init.ts isCreatorSelf:
                    - thread.creatorObjectId === thread.persistence?.objectId（含两者都缺省）→ 创建关系是 "do"，
                      由同一个 Object 内部 fork 出来；creator window 是 do_window。
                    - thread.creatorObjectId 与 self 不同 → 创建关系是 "talk"，是跨 object 派生的 callee thread；
                      creator window 是 talk_window，target 指向 caller object。

                    do_window:
                    - 由 root.do command 派生子 thread 时创建。
                    - 注册的 command: continue（向子线程追加消息）/ wait / close。
                    - 消息 source = "do"。
                    - close 时把子线程切到 archived（initial creator do_window 拒绝 close）。

                    talk_window:
                    - 由 root.talk command 创建，target 是对端 flow object id（"user" 也是一个 flow object）。
                    - 注册的 command: say / wait / close。
                    - 消息 source = "talk"（LLM 发）或 "user"（控制面代用户发）。
                    - 同一对端复用同一 talk_window，不要每发一条消息就 close 再重开。
                    - close 时不通知对端，仅释放本地窗口；initial creator talk_window 拒绝 close。
                    `,
                    named: {
                        "isCreatorSelf": "判定 thread 的 creator 是否与自己同 object 的逻辑",
                        "continue": "do_window 上向子线程追加消息的 command",
                        "say": "talk_window 上向对端发消息的 command",
                    },
                },
                "talk_delivery": {
                    title: "talk_delivery - 跨 object 派送的统一入口",
                    content: `
                    deliverTalkMessage（src/executable/windows/talk/delivery.ts）是跨 object 派送的唯一路径。
                    无论是 LLM 通过 talk_window.say 还是控制面代用户发，都汇集到这里。

                    一次派送做 6 件事:
                    1. 解析 caller 与 target: caller = ctx.thread + ctx.talkWindow；target = talkWindow.target（objectId）。
                       target === "super" 时翻译为指向自己的 super 分身（calleeObjectId = caller.objectId，calleeSessionId = "super"），见 reflectable。
                    2. 解析或创建 callee thread:
                       - 若 talkWindow.targetThreadId 已设置 → readThread。
                       - 否则 createFlowObject(callee) + 新建 thread；initContextWindows 注入指向 caller 的 creator talk_window；
                         caller talkWindow.targetThreadId 回填，让下次 say 直接命中已有 thread。
                    3. 写消息: caller.outbox 追加一条 ThreadMessage（windowId = caller talk_window.id），callee.inbox 追加同一条
                       （replyToWindowId 由 resolveCalleeReplyToWindowId 解析）；callee 同时 push inbox_message_arrived 事件。
                    4. callee 状态: waiting/done/failed → 翻回 running，等 worker 调度；paused 不动。
                    5. 持久化: caller / callee 双写 thread.json。
                    6. 状态翻转通知（根因 #5）: notifyThreadActivated(callee ref) → buildServer 注入的 jobManager.createRunThreadJob 把 callee 入队；worker 不再周期扫 fs 兜底。

                    UI 通知由控制面自己决定何时 refresh；worker 调度由本派送的 step 6 直接触发，事件驱动。
                    `,
                    named: {
                        "deliverTalkMessage": "跨 object 派送的入口函数",
                        "targetThreadId": "talk_window 持有的对端 callee thread id；首次派送时回填",
                        "resolveCalleeReplyToWindowId": "在 callee contextWindows 中解析这条入站消息归属的 talk_window id",
                    },
                    patches: {
                        "reply_window_resolution": {
                            title: "callee 侧 replyToWindowId 的解析优先级",
                            content: `
                            resolveCalleeReplyToWindowId 决定本条入站消息进入 callee 哪个 talk_window 的 transcript:
                            1. callee 的 talk_window 中 targetThreadId === callerThreadId（精确命中本条 conversation）。
                            2. callee 的 talk_window 中 target === callerObjectId（对象级 fallback）。
                            3. callee 的 creator talk_window（初次创建场景）。

                            老实现硬写为 callee 的 creator window，会把"assistant 给 critic、critic 回 assistant"这种
                            非首次会话错误地塞到 creator window 上。当前实现严格按以上优先级查找。
                            `,
                        },
                    },
                },
                "creator_window": {
                    title: "creator_window - thread 启动时的恒在通道",
                    content: `
                    每个新 thread 启动时都需要一条指向创建方的恒在窗口；由 initContextWindows 注入
                    （src/executable/windows/_shared/init.ts）。

                    类型由 thread 自身的 creatorObjectId 决定（见 do_vs_talk）:
                    - 同 object fork → creator window = type=do, targetThreadId=父 thread id, isCreatorWindow=true。
                    - 跨 object talk → creator window = type=talk, target=caller object, targetThreadId=caller thread, isCreatorWindow=true。

                    creator window 的特殊性:
                    - 稳定 id 由 creatorWindowIdOf(threadId) 派生，幂等插入（重复调用 init 不会重复创建）。
                    - isCreatorWindow=true 的窗口拒绝 close；onClose hook 会写一条 inject 提示，避免 LLM 反复尝试。
                    - 是 thread 跟创建方之间的恒在通道；callee 通过 creator talk_window.say 回复给 caller。

                    例外:
                    - user.root（objectId === "user" 且 thread.id === "root"）: 整个 session 的交互起点，没有 creator，跳过。
                    - self-driven root: 既没 opts.creatorThreadId、又没 thread.creatorThreadId、也没 thread.creatorObjectId 时，
                      不注入 phantom creator window（否则会被 wait 误判为合法 IO 来源导致死锁）。

                    **子→父 reply 协议（dogfooding 闭环关键）**：

                    子 thread 想把结果带回父 thread 时，**唯一合法通道**是在 **creator do_window / talk_window**
                    上调 \`continue\`（do_window）或 \`say\`（talk_window），写入 transcript；这条消息会自动
                    deliver 到父 thread 的 inbox。

                    **禁止依赖 \`end({result})\` 隐式回报**——end command 的 result 参数（若存在）只用于
                    auto-archive 触发器，不是 reply 通道；result 内容会被自动作为最后一条 continue 写入
                    creator window transcript（详见 root.end children/result_auto_continue）。

                    子线程 LLM 在 basicKnowledge 里看到的 creator window 段必须**显式说明**：
                    > 你的 creator window 是 \`<window_id>\`。**若想把结果 / 状态带回父线程，调
                    > \`exec(window_id="<creator_id>", command="continue", args={msg:"..."})\` 写入 transcript**。
                    > end command 只用于声明本轮自己结束，不是回报通道。

                    没有这条 prompt，子 LLM 会 hallucinate \`end({result})\` 等非协议参数，导致 result
                    被静默吞、父侧 do_window 永不 archive。
                    `,
                    named: {
                        "creatorWindowIdOf": "派生 creator window 稳定 id 的函数",
                        "isCreatorWindow": "标记某 window 为 creator window 的字段；true 时不可 close",
                        "user.root": "objectId='user' 且 thread.id='root' 的特殊 root thread，没有 creator",
                        "self-driven root": "没有 creator 信息的 root thread；不注入 phantom creator",
                        "子→父 reply 协议": "唯一通道是 creator window 上的 continue/say；end 不是回报通道",
                    },
                },
                "relation_window": {
                    title: "relation_window - peer 关系的专属 window type",
                    content: `
                    当 thread.contextWindows 中存在指向某 peer 的 talk_window 时，
                    每轮 render 时由 synthesizer 自动派生 RelationWindow，承载"你对该 peer 的关系认知":

                    **RelationWindow**（type="relation"，id 稳定 \`w_rel_<peerId>\`）：
                    专属 window type，注册 \`edit\` command（详见 children/edit_command）。
                    这是 relation 的命令面入口——LLM 想更新 relation 不再依赖 write_file 弱 prompt。

                    **default visibility 扩展**：
                    除 talk_window 派生的 peer 外，每轮还**默认派生**两类 peer 的 relation_window，
                    让 Agent 一上场就看见身边有谁，不必先 talk 才能写 relation：
                    - **同级 Agent**: 与 self 同父的其它 OOC Agent（top-level 时 = 其它顶层 Agent）
                    - **一级 children Agent**: self 自身 children/ 下一级的 OOC Agent（不递归到孙）

                    判定规则（见 src/persistable/stone-object.ts:discoverStoneHierarchicalPeers）：
                    - 含 \`self.md\` 的 stone 目录视为 OOC Agent
                    - \`user\` 永远过滤（passive object 不是 Agent）
                    - 自身被排除
                    - 已在 talk_window peer 列表中的不重复加，不覆盖 createdAt

                    **peer readme 挂回 RelationWindow**：
                    default visibility 让大量自动派生的 sibling/child relation_window 出现在 LLM 视野，
                    但 self 大概率没写过它们的 relation note → window body 全空只剩 path。这违背
                    default visibility 的初衷（让 Agent 一上场就知道身边有谁干什么）。把 peer readme
                    （\`stones/<branch>/objects/<peer>/readme.md\`）作为只读字段挂回 RelationWindow，
                    LLM 一眼看到 peer 是谁，无须再 file_window open；同时不影响 self-relation 的可写
                    双层（pools/flows）。维度上 RelationWindow 现在承担"peer 身份介绍 + self-relation
                    双层认知"两块（不是严格的"只 self-relation"）。

                    **渲染策略**：
                    缺失的字段节点不再渲染占位文案（旧版 \`(暂无;通过 open(...) 写入)\`）。节点本身
                    缺席就是信号；占位文案对 LLM 是噪声，basicKnowledge 已讲清楚 edit 用法不必重复。
                    \`*Exists=false\` 或 body 为空时直接跳过该 XML 节点，render 出来的窗口只含真有内容
                    的字段。

                    RelationWindow 暴露字段:
                    - \`peerId\`: 对端 objectId（去重 key）
                    - \`peerReadmePath\` + \`peerReadmeBody?\` + \`peerReadmeExists\`:
                      peer 身份介绍（只读；从 stone readme 派生）
                    - \`selfLongTermPath\` + \`selfLongTermBody?\` + \`selfLongTermExists\`:
                      pool 层长期 relation（懒创建；exists=false 时 body=undefined）
                    - \`selfSessionPath\` + \`selfSessionBody?\` + \`selfSessionExists\`:
                      flow 层 session 临时 relation

                    **两层文件 (long_term × session)**:
                    - long_term: \`pools/objects/<self>/knowledge/relations/<peer>.md\` —— 跨 session 长期认知；
                      只能由 super flow 写入（保 reflectable 元编程闭环）。落在 pool 而非 stone：relation 是 sediment knowledge
                      （运行时沉淀的事实），写就生效不进 git review/rollback；与 stone 中的 seed knowledge 二分。
                    - session: \`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md\` —— 本 session 临时认知；
                      由 relation_window.edit(scope="session") 直接落盘，不污染长期 relations。

                    派生不持久化进 thread.contextWindows；id 稳定方便 UI 跨轮稳定。

                    跳过规则（全部静默，仅 console.debug）:
                    - target === SUPER_ALIAS_TARGET（super 自反）→ 完全跳过整组派生。
                    - thread.persistence 缺失 → 完全跳过。
                    `,
                    named: {
                        "RelationWindow": "type=\"relation\" 的 ContextWindow；relation 命令面入口",
                        "deriveRelationWindow": "按 talk_window peer 派生 RelationWindow 的函数",
                        "long_term relation": "pools/objects/<self>/knowledge/relations/<peer>.md，跨 session 长期；落 pool 不落 stone",
                        "session relation": "flows/<sid>/objects/<self>/knowledge/relations/<peer>.md，仅本 session",
                        "peer readme + self-relation 双层": "RelationWindow 含 peer stone readme 只读（peerReadmePath/Body/Exists, synthesizer 注入 peer 的 stones/<branch>/objects/<peer>/readme.md）+ self-relation 双层（self 对 peer 的 long_term/session 认知, 可 edit）；2026-05-27 撤回了'只在 pools+flows'的删除",
                        "*Exists flag": "API caller 用 selfLongTermExists/selfSessionExists 区分 lazy-create vs read-fail",
                    },
                    children: {
                        "edit_command": {
                            title: "relation_window.edit - 双 scope 编辑",
                            content: `
                            relation_window 注册唯一一个 command \`edit\`，参数:
                            - \`content\`: 必填，relation 文件完整正文（整文件替换语义，与 write_file 一致）
                            - \`scope\`: 必填，\`"session"\` | \`"long_term"\`

                            行为按 scope 分路:

                            **scope="session"**:
                            直接通过 writeFlowRelation 写 \`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md\`，
                            下一轮 render 自动出现在伴随 KnowledgeWindow 的 \`## session\` 段。
                            不动 stones/——本 session 临时认知不污染长期 relations。

                            **scope="long_term"**:
                            必须经过 super flow（reflectable 维度的元编程闭环约束）。
                            executeRelationEdit 优先复用 thread 已有的 talk_window(target=super)；
                            没有则**构造临时 TalkWindow 对象**（不挂到 thread.contextWindows，避免常驻通道污染），
                            调用 deliverTalkMessage 派一条 relation 更新请求到 super session 的 callee thread。
                            super 收到后由 super flow 协议正常处理 pool 层 relation 的编辑
                            （写 \`pools/objects/<self>/knowledge/relations/<peer>.md\`）。

                            两种 scope 都不绕过 reflectable 协议:
                            - session 是真正"局部认知"，本来就不属 reflectable 写入面；
                            - long_term 严格走 super，相当于把 "write_file pools/.../relations/..." 替换为
                              结构化的 talk 请求，super 仍是 long_term knowledge 写入的唯一通道。
                            `,
                            named: {
                                "scope=session": "写 flow 层，立即生效，仅本 session 可见",
                                "scope=long_term": "派给 super flow，由 super 写 pool 层 knowledge/relations",
                                "临时 TalkWindow": "不挂到 thread 的一次性派送载体；避免 super 通道常驻 contextWindows",
                            },
                            sources: [["src/executable/windows/relation/index.ts", "RelationWindow + edit command 注册与 executeRelationEdit；派送复用 src/executable/windows/talk/delivery.ts:deliverTalkMessage；scope=session 写盘 src/persistable/flow-relation.ts:writeFlowRelation"]],
                        },
                    },
                    sources: [["src/executable/windows/relation/index.ts", "RelationWindow 与 edit command；派生函数 deriveRelationWindow（含 peer readme 注入）见 src/thinkable/knowledge/synthesizer.ts（deriveRelationCompanionKnowledge 已 @deprecated 返回空——KnowledgeWindow 合并进 RelationWindow 字段）；flow 层文件 IO 见 src/persistable/flow-relation.ts"]],
                },
            },
            patches: {
                "no_shared_state_across_threads": {
                    title: "thread 之间不共享内存状态（do_window.move 是唯一例外）",
                    content: `
                    thread 不能直接读取彼此的 contextWindows / events / threadLocalData。

                    跨线程影响必须显式经过 inbox / outbox、do_window transcript 或 talk_window transcript。
                    这是 collaborable 的硬约束:让协作链路始终可观察、可回放、可 debug，
                    而不是依靠隐式的共享指针。

                    **唯一例外**：do_window.move 提供 ContextWindow 的跨 thread ref / 移交语义
                    （详见 cross_thread_window_sharing patch 与 executable.context_window.children.sharing）。
                    `,
                },
                "cross_thread_window_sharing": {
                    title: "do_window.move：跨 thread 共享 ContextWindow 的第二条协作通道",
                    content: `
                    在 inbox/outbox 文本消息之外，OOC 提供了第二条协作通道：通过 do_window 上注册的 \`move\` 命令，
                    把整个 ContextWindow（含其内部状态）以 ref / move 模式传递给对端 thread。

                    **两种 sharing 模式**（plan §do_window.move）:
                    - **ref**（只读引用）：对端获得分享时刻的 freeze snapshot；自己保留 owner 继续 live 操作。
                      ref 上不能 exec 任何命令（仅 close 释放本地引用）。
                    - **move**（所有权移交）：对端获得完整 owner（live）；自己变 lent_out 占位（看 snapshot），临时只读。

                    **归还路径**：当 borrower 用 mode="move" 在 creator do_window 上发起时，按 id 检测对端有同 id
                    的 lent_out → 视为归还，对端恢复 owner（吸收 borrower 的 latest 内容），自己副本被移除。

                    **自动归还**：do_window archive（onClose）时，子 thread 持有的所有"对应父 lent_out 配对"的
                    owner windows 自动归还父 thread。

                    **id 协议**：跨 thread 时 window id 严格保持不变（用于配对识别 lent_out ↔ owner）。

                    **可被 share 的 window 类型**：file / knowledge / search / program / todo / talk / plan / relation / custom；
                    do_window 自身、command_exec、root 不可分享（语义不合理）。

                    与 inbox/outbox 的关系：消息通道仍是协作的主路径；window 共享只是把"已经组织好的上下文"
                    一次性带过去，避免对端重复打开 file / search / knowledge 等。
                    `,
                    named: {
                        "ref vs move": "ref 是只读 snapshot；move 是所有权转移",
                        "id 协议": "跨 thread move 保留同一 id；用于自动配对识别归还",
                        "自动归还": "do_window archive 时把子的 borrowed owner 全部回写父",
                    },
                },
                "super_alias_target": {
                    title: "talk_window.target === 'super' 是自指别名",
                    content: `
                    一般情况下 talk_window.target 是另一个 flow object id。
                    特殊地，target === "super" 时被 talk-delivery 翻译为指向自己的 super 分身:
                    calleeObjectId = caller.objectId, calleeSessionId = "super"。

                    这是跨 session 派送（caller 当前 session ≠ "super"），talk-delivery 不再约束 caller/callee 同 session。
                    详见 reflectable.super_session / reflectable.super_alias_target。
                    `,
                },
                "parent_child_hierarchy": {
                    title: "parent-child 层级 - peer 之外的第三种关系轴",
                    content: `
                    collaborable 的 talk / do / relation_window 主要承载 **peer 平等轴**（同级 Agent 平等协作，
                    只能说服不能支配）。但 Object 之间还有第三种关系轴: **parent-child 层级**（child Agent
                    物理嵌套在 parent 的 children/ 下）。完整语义见 root.patches.object_relations，这里只记
                    collaborable 侧的分工:

                    - 可见性（已落地）: relation_window 每轮默认派生 self 的"同级 Agent"+"一级 children Agent"，
                      让 Agent 一上场就看见身边有谁（见 relation_window；判定见
                      src/persistable/stone-object.ts:discoverStoneHierarchicalPeers，不递归到孙）。
                    - 修改权: **self-scope 自治**（见 root.patches.object_relations）。object 改自己子树（含自己 seed）
                      经 stone-versioning self-scope 自治 ff-merge、不经他人 review；cross-object（如 child 改 parent）
                      才 PR。这不在 collaborable 运行时通道里——设计期改 seed 走 stone-versioning，运行时管控
                      （叫停跑偏的 child）才走 talk（发消息让 child 自己停），**不暴力写** child 运行时状态。

                    所以 collaborable 只负责"运行时的 peer 协作 + 运行时管控的 talk 通道"；改 seed 的 self/cross
                    划界落在 persistable.stone-versioning，不在这里。
                    `,
                    named: {
                        "peer 平等轴": "同级 Agent 平等协作，只能 talk 说服、不能直接改对方",
                        "parent-child 层级轴": "child 嵌套在 parent/children/<child>/；含 knowledge 继承 / 可见性 / 修改权(self-scope 自治)",
                    },
                    todo: [
                        "self-scope 自治改 seed 已由 write_file→stone-versioning 落地；嵌套 child 自 metaprog 需放开 isValidObjectId（见 persistable.stone-versioning）。",
                    ],
                },
            },
        },
        "observable": {
            title: "OOC Agent observable 概念",
            content: `
            Observable 描述 Object 的可观测能力。

            Object 在每一轮思考中产生的 LLM 输入输出、tool 调用、context 状态都应该可记录、可查看、
            可暂停、可回放。observable 不改变 Object 的行为，只在 thinkloop 周围加观测点。

            observable 有**两个消费方**（agent-native parity，见 root.patches.agent_native_parity）:
            - 人类面（已落地）: 控制面 / UI 通过 debug 文件、loop timeline、ContextSnapshot、PauseChecker
              "看进去"、暂停、介入。
            - agent 面（当前是 parity 缺口，演化方向）: Agent **自己**读自己的历史并据此调整。关键约束:
              自观测**不在业务 thread 内做**（会撞 thinkable.context_budget + "reasoning 不反复喂回"），
              而是在 **super flow** 里做——Agent 以 super 之眼读"另一个自己（业务 thread）"的落盘产物
              （debug 文件 / windowsSnapshot / ContextSnapshot），独立 context、不挤占业务 thread 预算。
              因此 observable 的 agent 面**从属于 reflectable 的 super 通道**（见 reflectable）。这不是"豁免
              对称"，而是"换执行场所": 人类在控制面看、agent 在 super flow 看同一份落盘产物。

            核心组成:
            1. LlmObservation: 内存中保留的最近一次 LLM 输入/输出快照，供测试与控制面查询。
            2. Loop-level debug: 开启后每轮把 input/output/meta 落到 \`<threadDir>/debug/loop_NNNN.*.json\`。
            3. PauseChecker: runtime 可注入的暂停判定器；在 tool call 执行之前生效，允许人工介入。
            4. ContextSnapshot: 与 system message XML 同源的结构化快照，让 UI 不必 re-parse XML。

            observable 不持有调度或业务逻辑，所有写盘都委托给 persistable.debug-file；
            它只决定"何时记、记什么"。
            `,
            named: {
                "Observable": "Object 的可观测能力维度，定义如何记录 / 查看 / 暂停一轮思考",
                "LlmObservation": "内存中最近一次的 LLM 输入/输出快照",
                "LlmLoopHandle": "begin/finish 之间传递的运行时句柄，记录 loopIndex、startedAt、字节数等",
                "PauseChecker": "runtime 可注入的暂停判定器 (thread) => boolean",
                "ContextSnapshot": "与 system message XML 同源的结构化 thread 状态快照",
                "debug 文件": "<threadDir>/debug/llm.input.json、llm.output.json、loop_NNNN.{input,output,meta}.json",
                "双消费方": "observable 同时服务人类面（控制面 debug/timeline）与 agent 面（super flow 自观测）",
                "agent 自观测": "Agent 在 super flow 里读另一个自己（业务 thread）的落盘产物；从属 reflectable.super 通道",
            },
            children: {
                "llm_observation": {
                    title: "llm_observation - 最近一次 LLM 输入/输出",
                    content: `
                    LlmObservation 保留内存中最近一次 LLM 调用的输入与输出（src/observable/index.ts）。

                    读写接口:
                    - writeLatestLlmInput / writeLatestLlmOutput: 由 thinkloop 在请求前后调用；持久化线程同时落盘到 llm.input.json / llm.output.json。
                    - getLatestLlmObservation: 测试与控制面读取最近一次的 input / output / provider / model。
                    - clearLatestLlmObservation / clearObservableDebugState: 测试之间互相隔离时调用，避免污染。

                    LlmObservation 是单例（模块顶层变量），所以同进程内只反映"最近一次"调用。
                    多 thread 并发执行时，谁后写谁覆盖。如需按 thread 区分历史，请用 loop-level debug 文件。
                    `,
                    named: {
                        "writeLatestLlmInput": "thinkloop 调用前记录输入",
                        "writeLatestLlmOutput": "thinkloop 调用后记录输出",
                        "getLatestLlmObservation": "读取最近一次观测",
                        "clearObservableDebugState": "清空 latest snapshot / debugEnabled / loop counter / pause checker",
                    },
                },
                "debug_files": {
                    title: "debug_files - 落盘的输入输出与元数据",
                    content: `
                    loop-level debug 默认关闭，通过 enableDebug() / disableDebug() 切换。

                    开启后，每轮 LLM 调用会在 \`<threadDir>/debug/\` 下写三类文件（loopIndex 用 4 位 0 padding）:
                    - loop_NNNN.input.json: 本轮 inputItems + contextSnapshot。
                    - loop_NNNN.output.json: 本轮 normalized outputItems + provider/model。
                    - loop_NNNN.meta.json: provider / model / latencyMs / messageCount / toolCount / toolCallCount / contextBytes / status / error
                      / **windowsSnapshot**（见 patches.windows_snapshot）。

                    始终落盘的两个文件（与 enableDebug 无关，只要 thread.persistence 存在就写）:
                    - llm.input.json: 与最近一次 writeLatestLlmInput 同步覆盖。
                    - llm.output.json: 与最近一次 writeLatestLlmOutput 同步覆盖。

                    所有落盘动作都委托给 src/persistable/debug-file.ts；observable 只负责决定写什么 / 何时写。
                    无 persistence 的 thread（测试 fixture 等）跳过落盘，但仍更新 latest 内存快照。
                    `,
                    named: {
                        "enableDebug / disableDebug": "切换 loop-level debug 落盘的开关",
                        "loopIndex": "thread 内的轮次编号，4 位 0 padding 作文件名",
                        "loop_NNNN.input.json / output.json / meta.json": "loop-level debug 的三类文件",
                        "llm.input.json / llm.output.json": "始终落盘的最近一次快照",
                        "windowsSnapshot": "loop_NNNN.meta.json 中的 window content hash 数组; 给前端 LoopDiffView 做 added/changed/removed/unchanged 判定",
                    },
                    patches: {
                        "windows_snapshot": {
                            title: "windowsSnapshot - 每轮 ContextWindow content hash 落盘",
                            content: `
                            **目的**: 让 visible.loop_timeline 的 Time Machine 模式能做 window diff
                            (添加/修改/删除/不变四态)。前端拿 loop N + loop N-1 的 windowsSnapshot 算 diff。

                            **字段** (扩展 LlmLoopDebugMetaRecord):
                            \`\`\`
                            windowsSnapshot?: Array<{
                              id: string;
                              type: string;          // file / talk / do / plan / search / ...
                              contentHash: string;   // Bun.hash(JSON.stringify(stripVolatile(window), sortedKeys)).toString(36)
                              parentWindowId?: string;
                              status?: string;
                              compressLevel?: 0 | 1 | 2;
                            }>
                            \`\`\`

                            **算法** (src/observable/window-hash.ts 新建):
                            - **type-agnostic**: 不为每个 type 注册 hashContent; 统一
                              \`Bun.hash(JSON.stringify(stripVolatileWindow(window), Object.keys(stripped).sort()))\`
                            - **稳定 key 序**: 用 sorted keys 防止 V8 字段顺序变化漂移
                            - **stripVolatile**: 剥离 in-process 字段 (_decayMeta / compressLevel 默认值 / 等),
                              与 src/persistable/thread-json.ts stripVolatileForPersist 同款规则
                            - **64-bit number → toString(36)**: 短编码

                            **写入点**: writeLoopDebugMeta 之前算所有 contextWindows 的 hash, 填进 meta record。

                            **不变量**:
                            - contentHash **不进 thread.json** (业务字段保持最小; hash 是 debug 视角派生字段)
                            - 同 content (剥 volatile 后) → 同 hash (Bun.hash 稳定 API)
                            - windowsSnapshot 是 optional (旧 loop 数据无此字段; 前端 graceful fallback)

                            **测试关注点**:
                            - 同 window 反复 hash → 一致
                            - 不同 content (改 file_window.content) → 不同 hash
                            - volatile 字段变化 (_decayMeta.idleRounds) → 同 hash (剥掉)
                            - 字段顺序 (V8 内部 key insert order) → 同 hash (sortedKeys 防漂移)
                            `,
                        },
                    },
                },
                "pause": {
                    title: "pause - tool call 之前的人工介入点",
                    content: `
                    PauseChecker 是 runtime 注入的回调，默认始终返回 false:
                    \`\`\`
                    setPauseChecker((thread) => /* 是否需要暂停 */ );
                    isPausing(thread); // thinkloop 调用
                    \`\`\`

                    thinkloop 协议（src/thinkable/thinkloop.ts）严格保证 pause 时序:
                    1. 记录 reasoning / text / function_call 到 thread.events。
                    2. 调用 isPausing(thread); 若 true:
                       - finishLlmLoop({ status: "paused" })
                       - thread.status = "paused"
                       - 直接 return，不分派任何 tool call。
                    3. 否则继续 dispatchToolCall。

                    这种顺序保证: 暂停态下 LLM 输出已经写入事件流可被人类查看 / 修改，但 tool call 还没真正执行，
                    所以人工可以选择"修一下再放行"或"放弃这次输出"。
                    `,
                    named: {
                        "PauseChecker": "(thread) => boolean | Promise<boolean>",
                        "setPauseChecker": "注入 pause 判定逻辑的函数",
                        "isPausing": "thinkloop 调用的检查；默认实现返回 false",
                    },
                },
                "context_snapshot": {
                    title: "context_snapshot - 与 XML 同源的结构化快照",
                    content: `
                    captureContextSnapshot（src/persistable/debug-file.ts）从 ThreadContext 抽取调用 LLM 时刻的快照子集:
                    - id / status / plan
                    - contextWindows / inbox / outbox / events
                    - creatorThreadId / parentThreadId

                    它与 inputItems 中的 system message XML 同源:同一份 thread 状态先 render 成 XML 给 LLM，
                    再 capture 成 JSON 给 UI 消费。UI 不需要 re-parse XML，可直接渲染结构化字段。

                    contextSnapshot 字段附在 LlmInputDebugRecord 上，写入 llm.input.json / loop_NNNN.input.json。
                    旧文件没有该字段，UI 应做兼容判断。
                    `,
                    named: {
                        "captureContextSnapshot": "从 ThreadContext 抽取快照的函数",
                        "ContextSnapshot": "结构化快照类型；字段子集见 src/persistable/debug-file.ts ContextSnapshot",
                        "LlmInputDebugRecord": "落盘 input 的记录类型，包含 inputItems + contextSnapshot",
                    },
                },
            },
            patches: {
                "ephemeral_thread_keying": {
                    title: "无 persistence 的 thread 用 ephemeral key 计数",
                    content: `
                    nextLoopIndex 用 loopKey(thread) 定位计数器:
                    - 有 persistence 时 key = \`{baseDir}:{sessionId}:{objectId}:{threadId}\`，跨进程同一 thread 共享计数。
                    - 无 persistence 时 key = \`ephemeral:\${thread.id}\`，避免不同测试线程因 id 偶然相同互踩。

                    ephemeral 线程不落盘 loop_NNNN.*.json，只用 loopIndex 维护单进程内的轮次连续性。
                    `,
                },
                "pause_default_off": {
                    title: "PauseChecker 默认关闭",
                    content: `
                    模块加载时 pauseChecker 初始化为 () => false，所以默认 isPausing 永远是 false。
                    必须由 runtime（如 app/server）显式调用 setPauseChecker 才会激活。

                    clearObservableDebugState 会把 pauseChecker 重置回默认 false，测试套件间不会互相泄漏。
                    `,
                },
                "silent_swallow_ban": {
                    title: "silent-swallow ban — 失败必须可见",
                    content: `
                    跨 observable / persistable / executable 的横切契约。

                    所有 catch 块 / 错误返回 必须做以下至少一项：
                    (a) 重新抛（拒绝在此层处理，让 caller 决定）
                    (b) 写 event（thread.events / debug 文件 — 让 LLM 看见）
                    (c) console.warn（启动期 / runtime advisory — 让运维看见）

                    禁止：
                    - bare \`catch {}\` / \`catch (e) {}\`（无任何动作，错误彻底吞噬）
                    - \`void someAsyncCall()\` 忽略函数返回的错误信号（除 unused-import/unused-var keep-alive 外，需注明 \`// intentional: ...\`）
                    - exec 层依赖 render 报告自身的语义错误（如 open_knowledge 不校验 path 存在性，让 render 内联 <error> 兜底）
                    - \`.catch(() => undefined)\` 默默吞 promise rejection（serial-queue 防毒化是 intentional 例外，需注释解释）

                    5+ 处同源 facet，跨 dogfooding 协议 / git merge / worker 调度 / knowledge 命令多个域。

                    审计周期：每次大重构后跑一次 grep：
                    \`grep -rn 'catch.*{}' src/\`
                    \`grep -rn 'void [a-z]' src/ | grep -v 'return void'\`
                    \`grep -rn '\\.catch.*=>.*{}' src/\`
                    除带 \`// intentional: ...\` 注释的合理静默外，应当**零**真 silent-swallow。

                    合理静默必须加注释说明意图，例如：
                    \`\`\`
                    try { await stat(p); } catch {
                      // intentional: explicit fall-through，ENOENT 视为路径不存在，作为下一步条件分支
                    }
                    \`\`\`

                    **sandbox 例外白名单**：

                    \`src/executable/program/sandbox/\` 下有 2 类 catch 块被显式列为 ban 例外，
                    必须带 \`// intentional:\` 注释，不视为违反 silent-swallow ban：

                    1. **tmp file cleanup**（如 \`executor.ts\` finally 块里 unlink 失败）：
                       sandbox 执行已经在 finally 中，exec 结果对 caller 仍有效；
                       tmp 文件由 OS 周期清理；throw 会破坏主流程返回值。
                    2. **serialization fallback**（如 \`console.ts\` 把 JSON.stringify 失败降级为 String(a)）：
                       sandbox console.log 内部细节；BigInt / circular ref 等非常规值用 String 降级
                       对 LLM/observability 无意义；写 event/warn 会噪音。

                    这 2 类是"完成主功能后的善后失败"——本质上不是错误吞噬（主功能成功了），
                    而是 cleanup/fallback 路径自有 fallback 行为。**不允许扩张到其它场景**——
                    业务 catch 仍必须做 (a)(b)(c) 至少一项。

                    audit grep 时跳过带 \`// intentional: sandbox\` 标签的 catch。
                    `,
                    sources: [["audit/根因#6/2026-05-24", "docs/2026-05-24-fix-plan.md"]],
                },
            },
        },
        "reflectable": {
            title: "OOC Agent reflectable 概念",
            content: `
            Reflectable 描述 Object 的自我反思能力 + 元编程的触发协议。

            Object 可以反思自己、沉淀经验、修改自身的知识与方法。
            OOC 不为此专门设一套"反思 API"，而是复用既有协作设施 —— 通过一个名为
            "super" 的特殊 session 把 Object 引到一条专用反思线程上，在那里改写自身
            stone 中的身份文件（self.md / readme.md）与 pool 中的 sediment knowledge
            （pools/<self>/knowledge/memory / relations）。下一轮新 thread 自动看见这些落盘的新内容，
            行为随之自我演化。

            注意 stone 中的 **seed knowledge**（\`stones/<self>/knowledge/\`，人类设计的初始知识库）
            **不在 super flow 默认写入面**——它与 server / client 同属高赌注设计变更，
            走 stone-versioning 的 PR-Issue 流程（可挂 eval gate）。reflectable 只动 sediment（运行时沉淀），
            不直接改 seed（先天能力基底）。

            核心组成:
            1. super session: 受保护的 sessionId（"super"），表示 Object 的反思通道。
            2. super alias target: talk_window.target === "super" 时被 talk-delivery 翻译为指向自己的 super 分身。
            3. Reflectable protocol knowledge: 当 thread.persistence.sessionId === "super" 时，synthesizer 自动注入 REFLECTABLE_KNOWLEDGE。
            4. memory 写入: super flow 中允许写自身 stone 的身份文件（self.md / readme.md）与 pool 的 sediment knowledge
               （pools/objects/<self>/knowledge/memory/*.md、pools/objects/<self>/knowledge/relations/*.md）。
               注意 sediment knowledge 不进 git review（事实型，写就生效）；身份文件仍在 stone 进 git review；
               seed knowledge（stones/<self>/knowledge/）不在 super flow 默认面。
            5. 元编程范围分工: reflectable 提供"为什么 / 何时 / 在哪条线程上"做元编程的协议；
               具体可改的对象由 programmable（函数方法库）与 visible（UI 页面）两个维度承担（详见 children/metaprogramming）。

            Reflectable 不是新机制，是几个既有维度（collaborable.talk-delivery / persistable.stone /
            persistable.pool / thinkable.knowledge）在 sessionId="super" 这个特殊上下文下被协同利用的结果。
            （它仍是一个**维度**而非"非维度协议"——按 root.patches.dimension_criterion 的 self-constitutive
            标准，它描述的是"Agent 自我演化"这个可演化面，哪怕实现是组合的。）

            super 是 Agent 一切"自我相关"能力的**统一执行场所**: 自观测（读自己历史）、自反思（沉淀经验）、
            自修改（改 self / sediment）都收敛到 super flow。其中自观测的落盘产物由 observable 产生
            （见 observable 的 agent 面），super 只是"读它们、据此调整自己"的场所。

            scope —— super 是 **self-scoped** 的: object A 的 super flow 只能观察 / 修改 A 自己
            （talk_window.target="super" 是自指别名，见 super_alias_target）。改自身 stone（self.md / server /
            knowledge）经 write_file → stone-versioning 的 **self-scope 自治 ff-merge**，不经他人 review；
            cross-object（改别人子树）才 PR（详见 root.patches.object_relations）。super 本身从不跨 object。
            `,
            named: {
                "Reflectable": "Object 的反思 / 元编程能力维度",
                "super session": "受保护的 sessionId='super'，承载 Object 的反思线程",
                "super alias target": "talk_window.target='super'，翻译为指向自身的 super 分身",
                "REFLECTABLE_KNOWLEDGE": "进入 super flow 时自动注入的协议知识；告诉 LLM 反思场景该做什么",
                "memory": "pools/objects/<self>/knowledge/memory/<slug>.md，Object 运行时沉淀的长期记忆（sediment）；与 stone 中的 seed knowledge 配对",
                "metaprogramming": "通过 write_file 把新认知 / 新方法落到自己的 stone（身份/源码）或 pool（sediment 知识 / 事实），下一轮自动生效；seed knowledge 改动走 PR-Issue",
                "self-scoped": "super 只能观察 / 修改 Object 自己；parent 改 child 的 seed 走 stone-versioning，不走 super 跨 object",
                "自我相关能力统一场所": "super flow 收敛 Agent 的自观测 / 自反思 / 自修改三类自我相关动作",
            },
            children: {
                "super_session": {
                    title: "super_session - 受保护的反思通道",
                    content: `
                    SUPER_SESSION_ID = "super"（src/executable/windows/_shared/super-constants.ts）是被全系统硬编码识别的
                    特殊 sessionId。它代表 Object 的反思通道，不是普通业务 session。

                    校验规则:
                    - isSuperSessionId(sessionId): 大小写无关比较，trim().toLowerCase() === "super"。
                    - 这样可以防 HFS+ 等大小写不敏感文件系统通过 "Super" / "SUPER" 绕过。

                    生命周期:
                    - super session 的 .session.json 在首次有 super 派送时由 talk-delivery 懒创建（详见 persistable.super_session_lazy_create）。
                    - 同一个 baseDir 下整个 OOC world 只有一个 super session；每个 object 都可以有自己的 super flow thread。
                    `,
                    named: {
                        "SUPER_SESSION_ID": "字符串常量 'super'",
                        "isSuperSessionId": "大小写无关的 super sessionId 校验函数",
                    },
                },
                "super_alias_target": {
                    title: "super_alias_target - talk_window.target='super' 的自指语义",
                    content: `
                    talk_window.target 一般是另一个 flow object id。
                    特殊地 target === "super" 时，talk-delivery 翻译为指向自己的 super 分身
                    （src/executable/windows/talk/delivery.ts:89-90）:
                    - calleeObjectId = caller.objectId
                    - calleeSessionId = "super"

                    这是跨 session 派送（caller 当前 session ≠ "super"），talk-delivery 不再约束 caller/callee 同 session。
                    Caller 这边并不知道自己在跟"自己"说话；它只是开了一个 target="super" 的 talk_window，
                    然后 say 一段反思请求。talk-delivery 完成派送后，callee 端是同一个 objectId 但在 super session 里的一条新 thread。

                    callee thread 启动时由 initContextWindows 注入指向 caller 的 creator talk_window，于是反思线程
                    可以通过 creator talk_window.say 把反思结论"回报"给原线程。
                    `,
                    named: {
                        "SUPER_ALIAS_TARGET": "字符串常量，与 SUPER_SESSION_ID 相同",
                        "cross-session 派送": "caller 在业务 session、callee 在 super session 的派送类型",
                    },
                },
                "reflectable_knowledge": {
                    title: "reflectable_knowledge - super flow 中的协议知识注入",
                    content: `
                    src/thinkable/knowledge/synthesizer.ts（SUPER_SESSION_ID 门控块）会检查 thread.persistence?.sessionId:
                    \`\`\`
                    if (thread.persistence?.sessionId === SUPER_SESSION_ID) {
                      protocolEntries[REFLECTABLE_BASIC_PATH] = REFLECTABLE_KNOWLEDGE;
                      protocolEntries[REFLECTABLE_METAPROG_PATH] = REFLECTABLE_METAPROG_KNOWLEDGE;
                    }
                    \`\`\`
                    同一 if 块注入两条：REFLECTABLE_BASIC_PATH（反思基础协议）+ REFLECTABLE_METAPROG_PATH
                    （元编程协议指引，教 LLM 何时走 worktree 沙箱）。

                    REFLECTABLE_KNOWLEDGE（src/thinkable/reflectable/reflectable-knowledge.ts）告诉 LLM:
                    - 你还是同一个 Object，super flow 只是另一条会话脉络。
                    - 本轮做反思 / 沉淀，不是执行新业务任务。
                    - 读 inbox 中 caller 的反思请求；理解对方要你沉淀 / 调整什么。
                    - 写到 pools/objects/<self>/knowledge/memory/<slug>.md（slug 用 kebab-case 概括主题）。
                    - 必要时（caller 明确要求改身份）允许写 stones/<self>/self.md / readme.md。
                    - 通过 creator talk_window 回复结论 (say + close)。
                    - 用 end command 结束本轮 super 思考。

                    这条协议知识只在 super flow 注入，普通业务线程不会看见。
                    `,
                    named: {
                        "REFLECTABLE_BASIC_PATH": "字符串常量 'internal/executable/reflectable/basic'",
                        "REFLECTABLE_KNOWLEDGE": "super flow 中要给 LLM 的反思基础协议知识正文",
                        "REFLECTABLE_METAPROG_PATH": "元编程协议路径；同 if 块与 BASIC 一起在 super flow 注入 REFLECTABLE_METAPROG_KNOWLEDGE",
                    },
                },
                "end_reflection_reminder": {
                    title: "end_reflection_reminder - 业务 thread 调 end 时的反思提醒",
                    content: `
                    **触发**: 当 OOC agent 在**非 super flow** 的业务 thread 中创建 \`command="end"\` 的
                    command_exec form 时, synthesizer 注入一段简短的 reflection reminder knowledge。

                    **目的**: 让 agent 在结束业务 thread 之前自觉考虑 — 本次工作是否产生了值得沉淀的认知 /
                    经验 / 对 peer 的认识更新 / 反复犯的错。如果有, 建议在 end 之前开 super flow 走一次反思:
                    \`exec(command="talk", args={ target: "super", initialMessage: "请帮我沉淀 ..." })\`。

                    **门控条件** (synthesizer 内):
                    - \`thread.persistence?.sessionId !== SUPER_SESSION_ID\` — super flow 内 end 是反思自身的结束,
                      不该再提示反思 (避免无限套娃)
                    - form.command === "end" — 只在 end 的 form 被打开 / 持续展示时激活
                    - 可选: \`thread.events.length > N\` (阈值默认未启用; 简单 thread 也允许提示, LLM 自己决定是否触发)

                    **不强制反思**: knowledge 只是 hint, 不是 deny gate。LLM 看完之后:
                    - 觉得有沉淀价值 → 取消 end 表单, 改调 talk target=super
                    - 觉得无值得反思的 → 直接 submit end, 正常结束

                    **与 REFLECTABLE_KNOWLEDGE 的关系**:
                    - REFLECTABLE_KNOWLEDGE: 在 super flow 内告诉 LLM "你现在在反思场景, 应该写 memory"
                    - END_REFLECTION_REMINDER: 在业务 thread 调 end 时告诉 LLM "你刚才工作了一段, 考虑反思"
                    - 两者互补: 一个是反思入口提示, 一个是反思场景内的指引

                    **实现位置**:
                    - 常量在 src/thinkable/reflectable/reflectable-knowledge.ts (与 REFLECTABLE_KNOWLEDGE 同文件)
                    - 注入在 src/thinkable/knowledge/synthesizer.ts (检查 form.command === "end" + super 门控)

                    完整 design / harness 循环优化记录见 docs/2026-05-27-end-reflection-reminder-design.md。
                    `,
                    named: {
                        "END_REFLECTION_REMINDER_KNOWLEDGE": "常量名; 与 REFLECTABLE_KNOWLEDGE 同文件 export",
                        "END_REFLECTION_REMINDER_PATH": "字符串常量 'internal/executable/end/reflection-reminder'",
                        "门控条件": "thread.persistence?.sessionId !== SUPER_SESSION_ID; super flow 内 end 不重提",
                        "non-blocking hint": "提醒不是 deny; LLM 自己决定是否反思",
                    },
                },
                "memory_layout": {
                    title: "memory_layout - 长期记忆的落盘位置",
                    content: `
                    super flow 中允许写的路径（来自 REFLECTABLE_KNOWLEDGE 约束）:

                    **pool 侧（事实型，不进 git）**：
                    - pools/objects/<self>/knowledge/memory/<slug>.md: 长期记忆仓库；每条记忆一个文件，slug 用 kebab-case。
                      示例: ooc-collaboration-framework.md、tool-error-handling.md。
                    - pools/objects/<self>/knowledge/relations/<peer>.md: long_term relation 文件
                      （与 collaborable.relation_window 联动；session 层另有
                      flows/<sid>/objects/<self>/knowledge/relations/<peer>.md 由 relation_window.edit(scope="session") 直接写入）。

                    **stone 侧（设计型，进 git review）**：
                    - stones/<self>/self.md: 内部第一人称叙述（caller 明确要求改身份时）。
                    - stones/<self>/readme.md: 对外公开自述（caller 明确要求改对外说明时）。

                    禁止动的路径（不在 super flow 的工作范围内）:
                    - stones/<self>/server/ / client/ / .stone.json
                      （源码演化是高赌注，需走 stone-versioning 的 PR-Issue 流程；不由 super flow 直接改）
                    - stones/<self>/knowledge/（**seed knowledge** 设计层；与 server / client 同级，
                      走 stone-versioning 的 PR-Issue 流程 + eval gate；不由 super flow 直接改）
                    - 任何业务 session 下的 thread.json
                    - 业务代码（program shell / file_window.edit 业务文件）
                    - pool 的 data/ 与 files/（业务数据由 stone server method 维护，不由反思直接写）

                    写入方式: 通过 exec(command="write_file", path="...", content="...") 命令；
                    已存在的文件可用 open_file + edit 增量更新。

                    **sediment write contract（dogfooding 闭环关键）**：
                    所有 super flow 写入 \`pools/<self>/knowledge/memory/<slug>.md\` 与
                    \`knowledge/relations/<peer>.md\` 的 markdown 文件 **必须含 frontmatter**：

                    \`\`\`markdown
                    ---
                    title: <一句话主题>
                    description: <让下轮 LLM 知道这篇是否相关的一句>
                    activates_on:
                      "<trigger 1>": "show_description"
                      "<trigger 2>": "show_content"
                    ---

                    <正文，可以是几句也可以是长文>
                    \`\`\`

                    activates_on 是 trigger map：key 是 trigger 表达式，value 是激活级别。
                    三类 trigger：\`"window::<type>"\` / \`"command::<window_type>::<command>"\` / \`"super"\`
                    （详见 thinkable.knowledge.named.trigger）。多 trigger 命中取 max。

                    没有 frontmatter / 写错 schema 的 sediment 会被 thinkable.knowledge synthesizer 加载但
                    **永远无法被 activator 激活**——下轮新 thread 完全看不见这篇沉淀，
                    自演化闭环 silently 断裂（dogfooding 协议级缺口）。loader 改后写错 schema
                    会触发 parse error → console.warn 含路径 → 跳过该篇（fail-loud，不静默吞错）。

                    REFLECTABLE_KNOWLEDGE 必须显式把这条契约写进 LLM 协议提示，让 LLM 写 .md
                    时**始终包含合法 frontmatter**。模板示例可放在 reflectable basicKnowledge 末尾。
                    `,
                    named: {
                        "memory/<slug>.md": "长期记忆条目；一条记忆一个文件",
                        "kebab-case slug": "用短横线小写连字概括主题的命名风格",
                        "sediment in pool": "knowledge/memory/* 与 knowledge/relations/* 落 pool（事实型，不进 git）",
                        "self.md / readme.md in stone": "身份文件留 stone（设计型，进 git review）",
                        "seed not in super flow": "stones/<self>/knowledge/ 是 seed knowledge，不在 super flow 默认写入面；走 PR-Issue + eval",
                        "sediment write contract": "所有 super flow 写入的 .md 必须含 frontmatter（title/description/activates_on trigger map）；否则 activator 永远不命中，自演化闭环断裂",
                    },
                },
                "metaprogramming": {
                    title: "metaprogramming - 元编程闭环",
                    content: `
                    Reflectable 不只是"写感想"，更重要的是构成一个元编程闭环:

                    1. 业务线程遇到值得沉淀的事情，open 一个 target='super' 的 talk_window，say 反思请求。
                    2. talk-delivery 把请求派送到 super flow 下的反思 thread；该 thread 看见 REFLECTABLE_KNOWLEDGE。
                    3. 反思 thread 通过 write_file 把结论落到 pools/objects/<self>/knowledge/memory/<slug>.md
                       （或 stones/<self>/self.md / readme.md）。
                    4. 反思 thread 通过 creator talk_window 简短回复，然后 end。
                    5. 下次（同 Object 的任意新 thread）启动时，新写入的 memory 文件作为 knowledge 自动出现在 Context 中，
                       LLM 看见新认知 / 新约束，行为随之改变。

                    Reflectable 只负责"为什么 / 何时 / 在哪条线程上"做元编程，不定义"改的东西具体是什么形状":
                    - 修改自身函数方法（server method library 的形状、加载、调用约定、版本演化）→ 见 programmable 维度。
                    - 修改自身 UI 页面（stone client / flow client/pages 的形状、agent-native 访问）→ 见 visible 维度。
                    - 修改自身身份与 sediment knowledge（stones/<self>/self.md/readme.md 与
                      pools/objects/<self>/knowledge/{memory,relations}/）→ 这是 reflectable 默认覆盖的范围，
                      因为它们直接喂回 thinkable 的 context，闭环最短。
                    - 修改 seed knowledge（stones/<self>/knowledge/）→ **不在 reflectable 默认面**；
                      与 server / client 同级走 stone-versioning 的 PR-Issue 流程（先天能力基底应过 review + eval）。

                    因此 super flow 的典型工作是写身份 / sediment 记忆 / 关系记录；如果 caller 显式请求改
                    server / client / seed knowledge，需要走 programmable / visible 定义的演化路径或
                    stone-versioning 的 PR-Issue 流程（详见对应维度的 patches）。
                    `,
                    named: {
                        "self-evolution loop": "通过 super flow 写自身 stone，让下一轮行为自动演化",
                        "元编程范围分工": "reflectable 管触发与协议；programmable / visible 管被改对象的形状",
                    },
                },
            },
            patches: {
                "dont_summarize_only_in_endsummary": {
                    title: "反思结论必须落到 memory 文件",
                    content: `
                    REFLECTABLE_KNOWLEDGE 明确强调:不要只在 endSummary 里"嘴上沉淀"——那样下次的你看不到。

                    一定要 write_file 到 pools/objects/<self>/knowledge/memory/<slug>.md，文件才是长期记忆。
                    end 之前要确认:caller 要求记下来的要点，是否真的有一个 memory/<slug>.md 落地？
                    如果没有，先写，再 end。
                    `,
                },
                "business_task_isolation": {
                    title: "super flow 不开新业务任务",
                    content: `
                    super flow 是反思通道而非执行通道。

                    不允许在 super flow 里:
                    - 跑 program shell 改外部文件。
                    - 用 file_window.edit 改业务代码。
                    - 开任何 do command 派生子任务去执行业务。

                    super flow 默认仅写 stone 中的 self.md / readme.md（身份）与 pool 中的
                    sediment knowledge（knowledge/memory/* / knowledge/relations/*，长期事实）。
                    如果 caller 明确请求修改自身函数方法、UI 页面或 seed knowledge，应走对应维度定义的演化路径:
                    - 编辑 stones/<self>/server/index.ts → 见 programmable.method_evolution。
                    - 编辑 stones/<self>/client/index.tsx 或 flow client/pages/*.tsx → 见 visible.client_evolution。
                    - 编辑 stones/<self>/knowledge/<slug>.md（**seed knowledge**）→ 走 stone-versioning 的 PR-Issue 流程
                      （seed 是 Object 的"先天能力基底"，改动应过 review + eval gate；详见 persistable.stone.children.seed_knowledge）。

                    如果 caller 请求模糊到无法形成具体记忆条目，允许"已收到反思请求，本轮无新认知形成" + end，
                    但这是最低限度的兜底，不应作为默认动作。
                    `,
                },
            },
        },
        "persistable": {
            title: "OOC Agent persistable 概念",
            content: `
            Persistable 描述 Object 的持久化能力。

            Object 的身份、知识、协作产物都可以落到一个统一的文件树（"OOC world"）。
            persistable 不是数据库层，而是 Object 跨 session 的"骨架与肉身"——
            离开内存进程后，Object 还能从磁盘恢复成同一个 Object，下一次启动看见自己上一次的所有沉淀。

            核心组成（**三层而非二分**，2026-05-23 起）:
            1. world root: \`{baseDir}/\`，包含 \`stones/\` / \`pools/\` / \`flows/\` 三棵子树。
            2. stone tree: 设计层（持久 + git 版本化）。\`stones/{branch}/objects/<objectId>/\` 持有
               per-Object 长期身份与设计源码（self.md / readme.md / server / client / knowledge 五件套）；
               未来挂在 \`stones/{branch}/\` 根的是 world-level 持久资源。
            3. pool tree: 事实层（持久 + 不版本化）。两类挂载（2026-05-24 拓宽）:
               - \`pools/objects/<objectId>/\`：per-Object 事实（data csv / knowledge / files 三件套）
               - \`pools/repos/<repo-name>/\`：World 级共享的外部 git repo（工作中涉及的所有外部 repo 统一管理）
               pool 不挂 metaprog branch，因为事实是单向积累的（详见 children/pool）。
            4. flow tree: 运行层（ephemeral）。\`flows/{sessionId}/\` 由 \`objects/<objectId>/\`
               承载 per-Object 在该 session 的工作产物。
            5. ref 抽象: FlowObjectRef / ThreadPersistenceRef / StoneObjectRef / PoolObjectRef。
            6. 序列化策略: 写盘前剥离 in-process 内存字段（_decayMeta 等），读盘时兜底补 creator window。

            **stone vs pool vs flow 是 World 级别的三分**（不是 Agent 级别的）：
            - stone = 持久 + 版本化（跨 session 永存，过 git review）
            - pool  = 持久 + 不版本化（跨 session 永存，写就生效，事实型数据）
            - flow  = ephemeral（一次会话）
            - 三侧都有 \`objects/\` 中间层（pool 直接挂在 pools/ 下，无 branch）把 per-Object 与 world/session 级共享分开
            - LLM 提示词仍写 \`stones/<self>/...\`（rewriter 自动注入 branch + objects/）

            所有路径计算 / IO 都集中在 src/persistable/；其它层（executable / thinkable / observable）
            通过 ref + 函数调用访问磁盘，不直接拼路径。
            `,
            named: {
                "Persistable": "Object 的持久化能力维度，定义 stone / pool / flow 文件树与 ref 抽象",
                "OOC world": "包含 stones/ / pools/ / flows/ 三棵子树的统一文件树",
                "stone": "Object 的长期身份 + 设计源码目录；跨 session 共享，进 git review",
                "pool": "Object 的事实型数据目录；跨 session 累积，不进 git",
                "flow": "Object 在某 session 内的临时运行状态",
                "FlowObjectRef": "定位 flow object 目录的 ref（baseDir/sessionId/objectId）",
                "ThreadPersistenceRef": "FlowObjectRef + threadId，定位单条 thread",
                "StoneObjectRef": "定位 stone 目录的 ref（baseDir/objectId）",
                "PoolObjectRef": "定位 pool 目录的 ref（baseDir/objectId）；与 StoneObjectRef 同形状但语义不同",
                "deriveStoneFromThread": "从 ThreadPersistenceRef 派生 StoneObjectRef 的便捷函数",
            },
            children: {
                "world_layout": {
                    title: "world_layout - OOC world 目录结构",
                    content: `
                    完整目录形态（参见 src/persistable/common.ts + flow-object.ts + stone-object.ts + debug-file.ts）:

                    \`\`\`
                    {baseDir}/
                      stones/                        ← 设计层（持久 + git 版本化）
                        .stones_repo/                ← bare git repo（详见 stone_versioning）
                        <branch>/                    ← linked worktree（main + 任意 metaprog 分支）
                          .git                       ← 文件，gitdir 指回 .stones_repo/worktrees/<branch>
                          objects/                   ← per-Object 持久区（2026-05-21 引入）
                            <objectId>/
                              .stone.json            ← stone 元数据（type='stone', objectId）
                              self.md                ← 对内身份（写入 LlmGenerateParams.instructions）
                              readme.md              ← 对外公开介绍
                              server/index.ts        ← stone server 源码
                              client/index.tsx       ← stone client 源码
                              knowledge/             ← seed knowledge：人类预置的初始知识库（2026-05-24）
                                <slug>.md            ← frontmatter + activates_on 渐进激活协议
                          # （未来：world-level 资源放在 stones/<branch>/ 根本身，
                          #   与 objects/ 子目录物理分离）
                      pools/                         ← 事实层（持久 + 不版本化；2026-05-23 引入）
                        objects/                     ← per-Object 事实
                          <objectId>/
                            .pool.json               ← pool 元数据
                            data/                    ← 结构化数据（csv 格式；2026-05-24 起替代 sql）
                              <name>.csv             ← 一张表 = 一个 csv 文件；首行 header，后续行记录
                            knowledge/               ← sediment-only（运行时沉淀；seed 在 stone）
                              memory/<slug>.md       ← 长期记忆（reflectable 写入位置）
                              relations/<peer>.md    ← long_term 关系认知（collaborable 写入位置）
                            files/                   ← 任意文件（二进制 / 大体量 / 非结构化 blob）
                        repos/                       ← World 级共享外部 git repo（2026-05-24）
                          <repo-name>/               ← 外部 repo 工作面；自带 .git；详见 children/repos_pool
                            .git/
                            ...working tree
                      flows/                         ← 运行层（ephemeral）
                        <sessionId>/
                          .session.json              ← session 元数据（type='flow-session', sessionId, title）
                          objects/
                            <objectId>/
                              .flow.json             ← flow object 元数据
                              data.json              ← session 级结构化数据（ProgramSelf.getData/setData 载体）
                              threads/<threadId>/
                                thread.json          ← thread 序列化
                                debug/               ← observable 落盘的 input/output/loop 文件
                              knowledge/
                                relations/<peer>.md  ← session 层 relation（与 pool 的 long_term 配对）
                              client/pages/          ← flow 级 client 页面
                    \`\`\`

                    **关于 stones/<branch>/objects/ 中间层（2026-05-21 重组）**：
                    flow vs stone 不是 OOC Agent 才有的状态——整个 OOC World 都按
                    "stone（持久 + git）vs pool（持久 + 不 git）vs flow（单次会话）"三分；flows/ 已有 \`<sid>/objects/\`
                    把"per-Object 在该 session 的工作产物"与"session 级共享文件"分开，
                    stones/ 现在对称地用 \`<branch>/objects/\` 把"per-Object 持久身份"与"world-level 持久资源"分开，
                    pools/ 进一步用 \`objects/\` 把"per-Object 事实数据"与未来可能的"world-level pool 数据"分开。

                    这让 \`stones/<branch>/\` 根本身可承载未来的 world-level stone 资源
                    （注册表、共享知识、PR-Issue 长寿存储等），不必为它们造新的顶级目录。
                    LLM 提示词仍写 \`stones/<self>/...\`（\`session-path.ts:rewriteStonesPath\`
                    自动注入 branch 与 \`objects/\`）；只有 metaprog 协议 / scope 判定 /
                    bootstrap migration 等系统层显式知道 \`objects/\` 这一层。

                    **关于 pools/ 不挂 branch**: 与 stones/ 的 \`<branch>/\` 中间层不同，pools/ 直接挂 \`objects/\`。
                    事实是单向积累的，不应跟着 metaprog branch 切来切去（详见 pool.no_branch patch）。

                    路径计算函数：objectDir / threadDir / stoneDir / sessionDir /
                    llmInputFile / llmOutputFile / loopInputFile / loopOutputFile / loopMetaFile / poolDir
                    （poolDir 在 src/persistable/pool-object.ts）。
                    `,
                    named: {
                        ".stone.json / .flow.json / .session.json / .pool.json": "四类元数据文件，标记目录类型与归属",
                        "objectDir / threadDir / stoneDir / sessionDir / poolDir": "路径计算函数，避免散落拼接",
                    },
                },
                "stone": {
                    title: "stone - Object 的长期身份与设计源码",
                    content: `
                    stone（src/persistable/stone-object.ts）是 Object 跨 session 持续存在的部分。
                    无论 Object 参与了哪些 session，它的 stone 都是同一份。

                    **stone 是设计层（code），不是数据层（data）**：所有内容要么是身份声明，要么是源码 / schema 声明，
                    都是低频、需要 review 的"对自己的设计"。事实型数据（knowledge、记录、二进制文件）落 pool（详见
                    persistable.pool）；轨迹数据落 flow。这条边界让 stone-versioning 的 git review / PR-Issue
                    只看见真正值得审核的演化，而不是被 memory 写入这类高频脏 commit 淹没。

                    子项与用途（五件套）:
                    - self.md (stone-self.ts): 对内身份；readSelf / writeSelf；buildInputItems 时读取并注入 LlmGenerateParams.instructions。
                    - readme.md (stone-readme.ts): 对外公开介绍；其它 Object 在 collaborable.relation_window 的伴随 KnowledgeWindow 中会读到。
                    - server/index.ts (stone-server.ts): stone server 源码；readServerSource / writeServerSource，自动 mkdir。
                    - client/index.tsx (stone-client.ts): stone client 源码；readStoneClientSource / writeStoneClientSource。
                    - knowledge/ (2026-05-24 重纳): **seed knowledge**——人类设计的初始知识库；
                      与 pool 中的 sediment knowledge (memory / relations) 二分。seed 是 Object 的"先天能力基底"，
                      进 git review、可挂 eval gate；sediment 是运行时沉淀的事实，写就生效不进 git。详见 children/seed_knowledge。

                    **逻辑契约 vs 物理骨架（2026-05-24 三次修订，visibility-first）**:

                    "五件套" 是 **逻辑契约**——这 5 类内容可能存在于 stone 中，每类有明确语义角色。
                    但 \`createStoneObject\` 的**物理骨架**只预创 3 件可见小文件，其余按需 lazy mkdir:

                    | 类别 | 由 createStoneObject 预创？ | 实际创建时机 |
                    |---|---|---|
                    | .stone.json | ✓ | createStoneObject |
                    | self.md | ✓（**空文件占位**） | createStoneObject |
                    | readme.md | ✓（**空文件占位**） | createStoneObject |
                    | server/ | ✗ | 首次 writeServerSource（自带 mkdir） |
                    | client/ | ✗ | 首次 writeStoneClientSource（自带 mkdir） |
                    | knowledge/ | ✗ | 首次 seed knowledge write_file（按需） |

                    理由（visibility-first）:
                    - 预创 self.md / readme.md 空文件：让 \`ls stoneDir\` 立刻看到完整形态；
                      readSelf / readReadme 返回 ""，被 loadSelfInstructions 等消费者
                      视为 empty 等价 undefined（语义零变更）。displayName 由 Object 后续主动 writeSelf 时设置。
                    - 不预创 server/ / client/ / knowledge/：空目录"骨架不全"的视觉噪音 > 预创价值；
                      对应 writer 都自带 mkdir 兜底，按需创建零成本。
                    `,
                    named: {
                        "self.md / readme.md": "stone 的身份 + 公开介绍两件套",
                        "stone server / client": "stone 自带的服务端 / 客户端源码",
                        "knowledge/": "stone 内 seed knowledge：人类设计的初始知识库；进 git review、可挂 eval gate",
                        "seed vs sediment": "seed 在 stone（设计型，review）vs sediment 在 pool（运行时，写就生效）",
                        "createStoneObject": "创建 stone 物理骨架（.stone.json + self.md + readme.md 三件占位）；其它按需 lazy 创建",
                        "逻辑契约 vs 物理骨架": "五件套是逻辑契约（哪些可能存在）；createStoneObject 只预创 3 件可见小文件",
                        "self.md 第一行 = displayName": "UI 表层展示 objectId 时从 self.md 首行派生语义化标题；详见 visible.display_name_from_self_md",
                    },
                    children: {
                        "seed_knowledge": {
                            title: "seed_knowledge - 人类设计的初始知识库",
                            content: `
                            \`stones/<self>/knowledge/\` 是 Object 的 **seed knowledge**——人类（或 metaprog Agent）
                            预置的初始知识库，定义 Object "先天懂什么"。与 pool 中的 sediment knowledge
                            （\`pools/<id>/knowledge/memory + relations/\`，运行时沉淀的事实）相对。

                            目录形态:
                            \`\`\`
                            stones/<self>/knowledge/
                              <slug>.md         ← 一篇 seed knowledge；frontmatter + markdown body
                              <topic>/<slug>.md ← 允许按主题分组（可选）
                            \`\`\`

                            协议:
                            - 文件格式与 thinkable.knowledge 完全一致：frontmatter（title / description / activates_on）+ markdown body。
                            - 渐进激活规则与 sediment 统一；synthesizer 双源扫描，LLM 看到的不分来源。
                            - **不引入 memory/ / relations/ 子目录**——那是 sediment 的运行时分类；seed 按主题/能力命名。

                            为什么 seed 在 stone 而 sediment 在 pool:
                            - seed 是设计意图，影响 Object 的先天能力，应当过 review + eval；与 server / client 同级。
                            - sediment 是运行时事实，由 reflectable / collaborable 自动沉淀；高频累积，过 git 会让 PR-Issue 失去意义。

                            演化路径:
                            - seed knowledge 改动走 stone-versioning 的 PR-Issue 流程（与 server / client 同级，高赌注变更）。
                            - **不在 super flow 默认写入面**——reflectable 维度仅写 sediment（详见 reflectable.memory_layout）。
                            - 未来可挂 eval gate：CI 在 seed 改动时跑能力评估测试，防止能力退化。

                            访问通道:
                            - thinkable.knowledge 的 synthesizer 同时扫描 stone seed 与 pool sediment（双源加载）。
                            - 渐进激活机制（activates_on）对两侧统一适用。
                            `,
                            named: {
                                "seed knowledge": "人类设计的初始知识库；先天能力基底",
                                "双源扫描": "synthesizer 同时扫 stone seed 与 pool sediment",
                                "eval gate": "seed 改动时 CI 跑能力评估测试（待落地）",
                            },
                            sources: [["src/persistable/stone-object.ts", "stoneKnowledgeDir 返回 stones/<branch>/objects/<self>/knowledge/；createStoneObject 故意不预创该目录（seed 可选）。双源加载入口见 src/thinkable/knowledge/loader.ts:loadKnowledgeIndex，接受 { stone, pool } 两个 ref；同 idPath 冲突 sediment 胜出 + console.warn。"]],
                            todo: [
                                "eval gate 协议：seed 改动 PR 时如何挂能力评估？（未拍板）",
                            ],
                        },
                    },
                    todo: [
                        "存量数据迁移：已有 .ooc-world*/stones/<b>/objects/<id>/{knowledge/, files/} 通过 CLI 命令 migrate-stone-knowledge-to-pool 复制到 pools/objects/<id>/{knowledge/, files/}（命令已落地，仅复制不 git rm）。**注意**：2026-05-24 起 knowledge 改为 seed/sediment 二分，旧 CLI 把全部 knowledge 当 sediment 迁到 pool 是过度操作——用户在迁移后需自行判定哪些条目属于 seed 并迁回 stone（或在 worktree 内 git rm 并保留 stone 的新 seed 版本）。旧 data.json 不迁（语义已变为 session-scoped）。",
                        "存量 database/ 子目录清理：2026-05-23 创建过 stone database/ 骨架的 world 在 2026-05-24 简化中失去意义；需 CLI 检测并提示用户在 stones worktree 内 git rm（不强制，留空目录无害）。",
                    ],
                },
                "flow": {
                    title: "flow - session 内的工作轨迹",
                    content: `
                    flow 是 Object 在某个 session 内的临时运行状态。
                    session 结束后 flow 可以保留以便回看，但不影响其它 session。

                    层级（src/persistable/flow-object.ts + thread-json.ts）:
                    - session: \`flows/<sessionId>/\` + .session.json（createFlowSession 创建）。
                    - object: \`flows/<sessionId>/objects/<objectId>/\` + .flow.json（createFlowObject 创建）。
                    - thread: \`flows/<sessionId>/objects/<objectId>/threads/<threadId>/thread.json\`。

                    flow object 目录下的内容（2026-05-23 起）:
                    - \`.flow.json\`: flow object 元数据。
                    - \`threads/<threadId>/thread.json\`: thread 序列化（含 debug/ 子目录）。
                    - \`data.json\`: session 级结构化数据（详见 children/session_data，承载 ProgramSelf.getData/setData）。
                    - \`knowledge/relations/<peer>.md\`: session 层 relation（与 pool 的 long_term 配对；
                      由 collaborable.relation_window.edit(scope="session") 直接写入）。
                    - \`client/pages/<page>.tsx\`: flow 级 UI 页面（详见 visible.flow_client_pages）。

                    thread.json 的读写:
                    - writeThread: 把 ThreadContext 落盘（无 persistence 时静默跳过）；先经 stripVolatileForPersist 剥离内存字段。
                    - readThread: 反序列化后兜底处理两件事：
                      - contextWindows 为 undefined 时补成 \`[]\`。
                      - initContextWindows 兜底补 creator window（历史 thread.json 可能缺，新数据 init 时一定有）。
                      - persistence ref 被重新挂上（不写在 thread.json 里，由调用方传入）。
                    `,
                    named: {
                        "createFlowSession": "创建 session 根目录 + .session.json 的函数",
                        "createFlowObject": "创建 flow object 目录 + .flow.json 的函数",
                        "thread.json": "单条 thread 的序列化文件",
                        "writeThread / readThread": "thread.json 的最小读写接口",
                        "data.json": "flow object 的 session 级结构化数据；ProgramSelf.getData/setData 的载体",
                    },
                    children: {
                        "session_data": {
                            title: "session_data - flow 层的 data.json",
                            content: `
                            \`flows/<sessionId>/objects/<objectId>/data.json\` 是 Object 在 **该 session 内**
                            的结构化数据载体。承载 ProgramSelf.getData / setData 的读写
                            （详见 programmable.program_self_injection）。

                            **历史变更（2026-05-23）**：
                            - 原 stone 层 \`stones/<self>/data.json\`（顶层 spread merge）已删除。
                            - getData/setData 不再是"跨 session 长期数据"，而是 **session 级临时数据**——
                              语义边界与 flow 层定位一致。
                            - 真要跨 session 共享，应通过 stone server method 写 pool/data csv（结构化）或
                              pool/knowledge md（半结构化）。

                            形态:
                            - 顶层 JSON object；setData 是顶层 spread merge 而非整体覆盖（API 形状保留）。
                            - 文件不存在时 readData 返回空 object \`{}\`，getData(key) 返回 undefined。
                            - 写盘前 mkdir flow object 目录；并发写复用 flow object 级串行化键
                              （src/persistable/flow-data.ts，串行键前缀 \`flow-data:\`）。

                            **语义影响（升级时注意）**：
                            如果 server method 实现者历史上依赖 "在 session A 写的，session B 能读到"，
                            迁移后这种用法将失效——读到的永远是当前 session 的 data.json。
                            想保留旧语义需要显式改写为走 pool/data csv。
                            `,
                            named: {
                                "data.json": "flow object 的 session 级 JSON 数据",
                                "顶层 spread merge": "setData(key, value) 等价于 \`{ ...current, [key]: value }\`",
                                "session-scoped 语义": "data.json 不再跨 session 共享；这是 2026-05-23 起的语义变化",
                            },
                        },
                    },
                },
                "pool": {
                    title: "pool - Object 的事实型数据存储",
                    content: `
                    pool 是 Object 的"事实层"——跨 session 累积、不进 git、与 stone（设计层）和 flow（运行层）三分。

                    设计动机:
                    - stone 是设计性、低频、要 review 的源码与身份；走 git + PR-Issue。
                    - flow 是单次会话的临时轨迹；session 结束即可归档。
                    - 但 server-type Agent 需要的"高频追加事实"（记录、知识、二进制文件）两边都不合适：
                      过 git 让 stone history 充满"我又写了一条 memory"的脏 commit，PR-Issue 失去意义；
                      flow 又是 ephemeral，跨 session 累不起来。
                    - 因此引入 pool 作为第三层，专门承载"持久但不版本化"的事实。

                    三分总览:
                    | 层 | 内容 | 形态 | git | review |
                    | stone | 设计 | 身份 + 源码 + seed knowledge | 是 | PR-Issue |
                    | pool  | 事实 | csv 表 + markdown + 文件 | 否 | 写就生效 |
                    | flow  | 运行 | thread.json + debug | 否 | 即用即弃 |

                    pool 顶层挂两类事实（**2026-05-24 起拓宽**）:

                    - **per-Object 事实**（\`pools/objects/<id>/\`）：单个 Object 累积的数据
                      - data/: **csv 结构化数据**（2026-05-24 起替代 sql）；一张表一个文件 \`<name>.csv\`；
                        首行 header，后续行记录；详见 children/data_pool。
                      - knowledge/: **sediment-only** markdown 知识文档（memory/<slug>.md / relations/<peer>.md）；
                        由 reflectable / collaborable 在运行时自动沉淀，写就生效不进 git。
                        与 stone 中的 **seed knowledge**（\`stones/<self>/knowledge/<slug>.md\`，人类设计的初始知识库）配对——
                        二者都被 thinkable.knowledge 的 synthesizer 双源扫描激活。详见 children/knowledge_pool。
                      - files/: 任意文件留存位（二进制、大体量、非结构化 blob 等）。
                    - **World 级共享单元**（\`pools/repos/\`）：跨 Object 协作的外部 git repo
                      （工作中涉及的所有外部业务 repo 统一管理于此；详见 children/repos_pool）。
                      不挂在任何 Object 下，因为它是多 Object 协作的共享单元，不是 per-Object 资产。

                    路径形态:
                    \`\`\`
                    pools/
                      objects/<objectId>/          ← per-Object 事实
                        .pool.json
                        data/<name>.csv
                        knowledge/memory/<slug>.md
                        knowledge/relations/<peer>.md
                        files/...
                      repos/<repo-name>/           ← World 级共享外部 git repo
                        .git/
                        ...working tree（默认 default branch）
                    \`\`\`

                    pool 不挂 metaprog branch（与 stones/<branch>/ 不同），因为事实是单向积累的——
                    metaprog branch 切换不带数据走。csv 列变更直接改文件（无 migration 概念）。
                    （注意：\`pools/repos/<name>/\` 内部当然有自己的 git branch，那是外部 repo 自身的 branch，
                    与 OOC 的 metaprog branch 是两码事。）
                    `,
                    named: {
                        "pool": "Object 的事实型数据层；持久但不版本化",
                        "pools/objects/<id>/": "pool 中 per-Object 事实的挂载点",
                        "pools/repos/<name>/": "pool 中 World 级共享外部 git repo 的挂载点（2026-05-24）",
                        "三分: stone / pool / flow": "OOC 持久层的设计 / 事实 / 运行三分",
                        "data csv": "pool 中结构化数据的载体（2026-05-24 起替代 sql）；一张表 = 一个 .csv 文件",
                        "外部 repo 统一管理": "工作中涉及的所有外部 git repo 都落在 pools/repos/，不散落到 Object 个体下",
                    },
                    children: {
                        "data_pool": {
                            title: "data_pool - 结构化数据（csv）",
                            content: `
                            \`pools/objects/<id>/data/<name>.csv\` 是 Object 的结构化数据载体
                            （**2026-05-24 起替代 sql；删 bun:sqlite + migration runner，回归简单**）。

                            形态约束:
                            - **一张表 = 一个 csv 文件**：\`data/factors.csv\` / \`data/users.csv\` / \`data/metrics.csv\` ...
                            - 首行 header（列名），后续行记录；逗号分隔；标准 csv 转义。
                            - 命名 kebab-case，对应 Object 内"逻辑表名"。
                            - 无 schema 声明文件：列即文件第一行；列变了直接改文件，无 forward-only migration 概念。

                            为什么用 csv 而不是 sql:
                            - **实现简单**：用现有文件操作能力（fs.readFile / write）即可读写；不引入 bun:sqlite 依赖
                              / 不要 connection cache / 不要 migration runner。
                            - **可读性强**：csv 是人类可直接审阅、用 LLM file_window.open 直接看的格式；
                              sql 行需要解码才能看见。
                            - **够用**：OOC 当前阶段不需要复杂查询 / 索引 / 并发事务；中小规模数据（< 几万行）csv 全表扫即可。
                            - **未来留口**：真有 sql 需求（如百万行级数据、复杂聚合）时再重新引入 sql_pool，
                              与 data_pool 并存即可；当前保持精简。

                            访问通道（**LLM 路径直接可见，是合法例外**）:
                            - LLM 可通过 \`file_window.open path="pools/<self>/data/<name>.csv"\` 直接读 csv；
                              也可通过 \`file_window.edit\` 编辑（小批量写）。
                            - 大批量写 / 复杂查询应包装为 stone server method（语义化命令，如
                              \`exec(command="upsert_factor", args={...})\` / \`query_factors_by_psm\`），
                              method 内部用 fs API + csv 解析库读写。
                            - 与 knowledge md 同属 pool 路径暴露例外（详见 patches.llm_access_via_server_method）。

                            并发与一致性:
                            - csv 整文件写：用 \`enqueueSessionWrite('data:'+baseDir+':'+objectId+':'+name)\` 串行化，避免读写撕裂。
                            - 不支持复杂事务；如果数据一致性要求强，应用层（server method）自己保证（write-then-rename 等）。

                            适用场景:
                            - 中小规模结构化数据（< 几万行）：因子库、用户列表、metrics 快照、配置表。
                            - 需要人/LLM 直接审阅的数据。
                            - 不需要复杂查询的简单表格。

                            不适用场景（未来再考虑 sql）:
                            - 百万行级数据 / 复杂聚合查询。
                            - 高频并发事务。
                            - 需要二级索引 / 全文搜索 / 向量检索。
                            `,
                            named: {
                                "data/<name>.csv": "Object 的一张表；首行 header，后续行记录",
                                "csv 作为 sql 的简化替代": "2026-05-24 起 OOC 用 csv 替代 sql；未来真有需求再引入 sql_pool",
                                "enqueueSessionWrite('data:...')": "csv 整文件写串行化键，避免读写撕裂",
                                "无 migration 概念": "csv 列变更直接改文件；不存在 forward-only migration 流程",
                            },
                            sources: [
                                [
                                    "src/persistable/csv-pool.ts + src/persistable/pool-object.ts:poolDataDir/poolDataFile",
                                    "数据载体实现两处合并锚点：csv-pool.ts 提供 readCsv / writeCsv / appendRow（含 write-then-rename 原子写）；pool-object.ts 的 poolDataDir(ref) 返回 pools/objects/<id>/data/、poolDataFile(ref, name) 返回 .csv 全路径并对 name 做 kebab-case 校验防 path-traversal。",
                                ],
                            ],
                        },
                        "knowledge_pool": {
                            title: "knowledge_pool - sediment markdown 知识文档",
                            content: `
                            \`pools/objects/<id>/knowledge/\` 是 Object 的 **sediment knowledge** 仓库
                            ——Agent 运行时由 reflectable / collaborable 自动沉淀的事实型知识；不进 git。

                            与 **seed knowledge**（\`stones/<self>/knowledge/\`，人类设计的初始知识库）二分:
                            - seed: 设计意图，按主题/能力命名；进 git review，可挂 eval gate；详见 persistable.stone.children.seed_knowledge。
                            - sediment: 运行时事实，按 memory / relations 分类；写就生效，不过 PR-Issue review。

                            标准子目录（仅 sediment）:
                            - \`memory/<slug>.md\`: 长期记忆；reflectable 的主要写入位置，每条记忆一个文件，slug 用 kebab-case。
                            - \`relations/<peer>.md\`: 对各 peer 的 long_term 关系认知；与 collaborable.relation_window 联动
                              （session 层 relations 仍在 flows/<sid>/objects/<self>/knowledge/relations/）。

                            形态约束:
                            - 一个文档 = 一个 markdown 文件；不引入 collection / docId 抽象。
                            - 不需要索引：knowledge 量级通常 <1000 篇，渐进激活靠 activates_on 而非数据库索引。
                            - 不需要 migration：schema 即文件结构本身（memory/、relations/）。

                            访问通道:
                            - thinkable.knowledge 的 synthesizer **双源扫描**：同时扫 stone 的 seed 与 pool 的 sediment，
                              frontmatter / activates_on 协议统一，LLM 看到的不分来源。
                            - LLM 写入：reflectable.memory_layout 规定的写盘协议；通过 super flow 的 write_file 命令落盘。
                              注意 super flow **只写 sediment**——seed 改动属于设计变更，走 stone-versioning PR-Issue。
                            - 直接读取：collaborable.relation_window 派生的伴随 KnowledgeWindow 读 long_term 段。
                            `,
                            named: {
                                "memory/<slug>.md": "长期记忆条目；一条一文件（sediment）",
                                "relations/<peer>.md": "对各 peer 的 long_term 认知文件（sediment）",
                                "sediment vs seed": "sediment 在 pool（运行时沉淀）vs seed 在 stone（人类设计）；双源扫描统一激活",
                                "schema 即文件结构": "knowledge 的 schema 就是文件路径约定本身（memory/、relations/）",
                            },
                        },
                        "files_pool": {
                            title: "files_pool - 任意文件留存位",
                            content: `
                            \`pools/objects/<id>/files/\` 是 Object 的通用文件目录。

                            典型用途:
                            - 二进制附件（PDF、图片、音视频）。
                            - 大体量文本（日志、长文档）。
                            - embedding shard / 模型权重等大体量非结构化 blob。
                            - 用户上传 / 外部抓取的原始资料。

                            形态约束:
                            - 不限定子目录结构；由 Object 自己的 server method 维护命名约定。
                            - 不进 git——纯文件系统。
                            - 大体量备份是部署/运维事，不是 OOC 概念事（cron + cp 即可）。

                            与 data/ 的边界: data/ 是**结构化表格**（csv，列固定，可查询）；files/ 是**非结构化 blob**
                            （二进制 / 大文本 / 不打算用 csv 表达的任意内容）。一行能映射到 csv 的就进 data/，不能的进 files/。
                            `,
                            named: {
                                "files/": "pool 的通用文件目录；二进制 / 大文件 / 非结构化 blob",
                                "data/ vs files/": "data 是结构化 csv 表，files 是非结构化 blob",
                            },
                        },
                        "repos_pool": {
                            title: "repos_pool - 外部 git repo 工作面（World 级共享）",
                            content: `
                            \`pools/repos/<repo-name>/\` 是 OOC world **统一管理外部 git repo 的工作面**
                            （2026-05-24 引入）。工作中涉及到的所有外部 git repo（业务代码库、第三方依赖 fork、
                            协作项目等）都统一落在这个目录，不散落到各 Object 私有目录下。

                            **位置选择**: 挂在 pool 顶层（与 \`pools/objects/\` 平级），不挂在任何 Object 下。
                            理由:
                            - repo 是 World 级共享单元，多个 Object 可能都要协作同一个 repo；放 per-Object
                              会让"协作"退化为"各自 fork 一份"——既冗余又破坏唯一事实源。
                            - repo 仍属事实层（不是 OOC 自己的设计），所以挂 pool 而非 stone；不是 OOC 自治
                              资源，但归 OOC 统一管理。

                            **顶层规范（约定）**:

                            1. **统一目录**: 工作中涉及的所有外部 git repo 都 clone 到 \`pools/repos/<name>/\`；
                               不允许散落到 \`pools/objects/<id>/repos/\`、\`flows/<sid>/.../repos/\` 等位置。
                               （session 临时 worktree 可派生到 flow，见下文，但 repo 本体只有一份在 pools/repos/。）
                            2. **repo-name**: 用规范化的简短名（如 \`ooc\`、\`riffrec\`、\`vendor-foo\`），
                               不必与 remote url 一致。命名冲突由 Agent 在 clone 时检测。
                            3. **OOC 不追踪**: pools/repos/ 整体在 OOC 的 .gitignore 内（pool 不进 OOC 的 git）；
                               但 repo **自带的 .git** 当然由 repo 自己管理。
                            4. **修改权**: 任何 Object 都可访问；并发协调由 git branch + talk_window 完成
                               （详见"多 Agent 协作"段）。

                            **目录形态**:
                            \`\`\`
                            pools/repos/<repo-name>/
                              .git/                    ← 外部 repo 自带的 git history（OOC 不动）
                              ...working tree (default branch)
                            \`\`\`
                            （是否需要 \`.repo.json\` 元数据记录 origin url / clone 时间等，**待落地时再拍板**——
                            最简实现可不要，远程 url 直接读 \`.git/config\`。）

                            **多 Agent 协作的协议**:

                            \`pools/repos/<name>/\` 是 main worktree（持有完整 git history）。多个 Object 想并发
                            工作时，**不直接共享同一 working tree**（这违反 OOC "不共享 Context" 原则）；
                            而是用 git worktree 派生：

                            - **持久 worktree**（Object 长期维护某 repo）：派生到
                              \`pools/objects/<id>/repo-worktrees/<name>/\`，checkout 自己的 branch。
                            - **session 临时 worktree**（一次性任务）：派生到
                              \`flows/<sid>/objects/<id>/repo-worktrees/<name>/\`，session 结束 \`git worktree remove\`。

                            协调流程: Agent X 在自己 branch 工作 → push 到 pools/repos/<name> 自身（互作 origin）→
                            通过 talk_window 通知 review/merge → main 上的 merge 由整合 Agent 或人类拍板。

                            **LLM 路径暴露的例外**:

                            pool 原则是"LLM 不直接看物理路径，一律走 stone server method"（详见 patches.llm_access_via_server_method）。
                            repos 是**合法例外**——开发场景下 LLM 必须看到 repo 内的文件路径才能 \`file_window.edit\`。
                            这与 knowledge md 直接进 LLM 视野的例外同构。

                            **与 .stones_repo 的关系**:

                            \`.stones_repo\` 是 OOC world **自身**的 metaprog repo（管理 stones 演化）；
                            \`pools/repos/<name>/\` 是 Object 们协作的**外部业务** repo。模型同构（bare/main + worktrees），
                            但语义边界清晰：metaprog repo 是 OOC 内部基础设施，外部 repo 是 OOC 之外的工作对象。
                            `,
                            named: {
                                "pools/repos/<name>/": "外部 git repo 在 OOC world 内的统一工作面",
                                "repos_pool": "pool 顶层的第四种内容形态：World 级共享外部 repo",
                                "外部 repo 统一管理": "工作中涉及的所有外部 git repo 都进 pools/repos/，不散落",
                                "repo-worktrees/": "Object 或 session 从主 repo 派生的 git worktree 目录名约定",
                                "main worktree + 派生 worktree": "多 Agent 协作模式——main 在 pools/repos/，per-Object/per-session 工作面用 git worktree 派生",
                                "LLM 路径例外": "repos 内文件路径合法暴露给 LLM（与 knowledge md 同构），不走 server method 透明化",
                            },
                            todo: [
                                "首批落地路径函数：repoDir(baseDir, name) / repoWorktreeDir(poolObjectRef, name) / sessionRepoWorktreeDir(flowObjectRef, name)。",
                                "是否引入 .repo.json 元数据（origin url / 上次同步时间 / 管理 Agent 引用）？等真有用例再决定。",
                                "命名冲突协议：两个 Object 都想 clone 同一 url 但起不同 name，或不同 url 抢同一 name；clone 时显式检查。",
                                "worktree 生命周期回收：session 结束应自动 git worktree remove flow 层 worktree；pool 层 worktree 谁回收？",
                                "main 上的 merge 由谁拍板（'整合 Agent' 角色 vs 人类必经）——未拍板。",
                                "与 Object≡repo 远景的协调路径：详见 docs/2026-05-24-draft-object-as-repo.md。",
                            ],
                        },
                    },
                    patches: {
                        "no_branch": {
                            title: "pool 不挂 metaprog branch",
                            content: `
                            \`pools/objects/<id>/\` 不像 stones/<branch>/objects/<id>/ 那样挂 metaprog branch。
                            \`pools/repos/<name>/\` 同理（虽然 repo 内部自带 git branch，但那是外部 repo 自己的事，
                            与 OOC metaprog branch 无关）。

                            理由:
                            - 事实是单向累积的：用户产生的真实数据不应跟着 metaprog branch 切来切去。
                            - csv 列变更直接改文件，不需要 branch 隔离（无 migration 概念）。
                            - 数据回滚不是 OOC 的语义层概念：备份是运维事（cron + cp），不是维度事。
                            - 外部 repo 的 branch 切换是 repo 自己的事；OOC 不在 pool 路径布局里反映它。

                            metaprog branch 在沙箱测试想要"试探性改 csv"，可从 main 复制一份临时 data/ 目录隔离测试；
                            merge 后丢弃。但这不是 pool 路径布局要表达的事。
                            `,
                        },
                        "design_in_stone_data_in_pool": {
                            title: "design-in-stone, data-in-pool 原则（轻量版）",
                            content: `
                            这条原则横跨 stone 与 pool 两侧（2026-05-24 起从 "schema-in-stone" 简化为 "design-in-stone"，
                            因为删除了 sql / migration 工程化重量级）:

                            **stone 持有数据"如何被理解"的设计**:
                            - knowledge seed：人类预置的能力基底（stones/<self>/knowledge/<slug>.md）。
                            - server method 源码：Object 对外暴露的语义命令（query_X / upsert_Y 等）。
                              这些命令体现"数据应该如何被读写"，是真正的数据契约设计。
                            - self.md：身份层对数据语义的高层约定（如"我管理因子库"）。

                            **pool 持有数据本身**:
                            - csv 表在 \`pools/objects/<id>/data/<name>.csv\`（结构化）。
                            - knowledge 文档在 \`pools/objects/<id>/knowledge/\`（**仅 sediment**；seed 在 stone）。
                            - 文件在 \`pools/objects/<id>/files/\`（非结构化）。

                            **csv 没有显式 schema 文件**:
                            - csv 列定义就是文件第一行；列变了直接改 csv，无 forward-only migration 流程。
                            - 如需 TS 类型，可在 server/ 源码里 inline 定义（如 \`type Factor = { psm: string; ... }\`），
                              或将来若需要可加 \`stones/<self>/types/\` 目录——但当前不强制。

                            **访问通道**:
                            - csv：LLM 可直接 file_window.open 读路径；大批量/复杂查询包装为 server method。
                            - knowledge md：双源扫描渐进激活；不暴露文件路径。
                            - files：必须经 server method（路径对 LLM 透明）。
                            `,
                        },
                        "knowledge_no_git": {
                            title: "sediment knowledge 不进 git；seed 仍在 stone 走 git review",
                            content: `
                            2026-05-24 起，knowledge 按生成来源拆分为 seed / sediment 二分，落盘位置随之分离:

                            **sediment knowledge**（运行时沉淀，落 pool，**不进 git**）:
                            - \`pools/<id>/knowledge/memory/<slug>.md\` —— reflectable 自反思写入
                            - \`pools/<id>/knowledge/relations/<peer>.md\` —— collaborable long_term 写入
                            - 写就生效，不过 PR-Issue review；如果某条 memory 写错，让 reflectable 直接覆盖即可。
                            - 整树回滚不在 OOC 语义层（pool 不分版本，靠外部备份）。

                            **seed knowledge**（人类设计的初始知识库，留在 stone，**进 git review**）:
                            - \`stones/<self>/knowledge/<slug>.md\` —— 设计者预置的能力基底
                            - 走 stone-versioning 的 PR-Issue 流程；可挂 eval gate 防能力退化。
                            - 不在 super flow 默认写入面（与 server / client 同级，高赌注变更）。

                            这条边界对应能力来源的二分:
                            - 能力的"先天"部分（设计者赋予）需要严格 review + eval —— seed in stone。
                            - 能力的"后天"部分（运行中沉淀）需要低摩擦累积 —— sediment in pool。

                            seed 影响 Agent 先天能力，应当版本管理 + 评估测试。详见 persistable.stone.children.seed_knowledge。
                            `,
                        },
                        "llm_access_via_server_method": {
                            title: "LLM 不直接读写 pool，走 stone server method（含例外清单）",
                            content: `
                            pool 的物理路径默认不应出现在 LLM 的视野里——LLM 应通过 stone server method 间接访问。

                            访问规则（默认）:
                            - LLM 通过 \`exec(window_id="custom:<self>", command="<name>", args={...})\` 调用 stone server method。
                            - 或 program.callCommand 在 ts/js sandbox 里 \`await self.callCommand("custom:<self>", "<name>", {...})\`。
                            - server method 内部使用 fs API（含 csv 解析）操作 pool 文件。

                            **合法例外清单**（这些 pool 子树的路径/文件 LLM 直接可见，且这是有意为之）:

                            1. **knowledge md**（pools/<id>/knowledge/{memory,relations}/）——通过 thinkable.knowledge
                               的 synthesizer 渐进激活作为 \`knowledge_window\` 出现在 Context 里；LLM 看见的是知识正文。
                               写入仍走 reflectable 的 super flow write_file 协议（详见 reflectable.memory_layout）。
                            2. **data csv**（pools/<id>/data/<name>.csv）——LLM 可直接 \`file_window.open\` 读 csv；
                               小批量 \`file_window.edit\` 写。复杂查询/大批量写仍包装为 server method。
                            3. **repos 内文件**（pools/repos/<name>/...）——开发场景下 LLM 必须看到 repo 内的文件
                               路径才能 \`file_window.edit\` / \`grep\` / \`glob\`。

                            三种例外的共性：**LLM 的工作面**（直接读写有价值），不是 OOC 内部数据黑箱。

                            **不在例外清单的**：files/ 下二进制——必须经 server method 访问，
                            路径对 LLM 透明，让 Object 自治掌控数据契约。
                            `,
                        },
                    },
                    todo: [
                        "data pool runtime：csv 读写工具已落地于 src/persistable/csv-pool.ts（手写 RFC 4180 子集）；如未来需要 queryRows / bulk update / 索引，再增量加。",
                        "params schema 校验（与 programmable.todo 重叠）：如未来需要，server method 命令的 params 类型可在 server/index.ts 内 inline 定义；当前不强制。",
                        "**csv schema drift 可观测性**（AgentOfExperience 2026-05-24 反馈）：csv-pool 不校验 row.keys 与 header 一致性（务实选择——appendRow typo 会静默丢字段）。短期为 known-limitation；长期建议给 observable 维度加 'csv health' 诊断（启动期或 reflectable 主动扫一遍 row.keys 与 header 差异，warn 出异常 csv）。",
                    ],
                },
                "debug_files": {
                    title: "debug_files - 与 observable 协作的落盘",
                    content: `
                    src/persistable/debug-file.ts 提供 debug 文件的路径计算与写入接口；observable 负责"何时写 / 写什么"。

                    路径（统一在 \`<threadDir>/debug/\` 下）:
                    - llm.input.json / llm.output.json: 始终覆盖式写入最近一次 LLM 调用。
                    - loop_NNNN.input.json / loop_NNNN.output.json / loop_NNNN.meta.json: loop-level debug 文件
                      （loopIndex 4 位 0 padding；enableDebug 开启后才写）。

                    写入接口:
                    - writeDebugInput / writeDebugOutput: 始终落盘的两份。
                    - writeLoopDebugInput / writeLoopDebugOutput / writeLoopDebugMeta: loop-level 三份。
                    - 所有写入前自动 mkdir(debugDir, { recursive: true })。

                    类型:
                    - LlmInputDebugRecord: { threadId, inputItems, contextSnapshot? }。
                    - LlmOutputDebugRecord: { threadId, outputItems, provider?, model? }。
                    - LlmLoopDebugMetaRecord: 见 src/persistable/debug-file.ts LlmLoopDebugMetaRecord，包含 latency / messageCount / status / error 等观测指标。
                    `,
                    named: {
                        "debugDir": "thread 的 debug 子目录路径",
                        "llm.input.json / llm.output.json": "最近一次 LLM 调用的两个常驻文件",
                        "loop_NNNN.*.json": "loop-level 三类文件",
                    },
                },
                "refs": {
                    title: "refs - 四种 ref 抽象",
                    content: `
                    src/persistable/common.ts 定义了四种 ref，承担所有路径计算的入口:

                    \`\`\`
                    FlowObjectRef        = { baseDir, sessionId, objectId }
                    ThreadPersistenceRef = FlowObjectRef & { threadId }
                    StoneObjectRef       = { baseDir, objectId }
                    PoolObjectRef        = { baseDir, objectId }   ← 2026-05-23 引入；与 Stone 同形状，语义不同
                    \`\`\`

                    转换:
                    - deriveStoneFromThread(threadRef): { baseDir: threadRef.baseDir, objectId: threadRef.objectId }，
                      让 program / server / 反思场景从 thread 切到 stone 视角。
                    - derivePoolFromThread(threadRef): 同形状返回 PoolObjectRef，让 server method 切到 pool 视角访问数据
                      （src/persistable/pool-object.ts）。

                    设计要点:
                    - ref 是纯数据，不持有句柄；可以自由序列化、跨进程传递。
                    - 所有路径函数（objectDir / threadDir / stoneDir / sessionDir / poolDir）输入是 ref，输出是绝对路径字符串。
                    - 其它层（executable / thinkable）从不直接拼 path，统一通过 ref + helper。
                    - StoneObjectRef 与 PoolObjectRef 形状相同（都是 \`{ baseDir, objectId }\`）但语义不同；
                      用类型区分而非字段区分，避免误用。
                    `,
                    named: {
                        "FlowObjectRef": "{ baseDir, sessionId, objectId }",
                        "ThreadPersistenceRef": "FlowObjectRef + threadId",
                        "StoneObjectRef": "{ baseDir, objectId } —— 定位 stone 目录",
                        "PoolObjectRef": "{ baseDir, objectId } —— 定位 pool 目录",
                        "deriveStoneFromThread": "从 thread ref 派生 stone ref",
                        "derivePoolFromThread": "从 thread ref 派生 pool ref（src/persistable/pool-object.ts）",
                    },
                },
            },
            patches: {
                "strip_volatile_for_persist": {
                    title: "持久化前剥离 in-process 字段",
                    content: `
                    stripVolatileForPersist（src/persistable/thread-json.ts）在 writeThread 前剥离纯内存字段:
                    - BaseContextWindow._decayMeta（P0d 自然衰减计数器，冷启动重算无副作用）
                    - compressLevel === 0 或 undefined（默认值不持久化）

                    持久化保留的下划线字段（与剥离相反）:
                    - ProcessEvent._foldedBy（P0f events fold 锚点）必须持久化，否则 reload 后丢失 fold 状态

                    新增 in-process 字段时在这里扩。
                    `,
                },
                "read_thread_bootstrap_creator_window": {
                    title: "readThread 兜底补 creator window",
                    content: `
                    readThread 反序列化后调用 initContextWindows 兜底:
                    - 历史 thread.json 可能没写 creator do_window / talk_window。
                    - initContextWindows 幂等插入（同 id 已存在则跳过）。
                    - user.root / self-driven root 跳过（详见 collaborable.creator_window）。

                    这样新代码可以假定"任何从磁盘读出的 thread 都有合规的 creator window"，
                    不需要在业务逻辑里到处兜底。
                    `,
                },
                "super_session_lazy_create": {
                    title: "super session 懒创建 .session.json",
                    content: `
                    talk-delivery 在派送到 super 时（reflectable.super_alias_target）才检查并创建 super session 元数据:
                    - 只在 .session.json 不存在时调用 createFlowSession(baseDir, 'super', 'OOC self-reflection')。
                    - 避免重复创建覆盖已有 title。

                    这让 super session 不必在系统启动时预创建；只有真的发生第一次反思派送，才在磁盘上出现。
                    `,
                },
                "stone_versioning": {
                    title: "stone-versioning - stones/ 的 git 版本管理（bare repo + linked worktrees）",
                    content: `
                    stones/ 目录采用 **bare repo + linked worktrees** 模式：
                    - \`stones/.stones_repo/\`：bare git repo（\`bare = true\`），承载所有 refs / objects /
                      packed-refs / 远端关系等元数据；自身不是任何分支的 checkout
                    - \`stones/main/\`：main 分支的 linked worktree，agent 文件直接位于其下（如
                      \`stones/main/agent_of_x/self.md\`）；其 \`.git\` 是个**文件**（不是目录），
                      内容形如 \`gitdir: …/.stones_repo/worktrees/main\`
                    - \`stones/{branch}/\`：其它分支的 linked worktree（如 \`stones/metaprog/agent_of_x/abc123/\`），
                      跟 main 平级共享同一 bare；删 main 不破坏其它 worktree
                    - pools/、flows/、debug/ 等运行时产物不入 git（R2）

                    架构对称性：main 不再是"主仓库"，跟未来添加的任何 worktree 平级。
                    新 worktree 通过 \`git -C stones/.stones_repo worktree add ../{name} {branch}\` 加挂。
                    （灵感来自 plugins_worktrees 的 \`.plugins_repo/\` 模式。）

                    OOC Server 启动接受 \`--stones-branch=<name>\`（默认 main），所有 stoneDir 解析为
                    \`{baseDir}/stones/{stonesBranch}/objects/{objectId}\`（2026-05-21 起 \`objects/\`
                    中间层，详见 world_layout）。Object 想做高赌注修改时不直接写 main，
                    通过 metaprog 协议（programmable.metaprog_protocol）开 worktree → 编辑 → 试运行 → commit → merge。

                    路径划界（R5/R6）：commit 累积 diff（vs main merge-base）的所有路径都以 \`objects/{authorObjectId}/\`
                    开头 → self-scope，自治 fast-forward merge；任一路径越界 → cross-scope，整 commit 走 PR-Issue
                    给 supervisor 评审（classifyWorktreeBranch prefix = \`objects/<authorObjectId>/\`）。
                    关于 supervisor 的两个"R12"指不同约束，须区分：
                    (1) **路径绕过限制已撤销**（2026-05-25）——supervisor 走与其它 Object 同款的前缀判定，
                        \`objects/supervisor/\` 下为 self-scope ff merge，跨自治区同样自动开 PR-Issue（可由 supervisor 自审）。
                    (2) **rollback 的 supervisor-only 强制仍在**——rollback 是治理操作，src/persistable/stone-versioning.ts
                        强制 supervisorAuthor === SUPERVISOR_OBJECT_ID（FORBIDDEN），不属于 worktree 路径特殊化。

                    错误自我编程的恢复（F3）：启动期 recovery-check 自检每个 Object 的 server/index.ts；
                    加载失败的开 [recovery-needed] PR-Issue 给 supervisor，由 supervisor metaprog rollback。

                    布局演化兼容：早期非 bare 形态（\`stones/main/.git/\` 是目录）被识别为
                    \`layout: "legacy-embedded"\`，保持原状不强制升级；新建 world 一律走 bare。

                    **2026-05-23 起 git 追踪面收缩到设计层**（2026-05-24 修订五件套）:
                    sediment knowledge / data.json / files 已迁出 stone（详见 persistable.pool 与 persistable.stone）。
                    stone 现在只有 self.md / readme.md / server / client / knowledge 五件套全部进 git
                    （其中 knowledge 是 seed knowledge——人类设计的初始知识库；2026-05-24 删除 database/ 后五件套定型）。
                    PR-Issue review 不再被 memory 写入这类高频脏 commit 淹没；
                    每个 commit 都是真正的设计演化（身份 / 源码 / seed knowledge）。
                    `,
                    named: {
                        "stone-versioning": "persistable 内的高层编排，封装 worktree / commit / 路径划界 / merge / PR-Issue / rollback",
                        "stone-git": "stone-versioning 底层的 git CLI 薄包装；不引入 git npm 依赖",
                        "stones-branch": "OOC Server 启动参数；指定本进程绑定的 git 分支，决定 stoneDir 解析根",
                        ".stones_repo": "stones/ 下的 bare git repo 目录；承载所有 git 元数据，与任何 worktree 物理分离",
                        "linked worktree": "git worktree 模式下的非主工作树；其 .git 是文件不是目录，gitdir 指回 bare 的 worktrees admin",
                        "metaprog worktree": "Object 元编程的隔离工作树；branch 形态 metaprog/{objectId}/{token}",
                        "self-scope / cross-scope": "路径划界判定结果；前者自治 ff merge，后者必须经 PR-Issue",
                        "PR-Issue": "落在 super session 的 Issue（带 prPayload diff/branch/intent）；Supervisor 评审通道",
                        "recovery-check": "启动期自检；server/index.ts 加载失败的 Object 自动开 [recovery-needed] PR-Issue 给 supervisor",
                        "Bootstrap commit": "首次启动 author=bootstrap 的一次性 squash commit，通过临时 clone scratch 灌入 bare repo 后 push",
                        "legacy-embedded": "已有 world 的非 bare 老式布局（main/.git/ 是目录）；ensureStoneRepo 兼容识别但不强制升级",
                        "git 追踪面 = stone 五件套": "self.md / readme.md / server / client / knowledge（seed）；sediment knowledge / data.json / files 已迁出",
                    },
                    sources: [
                        [
                            "src/persistable/stone-versioning.ts",
                            "openMetaprogWorktree / commitWorktree / classifyWorktreeBranch / tryMergeSelf / requestPrIssueReview / resolvePrIssue / rollback / pruneStaleWorktrees；R12 supervisor 例外（rollback 在 persistable 层强制 supervisorAuthor === SUPERVISOR_OBJECT_ID，FORBIDDEN code）；所有 git 操作通过 enqueueSessionWrite('git:'+baseDir) 串行；底层 git 命令在 src/persistable/stone-git.ts；bare init + linked worktree 编排在 src/persistable/stone-bootstrap.ts:ensureStoneRepo (createBareRepoWithMainWorktree 处理 bootstrap commit 通过 scratch clone 灌入 bare，末尾自动调 pruneStaleWorktrees)；启动期 recovery-check 在 src/app/server/bootstrap/recovery-check.ts",
                        ],
                    ],
                    patches: {
                        "seed_trust_chain_and_hierarchy": {
                            title: "seed 信任链 + parent-child 修改权如何落在路径划界上",
                            content: `
                            本节是 root.patches.object_relations 里"parent 拥有 child seed""seed 信任链锚定 user"
                            两条的 persistable 实现侧。

                            **parent 改 child seed 天然是 self-scope（已被现有路径划界支持）**:
                            child Agent 物理嵌套在 objects/<parent>/children/<child>/。parent（authorObjectId=<parent>）
                            改 child 的 seed 时，commit 路径以 objects/<parent>/ 开头 → 命中 self-scope，自治 ff merge。
                            反之 child（authorObjectId=<parent>/<child>）改 parent 自己的 objects/<parent>/self.md →
                            不以自己前缀开头 → cross-scope 越界，走 PR-Issue。于是"parent 拥有整个 children 子树的 seed、
                            child 不能改 parent"被路径前缀规则**自动表达**，无需新机制。
                            （注意: 这是对现有 self-scope 前缀语义的解读；跨 object 授权的显式校验仍是 design-ahead-of-code。）

                            **seed 信任链的根闸门 = user（design-ahead-of-code）**:
                            cross-scope 的 PR-Issue 给上层 parent / Supervisor 评审，一级一级往上。但 root（Supervisor）
                            自身的 seed 改动谁把关？按 root.patches.object_relations，是 **user**（树外终极 reviewer，
                            通过真人 git review）——而非 root self-approve，否则 root 成不受约束的特权奇点。
                            注意区分: R12 的"supervisor 元自治例外"仅指 **rollback 操作的权限**（只有 supervisor 能 rollback）；
                            它**不等于**"supervisor 改自己的 seed 无需任何把关"。user-review-supervisor-seed 这一层当前
                            尚未在代码中实现。
                            `,
                            named: {
                                "self-scope 覆盖子树": "parent 的 objects/<parent>/ 前缀天然覆盖 children/<child>/，故 parent 改 child seed 自治",
                                "根闸门": "root（Supervisor）的 seed 由 user 通过真人 git review 把关；非 self-approve",
                            },
                            todo: [
                                "user-review-supervisor-seed 与 parent 跨 object 改 child seed 的显式授权校验当前未实现（design-ahead-of-code）；现有代码仅靠 self-scope 路径前缀隐式表达层级修改权。",
                                "isValidObjectId（src/persistable/stone-versioning.ts）regex 不允许 \"/\"，嵌套 child（objectId 含 \"/\"）暂无法用完整 objectId 调 openMetaprogWorktree 自 metaprog。放开后：child 改自己子树 = self-scope 自治 ff-merge（不经 parent review），child 改 parent = cross-scope PR。需同时确认 self-scope 前缀对 nested 用 nestedObjectPath（objects/<p>/children/<c>/）而非直拼。",
                            ],
                        },
                        "r12_enforcement_at_persistable_layer": {
                            title: "R12 supervisor-only 校验必须在 persistable 层",
                            content: `
                            rollback() 函数自身强制 supervisorAuthor === SUPERVISOR_OBJECT_ID（src/persistable/stone-versioning.ts，
                            返回 { ok: false, code: "FORBIDDEN", ... }）；LLM 命令层（src/executable/windows/root/command.metaprog.ts:188）/
                            HTTP route / 测试夹具的校验是补充防御，不是唯一防线。

                            任何新入口（cron / 未来子模块 / 工具脚本）调 rollback 时都自动得到边界保护，
                            无需 caller 记得校验。双层防御：caller-side 给用户友好提示，persistable-side 是不可绕过的边界。

                            LLM 命令层校验后，persistable 层只 isValidObjectId 接受任何字符串 supervisorAuthor 是不够的——故校验下沉到此层。
                            `,
                        },
                        "bootstrap_includes_worktree_prune": {
                            title: "ensureStoneRepo 末尾自动跑 pruneStaleWorktrees",
                            content: `
                            bootstrap 一次性清理 orphan worktree admin 记录；非周期扫，运行成本 O(worktree count)。

                            与 worker 事件驱动模型对齐：cleanup 是启动期 invariant，不是 runtime safety net。
                            通过 dynamic import 调用 pruneStaleWorktrees，避免 stone-bootstrap.ts 与 stone-versioning.ts 的静态循环依赖。
                            失败仅 advisory console.warn，不阻止 bootstrap（pruneStaleWorktrees 内部已 silent-swallow ban 处理 prune 失败）。

                            若 pruneStaleWorktrees 注释承诺"启动期 hygiene"但 src/ 无 caller、只在测试调，
                            会导致 orphan worktree + branch 永远累积——故在 bootstrap 末尾显式调用。
                            `,
                        },
                    },
                },
            },
        },
        "programmable": {
            title: "OOC Agent programmable 概念",
            content: `
            Programmable 描述 Object 持有并演化自身**自定义 ContextWindow + 命令表**的能力。

            Object 在自己的 stone 里有一份 \`server/index.ts\`，导出 \`window: ObjectWindowDefinition\`
            （type=\`"custom"\` 的 self window 定义）+ 可选的 \`ui_methods\` 字典（visible 维度的 UI 入口）。
            \`window.commands\` 是标准 \`CommandTableEntry\` 字典；LLM 通过
            \`exec(window_id="custom:<self>", command="<name>", args={...})\` 直接调用，
            与调 do_window.continue / talk_window.say 完全同构。
            UI / agent-native 客户端通过 HTTP \`callMethod\` 调用 \`ui_methods\`（与 LLM 路径完全解耦）。

            核心组成（plan §6.2 / §6.5）:
            1. ObjectWindowDefinition 形状: { title?, description?, renderXml?, basicKnowledge?, onClose?, commands? }；
               commands 字典里每条 entry 是头等的 CommandTableEntry，与内置 window 上的命令同构。
            2. type=custom dispatcher: WindowRegistry 注册一份固定 type=custom 的契约，行为按 \`window.objectId\`
               路由到对应 Object 的 ObjectWindowDefinition；commands dispatcher 在 entry.exec 包装层注入 self。
            3. 单例注入: 仅当 thread.persistence?.objectId 存在（thread 由该 Object 自己持有，见
               src/executable/windows/_shared/init.ts）时由 initContextWindows
               幂等注入一个 \`custom:<objectId>\` window。
            4. ProgramSelf 注入: program ts/js sandbox 收到 self = { dir, callCommand, getData, setData, getThreadLocal, setThreadLocal }；
               \`callCommand(windowId, command, args?)\` 可调任意 thread 内 window 上的任意已注册命令。
            5. 动态加载与热更: loader 按 \`server/index.ts\` 的 mtime 缓存；写文件后下一次调用自动重新 import。
            6. 元编程闭环（与 reflectable 配合）: super flow 通过 write_file 写 server/index.ts → 下一次调命令时看到新形态。

            Programmable 不是新增 LLM tool 面，而是给 Object 一个**"自我门面 window"+其上一组命令**，
            让它把高频动作或复杂逻辑封装成命名命令；LLM 通过统一的 exec 协议直接调用，
            或在 ts/js sandbox 里 \`await self.callCommand("custom:<self>", "<name>", {...})\` 触发。
            旧 \`llm_methods\` 字典已硬切删除（plan D6）。
            `,
            named: {
                "Programmable": "Object 持有/演化自身自定义 ContextWindow + 命令表的能力维度",
                "ObjectWindowDefinition": "server/index.ts 中 export const window 的形状：{ title?, description?, renderXml?, basicKnowledge?, onClose?, commands? }",
                "ui_methods": "server/index.ts 导出的、给 UI/agent-native 通过 HTTP callMethod 调用的方法字典（plan D3 完全保留）",
                "ProgramSelf": "program ts/js sandbox 注入的 self 对象，承载 callCommand / getData / setData / getThreadLocal",
                "loadObjectWindow / loadUiServerMethods": "按 mtime 缓存、自动热更的 server 加载器",
                "CustomCommandContext": "custom window 命令 exec 收到的 ctx：CommandExecutionContext + self: ProgramSelf",
            },
            children: {
                "object_window_definition": {
                    title: "object_window_definition - custom self window 的形状",
                    content: `
                    每个 Object 的 self window 定义在 \`stones/<self>/server/index.ts\` 中：
                    \`\`\`
                    export const window: ObjectWindowDefinition = {
                      title: "<self>",
                      description: "...",
                      basicKnowledge: ({ self }) => "...",
                      commands: {
                        <name>: {
                          paths: ["<name>"],
                          match: (args) => ["<name>"],
                          knowledge: (args, formStatus) => ({ "internal/windows/custom/<name>/basic": "..." }),
                          exec: async (ctx) => { /* ctx.self / ctx.thread / ctx.parentWindow / ctx.args */ },
                        },
                      },
                    };
                    export const ui_methods = { /* visible 维度，HTTP 路径 */ };
                    \`\`\`

                    ObjectWindowDefinition 字段（src/executable/server/window-types.ts）:
                    - title? / description?: 进 basicKnowledge 与 LLM 视野
                    - renderXml?: 渲染该 window 为 context XML（同 WindowRegistry.renderXml）
                    - basicKnowledge?: 该 window 出现时合成的协议知识；可静态字符串或 ({ self }) => string
                    - onClose?: close 触发 hook（同 WindowRegistry.OnCloseHook）
                    - commands?: Record<string, CommandTableEntry> —— 命令字典；exec ctx 由 dispatcher 注入 self

                    custom window 上的 commands 与内置 window（do/talk/...）上的命令完全同构：paths / match /
                    knowledge(args, formStatus) / exec(ctx)。
                    `,
                    named: {
                        "stones/<self>/server/index.ts": "self window + ui_methods 源码文件路径",
                        "ObjectWindowDefinition.commands": "Object 自定义命令字典；dispatcher 自动注入 self 到 exec ctx",
                    },
                },
                "loader": {
                    title: "loader - 加载与热更",
                    content: `
                    src/executable/server/loader.ts 负责按需 import server/index.ts，并按 mtime 缓存:

                    \`\`\`
                    const mod = await import(\`\${file}?t=\${mtime}\`);  // ?t=mtime 破坏 bun import cache
                    \`\`\`

                    行为:
                    - 文件 ENOENT → 返回 undefined。
                    - 旧 \`llm_methods\` 出现 → 抛清晰错误（plan D6 硬切；不再静默吃掉）。
                    - mtime 未变 → 复用缓存条目，不重新 import。
                    - mtime 变化 → 走新的 query string，等价于强制重新 import 一份新模块。
                    - 解析失败 → 抛带原始错误信息的异常，由调用方决定怎么呈现。

                    暴露的接口:
                    - loadObjectWindow(stoneRef): 取 Object 的 ObjectWindowDefinition；没有 \`export const window\` 时返回 undefined。
                    - loadUiServerMethods(stoneRef): 取 ui_methods 字典（D3 保留）。
                    - clearServerLoaderCache(): 测试钩子，清空缓存以避免测试间互相污染。
                    `,
                    named: {
                        "?t=mtime": "破坏 bun import cache 的 query string trick",
                        "clearServerLoaderCache": "测试用清缓存接口",
                    },
                    patches: {
                        "mtime_resolution_caveat": {
                            title: "mtime 精度依赖文件系统",
                            content: `
                            按 mtime 失效假设文件系统的 mtime 至少有毫秒精度。
                            某些 FS / NFS 只提供秒级精度，可能出现"写完立刻读还是旧版"的极短窗口。
                            目前实现没有额外的 etag / hash 保护；如果遇到这种问题，可以在 writeServerSource 后 sleep 1ms 兜底。
                            `,
                        },
                    },
                },
                "program_self_injection": {
                    title: "program_self_injection - ProgramSelf 注入语义",
                    content: `
                    src/executable/server/self.ts createProgramSelf(stoneRef, thread) 构造一个 ProgramSelf 对象:

                    - dir: stone 目录绝对路径，用于在 ts/js sandbox 里拼相对路径。
                    - callCommand(windowId, command, args?): 在 thread.contextWindows 里 lookup window → 通过
                      WindowRegistry 取该 window type 的 commands[command] → exec(ctx)。type=custom 时
                      dispatcher 自带 self 注入；其它 type 由调用方按需补 ctx.self。找不到 windowId / command
                      时抛清晰错误（含当前可见 window/command 列表）。
                    - getData(key) / setData(key, value): 读写 \`flows/<sid>/objects/<self>/data.json\`
                      (session 级数据；2026-05-23 起从 stone 迁到 flow，详见 persistable.flow.session_data)。
                      setData 是顶层 spread merge 而非整体覆盖（API 形状保留）。
                      **语义变化**：不再是跨 session 长期数据；读到的永远是 ctx.thread 当前 session 的 data.json。
                      要跨 session 共享请走 stone server method 写 pool/data csv。无 thread.persistence 时返回空 / 静默跳过。
                    - getThreadLocal(key) / setThreadLocal(key, value): 读写 thread.threadLocalData；
                      跨 exec 共享（程序窗口同一线程内的 ts/js exec 之间），但不持久化（重启即丢）。

                    ProgramSelf 在两条路径上被使用:
                    - program command ts/js exec: sandbox 把 self 注入到用户代码（详见 executable.commands.program 与 src/executable/program/sandbox/）。
                    - program.callCommand exec: runCallCommandProgram(thread, windowId, command, args) 构造 self 后调
                      \`entry.exec(ctx)\` 拿返回值。
                    `,
                    named: {
                        "createProgramSelf": "构造 ProgramSelf 的工厂函数",
                        "self.callCommand": "调任意 window 上任意命令的入口；自动 lazy load + 按 mtime reload",
                        "threadLocalData": "thread 级共享数据；ts/js exec 间通过 self.getThreadLocal/setThreadLocal 传值",
                    },
                },
                "custom_window_invocation": {
                    title: "custom_window_invocation - LLM 调用 custom 命令的两条路径",
                    content: `
                    LLM 通过两种入口调 custom window 上的命令:

                    **路径 A: 直接 open custom window 的 command（推荐）**
                    \`\`\`
                    exec(window_id="custom:<self>", command="<name>", args={ ... })
                    refine(...)
                    submit(...)
                    \`\`\`
                    与调 do_window.continue / talk_window.say 完全同构。custom dispatcher 在 commands[<name>].exec
                    被取出时包一层 self 注入，对 manager.submit 完全透明。

                    **路径 B: program.callCommand 通用元操作通道**
                    \`\`\`
                    exec(command="program", args={ window_id: "custom:<self>", command: "<name>", args: {...} })
                    \`\`\`
                    或 ts/js exec 里:
                    \`\`\`
                    exec(command="program", args={ language: "ts", code: "return await self.callCommand('custom:<self>', '<name>', { ... });" })
                    \`\`\`
                    callCommand 不仅可调 custom window 的命令，也可调 do_window/talk_window/file_window 等任意 window
                    上的已注册命令——把"调 commands"统一成 \`(window_id, command, args)\` 一个签名。

                    两条路径共享同一份 ObjectWindowDefinition.commands 字典；只是入口形态不同。
                    `,
                    named: {
                        "program.callCommand": "program command 的 callCommand 模式；一行直接调任意 window 上的命令",
                        "runCallCommandProgram": "callCommand 路径的执行入口",
                        "formatProgramResult": "把 result / error 包成可读字符串的格式化函数",
                    },
                },
                "window_evolution": {
                    title: "window_evolution - custom window 的演化路径",
                    content: `
                    Object 演化自身 self window 的标准路径:

                    1. 触发点（典型: reflectable.metaprogramming 的反思请求）。
                    2. super flow 中通过 \`exec(command="write_file", path="stones/<self>/server/index.ts", content="...")\` 重写 self window 源码。
                    3. 下一次 \`exec(window_id="custom:<self>", command=<new>)\` 或 \`self.callCommand(...)\` 触发时，
                       loader 看到 mtime 变化 → ?t=mtime 强制重新 import → 新形态立刻生效。
                    4. 不需要重启进程、不需要重新部署。

                    写新命令时需要遵守 CommandTableEntry 形状（exec 必填）；paths / match / knowledge 可选但建议补全，
                    因为 LLM 在 callCommand 模式下会看见对应的 knowledge entry，写得清楚直接影响调用质量。

                    更细的边界（路径权限、是否允许 super flow 自动写 server）由 reflectable.business_task_isolation 与
                    caller 的显式请求共同决定；programmable 本身只描述 *如何写* 才能生效，不规定 *谁可以写*。
                    `,
                    named: {
                        "writeServerSource": "src/persistable/stone-server.ts，覆盖式写 server/index.ts",
                        "热更生效条件": "mtime 变化 → loader cache 失效 → 下一次调命令重新 import",
                    },
                },
            },
            patches: {
                "custom_window_vs_ui_methods": {
                    title: "custom window commands 与 ui_methods 的分流",
                    content: `
                    同一份 server/index.ts 中两个导出服务不同调用方（plan D3）:

                    - \`window.commands\` (custom dispatcher 路由): 给 LLM 通过 \`exec(window_id="custom:<self>", ...)\`
                      或 \`program.callCommand\` 调用。入参由 LLM 在 form 里填，返回值进 program_window.history 或
                      form.result 让 LLM 看到。
                    - \`ui_methods\`: 给 UI / agent-native 客户端通过 HTTP 调用；由 app/server flows.callMethod 或
                      stones.callMethod 路径走 loadUiServerMethods 拿到方法字典并执行。

                    两套形状不同（CommandTableEntry vs UiServerMethod）；调用入口、调用方身份、错误呈现位置不同。
                    一个动作到底该放哪个，看的是"调用方是 LLM 还是用户/agent 客户端"。如果两者都需要，需要分别写两份。
                    `,
                },
                "per_object_isolation": {
                    title: "server 是 stone 级别，跨 session 共享",
                    content: `
                    server/index.ts 位于 \`stones/<self>/\` 下，不是 \`flows/<sid>/objects/<obj>/\` 下。

                    含义:
                    - 同一个 Object 在不同 session 里看见同一份 self window；不会"换 session 就丢命令"。
                    - 多个 session 并发调用同一个命令时共享 loader 缓存条目；mtime 变化对所有 session 一起生效。
                    - 没有 flow 级私有 self window；如需 session 特化逻辑，应该在命令内通过 ctx.thread / self.getData 区分，
                      而不是 fork 一份新的 server。
                    `,
                },
                "http_writes_go_through_versioning": {
                    title: "HTTP 写 stone 必经 stone-versioning",
                    content: `
                    **设计哲学（契约 3：状态翻转唯一 owner）**：所有写 stone 的入口（HTTP / LLM 命令 /
                    未来的 cron / 测试夹具）共享同一底层语义——open metaprog worktree →
                    write in worktree → commitWorktree → tryMergeSelf 或 requestPrIssueReview。

                    **症状**：
                    HTTP \`POST /api/stones\` / \`PUT /api/stones/:id/server-source\` 等 endpoint
                    历史上**绕开** stone-versioning 直接 \`writeFile\`，导致：
                    - HTTP 创建的 stone 不入 git；\`openMetaprogWorktree\` 后 worktree 看不到该 stone
                    - 元编程协议在 dogfooding 场景**第一步崩**
                    - audit trail 散在两路（"git 看到的世界" vs "filesystem 看到的世界"分裂）

                    **简化设计**（克制熵增 - 删特殊路径而非加补丁）：
                    - HTTP route 不再直接 writeFile；改调 \`wrapHttpWriteInWorktree(write, ref, authorObjectId, intent)\`
                      helper，自动 open worktree → exec write → commit → merge
                    - 不引入"uncommitted working tree"半成品状态——每个 HTTP 写操作都产生一个 commit
                    - HTTP 与 LLM 命令是同一个 evolution 流程的两个入口，不再有"快/慢"两条路

                    **不在本契约内**：
                    - knowledge 文件操作（\`POST /api/stones/:id/knowledge/files\`）写到
                      \`pools/objects/<id>/knowledge/\`（sediment, pool 层不进 git）——route 命名
                      与存储位置错位是 root-cause #3 范围。
                    - call_method（ui_methods 调用）不涉及 stone 写入。

                    **实现见**：
                    - \`src/app/server/modules/stones/versioning-helper.ts:wrapHttpWriteInWorktree\`
                    - \`src/app/server/modules/stones/service.ts\`：createStone / putSelf / putReadme / putServerSource
                      改调 helper
                    `,
                    named: {
                        "HTTP 必经 versioning": "所有 HTTP stone 写操作经 stone-versioning open/commit/merge 流程",
                        "wrapHttpWriteInWorktree": "把 HTTP 写操作 wrap 成 worktree+commit+merge 序列的 helper",
                        "状态翻转唯一 owner": "HTTP 与 LLM 共享同一底层 stone 写入语义，不再分裂",
                    },
                },
                "pool_methods": {
                    title: "pool_methods - server 暴露 pool 数据访问的命令形状",
                    content: `
                    server/index.ts 里访问 pool 数据的 commands 遵循统一约束（2026-05-24 起 csv 替代 sql）：

                    **1. 命名语义化**：
                    \`\`\`
                    commands: {
                      upsert_factor: { ... },
                      query_factors_by_psm: { ... },
                      list_recent_memories: { ... },
                    }
                    \`\`\`
                    LLM 在 form / knowledge 里看见的是"这个命令做什么"，不是"它去哪个表/哪个文件"。

                    **2. 实现内聚**：每个 method 内部:
                    - **data csv**：通过 fs API + csv 解析库（papaparse / 自实现）读
                      \`pools/objects/<self>/data/<name>.csv\`；
                      写入用 \`enqueueSessionWrite('data:'+baseDir+':'+objectId+':'+name)\` 串行化。
                      小批量更新可读全表 → 修改 → 整文件写回；大批量考虑 append-only + 定期 compact。
                    - **knowledge / files**：通过 fs API 读 \`pools/objects/<self>/knowledge/...\` 或 files/...；
                      路径由 derivePoolFromThread + helper 计算，不在命令体里手拼。

                    **3. 类型定义内联**:
                    csv 没有外部 schema 声明文件；如果 server method 需要 TS 类型（如 \`type Factor = { psm: string; ... }\`），
                    在 server/ 源码内 inline 定义即可。未来若类型膨胀，可加 \`stones/<self>/types/\` 目录承载共享类型，
                    但当前不强制。

                    **4. LLM 也可直接读 csv**:
                    与 sql 时代不同，csv 路径对 LLM 是合法可见的（详见 persistable.pool.patches.llm_access_via_server_method）。
                    server method 主要在两个场景下提供价值：
                    - 大批量写 / 复杂查询（避免 LLM 反复读全表）。
                    - 语义化封装（让 LLM 看见"upsert_factor"比"读 factors.csv 找一行改一行写回"更顺手）。
                    简单的"查看 / 偶尔小改"，LLM 直接 file_window.open / edit 即可，无需 server method 包装。

                    **5. params schema 校验是 todo**：当前 CommandTableEntry 没强制 schema；
                    如未来要支持自动参数检查 / 转换，需在 callCommand 路径 + ui callMethod 路径都加上（见 programmable.todo）。
                    `,
                    named: {
                        "pool method": "server/index.ts 中 commands 字典里访问 pool 数据的语义命令",
                        "csv-based pool method": "用 fs + csv 解析库读写 pool/data/<name>.csv 的 server method",
                        "enqueueSessionWrite('data:...')": "csv 整文件写串行化键",
                    },
                    sources: [["src/persistable/csv-pool.ts", "csv-based pool method 的实现路径——readCsv / writeCsv / appendRow API + write-then-rename + kebab-case name 校验；server method 在 stone server/index.ts 中以 fs API 调用本模块（或 papaparse 等等价 csv 库）。"]],
                },
            },
            todo: [
                "params schema 校验当前未实现。如果未来要支持自动参数检查/转换，需要在 callCommand 路径 + ui callMethod 路径都加上。",
                "Object 注册多个自定义 window 类型（不仅仅 self window）：本轮 export const window 是单数。后续可演化为复数 windows 字典。",
            ],
        },
        "visible": {
            title: "OOC Agent visible 概念",
            content: `
            Visible 描述 Object 持有并演化自身 UI 页面的能力。

            Object 在自己的 stone 里可以有 \`client/index.tsx\`（单页入口）；
            在每个 flow object 下还可以有 \`client/pages/<page>.tsx\`（session 内的多页扩展）。
            UI 通过 HTTP 调用 server/index.ts 暴露的 ui_methods 与 Object 交互（与 LLM 的调用通道并行）。

            核心组成:
            1. stone client: stones/<self>/client/index.tsx，跨 session 稳定的单页入口。
            2. flow client pages: flows/<sid>/objects/<obj>/client/pages/<page>.tsx，session 内多页扩展。
            3. ui_methods 通道: 客户端通过 HTTP（app/server flows.callMethod / stones.callMethod）调 server/index.ts 的 ui_methods。
            4. 元编程闭环（与 reflectable 配合）: super flow 通过 write_file 改 *.tsx → 下一次客户端重新加载看到新 UI。

            与 programmable 的关系: programmable 定义方法库本身（含 ui_methods），visible 定义 UI 资源（tsx 文件）+ 调用通道。
            两者共用 server/index.ts，但形状与消费方不同。
            `,
            named: {
                "Visible": "Object 持有/演化自身 UI 页面的能力维度",
                "stone client": "stones/<self>/client/index.tsx，单页入口",
                "flow client pages": "flows/<sid>/objects/<obj>/client/pages/<page>.tsx，多页扩展",
                "clientIndexFile / flowClientPageFile": "src/persistable/stone-client.ts 提供的路径函数",
                "ui_methods": "server/index.ts 中给 UI 用的方法字典；详见 programmable.llm_vs_ui_methods",
                "callMethod": "app/server 暴露给客户端的 HTTP 入口，用于调用 ui_methods",
            },
            children: {
                "stone_client": {
                    title: "stone_client - 跨 session 稳定的单页入口",
                    content: `
                    路径: \`stones/<self>/client/index.tsx\`（src/persistable/stone-client.ts:17 clientIndexFile）。

                    读写接口（src/persistable/stone-client.ts:35-42）:
                    - readStoneClientSource(stoneRef): ENOENT 静默返回 undefined。
                    - writeStoneClientSource(stoneRef, code): 自动 mkdir client/ 后覆盖写。

                    设计定位:
                    - 跨 session 稳定: stone 是跨 session 共享的身份与方法库，stone client 是它的"门面"——
                      无论 Object 出现在哪个 session 里，UI 看到的入口都是这一份。
                    - 单页入口: 复杂的多页结构请用 flow_client_pages；stone client 适合放最稳定的"主页"。
                    `,
                    named: {
                        "clientIndexFile": "stones/<self>/client/index.tsx 的绝对路径计算函数",
                        "readStoneClientSource / writeStoneClientSource": "stone client 的读写接口",
                    },
                },
                "flow_client_pages": {
                    title: "flow_client_pages - session 内的多页扩展",
                    content: `
                    路径: \`flows/<sid>/objects/<obj>/client/pages/<page>.tsx\`
                    （src/persistable/stone-client.ts:22-31 flowClientPagesDir / flowClientPageFile）。

                    设计定位:
                    - flow 级: 这些页面与某次 session 绑定，session 结束后通常一并归档。
                    - 多页: 一个 flow object 可以有任意多页；pageName 受 \`/^[A-Za-z0-9_-]+$/\` 校验防 path-traversal。
                    - 适合放"任务进度看板"、"实时输出查看页"等与本次 session 状态绑定的临时 UI。

                    读写接口（src/persistable/stone-client.ts:47-）:
                    - readFlowClientPage(flowObjectRef, pageName): ENOENT 静默返回 undefined。
                    - writeFlowClientPage(flowObjectRef, pageName, code): 同样有 pageName 安全校验 + mkdir。
                    `,
                    named: {
                        "flowClientPagesDir": "flow object 的 client/pages 目录路径",
                        "flowClientPageFile": "单个 page tsx 文件路径；带 pageName 安全校验",
                        "pageName 校验": "/^[A-Za-z0-9_-]+$/，防 path-traversal",
                    },
                },
                "ui_methods_callable": {
                    title: "ui_methods_callable - UI 通过 HTTP 调用方法库",
                    content: `
                    客户端 tsx 不直接 import server 方法（它在浏览器里跑，看不见 Node fs）。
                    UI 与 Object 交互的通道是 HTTP callMethod:

                    - flow 级: src/app/server/modules/flows/service.ts callMethod({ sessionId, objectId, method, args })
                      → loadUiServerMethods({ baseDir, objectId }) → 找到 ui_methods[method] → 执行 fn。
                    - stone 级: src/app/server/modules/stones/service.ts callMethod 走同样的 loader + 调度路径。

                    错误形态（与 AppServerError 协议一致）:
                    - 加载失败 → \`METHOD_LOAD_FAILED\`。
                    - 方法不存在 → \`METHOD_NOT_FOUND\`。
                    - 执行抛错 → 由 service 层兜底转 AppServerError 返回给 HTTP 调用方。

                    这条路径与 LLM 的 \`program.callCommand\` 路径在同一份 server/index.ts 上分流（按 \`window.commands\` vs \`ui_methods\`），
                    互不干扰。
                    `,
                    named: {
                        "flows.callMethod / stones.callMethod": "app/server 暴露的 HTTP 入口",
                        "loadUiServerMethods": "拿到 ui_methods 字典的 loader 接口",
                        "AppServerError": "app/server 统一错误协议",
                    },
                },
                "client_evolution": {
                    title: "client_evolution - UI 资源的演化路径",
                    content: `
                    Object 演化自身 UI 的标准路径:

                    1. 触发点（典型: caller 明确要求 'UI 需要加一个 X 视图' 类反思请求）。
                    2. super flow 中通过 \`exec(command="write_file", path="stones/<self>/client/index.tsx", content="...")\` 重写 stone client；
                       或写 flow 级 page \`exec(command="write_file", path="flows/<sid>/objects/<obj>/client/pages/<page>.tsx", content="...")\`。
                    3. 下次客户端加载该路径时拿到新 tsx 源码（具体打包/渲染管线由消费方实现）。
                    4. 如果新 UI 要调用新方法，需要先把对应 ui_methods 写到 server/index.ts（程序面与界面面分别演化）。

                    与 programmable.method_evolution 的对应关系: 一个改方法、一个改界面；两者都通过 write_file + loader/打包 自然热更。
                    `,
                    named: {
                        "client tsx 演化": "write_file → 下次客户端加载看到新版",
                        "界面与方法分离演化": "tsx 与 server/index.ts 是两份文件；界面要新能力时常需先扩 ui_methods",
                    },
                },
                "loop_timeline": {
                    title: "loop_timeline - thread 一轮 thinkloop 在做什么的可视化（Time Machine 模式）",
                    content: `
                    Loop Timeline 是 thread 详情页的"agent loop 时间轴 + 时光机"视图。
                    从"纵向列 N 个 loop entry"升级为**Time Machine 模式**:
                    单次显示一个 loop + 左右切换 + Window Diff 视图 (vs 上一 loop 的 added/changed/removed/unchanged)。

                    设计动机: LLM 视角下"context windows 变化"才是关键信号 (哪个 window 加了/改了/删了),
                    肉眼对比两个 input.json 字符串 diff 累且不直观; window diff 视图直接 surface 变化。

                    数据完全派生自既有持久化, 不引入新存储或采集:
                    - thread.events: ProcessEvent[] (始终落盘, thread.json 持久化)
                    - <threadDir>/debug/loop_NNNN.{input,output,meta}.json (仅 enableDebug 后落盘)
                      **meta.json 加 windowsSnapshot 字段** (见 observable.debug_files)
                    - <threadDir>/llm.{input,output}.json (始终, 最近一次)
                    - ContextSnapshot (始终, 与 system XML 同源)

                    与 observable 维度的关系: observable 决定 "记什么/何时记" (LlmObservation /
                    debug_files / context_snapshot / windowsSnapshot); loop_timeline 决定 "如何把这些数据
                    按 loop 维度聚合给人看"。两者职责清晰: observable 不画 UI, loop_timeline 不动数据。

                    UI 设计原则:
                    - **派生而非采集**: 不引入新文件、不在前端缓存; 全部 lazy load。
                    - **diff 在前端算**: 后端只提供 windowsSnapshot 数组; 前端拿 loop N + loop N-1 算
                      added / changed (hash 不同) / removed / unchanged 四态。
                    - **type-agnostic hash**: 不为每个 type 注册 hashContent; 统一
                      \`Bun.hash(JSON.stringify(stripVolatile(window), sortedKeys))\`。目标是
                      "内容变没变", 不是"哪些字段变"。
                    - **type-dispatch (event badge)**: 关键 ProcessEvent 仍由 LoopEventBadge 按 type+kind 分发,
                      与 P1-3 R0c/R0d 协议一致; 新增 event type 只加 badge entry, 不改主框架。
                    - **退化优雅**: enableDebug 关闭时退到 thread.events 简化时间轴 (无 loop boundary,
                      无 diff), 顶部提示一键启用 debug。
                    - **保留现有交互**: LoopEventBadge / LoopActionPopover / permission approve /
                      events_summary 全保留; 时光机只换主导航方式 (横向左右切换 vs 纵向滚动)。
                    - **agent-native 预留**: 后端 windowsSnapshot 是 raw data; 未来 Agent 调 server method
                      自查 diff 用同源数据。
                    - **不破坏现有 viewer**: LLMInputJsonViewer / ContextSnapshotViewer 保持原貌,
                      展开 window detail 时嵌入它们。

                    时光机布局 (核心交互):
                    1. 顶部: mini timeline strip (◯◯●◯◯◯, 横向滚动; 关键 event 在某 loop → 该点加角标)
                    2. 导航: [← Prev] Loop #N of M [Next →] [⏭ Latest] + 键盘 ←/→ 快捷键
                    3. 主区: LoopDiffView 列出 windowsSnapshot, 每个 window 显示 diff 状态:
                       - 🆕 added (绿色高亮)
                       - ✏️ changed (橙色边框; hash 不同)
                       - 🗑️ removed (灰化 strike-through)
                       - · unchanged (普通灰色)
                    4. 单击 window → 展开 LLMInputJsonViewer / ContextSnapshotViewer 看完整内容
                    5. 底部: 当前 loop 的关键 event badges (LoopEventBadge 复用)

                    URL 状态: 复用 ?selected=thread:<obj>:<tid>; 新加 ?loop=<N>; 不传 = Latest。

                    完整 plan 见 docs/2026-05-25-agent-loop-visualizer-plan.md +
                    docs/2026-05-26-loop-time-machine-with-window-diff-design.md。
                    `,
                    named: {
                        "Loop Time Machine": "升级后的主形态; 单 loop 视图 + 左右切换 + window diff",
                        "LoopNavigator": "时光机导航组件; [← Prev] Loop #N [Next →] [⏭ Latest] + 键盘快捷",
                        "LoopMiniTimeline": "顶部 mini timeline strip; 横向滚动; 关键 event 角标",
                        "LoopDiffView": "主区组件; 列 windowsSnapshot + 4 态 diff 标记 (added/changed/removed/unchanged)",
                        "WindowDiffRow": "单 window diff 行; 含 icon + type + summary + diff status",
                        "LoopEventBadge": "关键 ProcessEvent 视觉胶囊; type-dispatch 按 type+kind 分发",
                        "LoopActionPopover": "permission_ask approve/reject + events_summary 全文 popover",
                        "windowsSnapshot": "loop_NNNN.meta.json 中的 Array<{id, type, contentHash, parentWindowId?, status?, compressLevel?}>; 数据源自 observable",
                        "contentHash": "Bun.hash(JSON.stringify(stripVolatile(window), sortedKeys)).toString(36); type-agnostic; 不进 thread.json",
                        "退化模式": "enableDebug 关闭时仅展示 thread.events 序列, 无 loop boundary 无 diff",
                        "list-loops endpoint": "GET /api/runtime/.../debug/loops; 只返回 meta 数组",
                    },
                    patches: {
                        "api_increment": {
                            title: "后端 API 增量 - list-loops",
                            content: `
                            本概念落地需要 1 个新 endpoint:
                            GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops
                            返回 { loops: Array<{ loopIndex, hasInput, hasOutput, hasMeta, meta? }> }

                            - 仅扫 <threadDir>/debug/ 下 loop_NNNN.meta.json, 按 loopIndex 升序
                            - 不携带 input/output 全文 (前端按需 GET 单条 .../debug/loops/:loopIndex)
                            - debug 未启用 / 目录不存在 → 返回 { loops: [] }, 不抛错
                            - 复用 RuntimeService 现有 baseDir 路径解析

                            其它 endpoint (latest debug / 单 loop debug / thread.json) 全部复用现有, 不动。
                            `,
                        },
                        "degraded_mode": {
                            title: "退化模式 - debug 关闭时的兜底视图",
                            content: `
                            enableDebug 关闭的 thread 没有 loop_NNNN.*.json, 但 thread.events 仍始终落盘。
                            退化规则:
                            - timeline 标题加 hint: "debug 关闭, 仅显示事件序列; <一键启用按钮>"
                            - 没有 loop boundary (无法精确分组); events 按 createdAt 升序展开
                            - latency / contextBytes / messageCount 等 meta 字段不显示 (无数据)
                            - 关键 event (LoopEventBadge) 仍正常 surfacing (data 都在 thread.events)
                            - 启用 debug 后, 后续轮次自动有完整 loop 视图; 老轮次仍是退化态 (历史数据不可补)
                            `,
                        },
                        "event_badge_taxonomy": {
                            title: "LoopEventBadge type-dispatch 表 - 关键事件视觉编码",
                            content: `
                            高亮事件 (其它 text/tool_use 不进 badge, 减噪音):

                            context_compressed:
                              - reason=user-compress → 🗜️ blue
                              - reason=idle-fold / age-fold / double-fold / cascade-fold → 🍂 gray
                              - reason=emergency-guard-* → ⚠️ orange
                              - reason=user-expand → ↩️ green
                            events_summary → 📚 purple (单击展示 summary 文本)
                            permission_ask (无 decided) → ⏸️ yellow (单击跳 approve/reject 入口)
                            permission_ask (decided=approve) → ✅ green
                            permission_ask (decided=reject) → ❌ red
                            permission_denied → 🚫 red
                            tool_result (ok=false) → ⚠️ orange

                            emoji 仅占位; 实施时用 SVG 图标库, 与现有 web 风格一致。
                            `,
                        },
                        "agent_native_parity": {
                            title: "agent-native 等价预留 - Agent 自查 loop timeline",
                            content: `
                            UI 通过 HTTP API 拿 list-loops + 单 loop debug; Agent 通过 server method 拿同样数据
                            (尚未实现, 列后续 phase)。等价路径要保证:
                            - server method 与 HTTP endpoint 返回结构一致 (避免两套 schema 漂移)
                            - 任何 UI 高亮规则 (event badge taxonomy) 都可被 server method 等价表达
                              (比如 Agent 调 self.list_recent_compressions() 等价于 UI 过滤 context_compressed badge)

                            这条等价是 visible 维度的硬约束 (parent visible 概念 + agent-native UI 等价路径
                            一致性的要求); 本节先把 UI 做出来, Q0e 或后续 phase 补 server method。
                            `,
                        },
                        "time_machine_navigation": {
                            title: "Time Machine 导航 - 单 loop 视图 + 左右切换",
                            content: `
                            导航行为:
                            - **← Prev**: 跳 loop N-1; loop 0 时 disabled
                            - **→ Next**: 跳 loop N+1; 最新时 disabled
                            - **⏭ Latest**: 跳到 max loopIndex
                            - **键盘 ←/→**: 焦点在主组件时生效; debounce 200ms 防 fetch 风暴
                            - **mini timeline 点击**: 直接跳到任一 loop
                            - **URL ?loop=N**: 同步进 URL; 不传 = Latest; 刷新保留

                            横向滚动策略 (大量 loop):
                            - mini timeline 横向滚动 (overflow-x: auto); 当前 loop scroll-into-view (smooth)
                            - 不做"智能折叠"(远 loop 隐藏 "... earlier loops ...") — MVP 选横向滚动, 复杂度低; 若未来 loop > 200 再考虑

                            **废弃 LoopEntry**: 纵向列出多 loop entry 的旧形态完全替换为时光机;
                            LoopEntry.tsx 文件不再使用 (本轮删除或保留为空 stub)。
                            "View raw" 模式靠 LLMInputJsonViewer / ContextSnapshotViewer 嵌入展开实现。
                            `,
                        },
                        "window_diff_algorithm": {
                            title: "Window Diff 算法 - 前端 client-side 计算",
                            content: `
                            前端拿 loop N + loop N-1 的 windowsSnapshot 数组, 按 window id 配对:

                            \`\`\`
                            for each window in {N, N-1} 取并集:
                              - id in N+1 only      → "added"     🆕
                              - id in N-1 only      → "removed"   🗑️
                              - id in both, hash same  → "unchanged"  ·
                              - id in both, hash diff  → "changed"    ✏️
                            \`\`\`

                            渲染: WindowDiffRow 按 diff status 着色 (绿/橙/灰 strike/普通灰)
                            + window type icon + summary (来自 window.title 或 type-specific summary)。

                            **边界**:
                            - loop 0 / 没上一 loop → 所有 window 显示为 "added" 占位 (或 "First loop snapshot" hint)
                            - loop N 缺 windowsSnapshot (老 loop, 升级前数据) → fallback 显示 "no diff data" + 一行 list
                            `,
                        },
                        "windows_snapshot_data_source": {
                            title: "windowsSnapshot 数据源 - 后端落盘契约（含 fileDiff 扩展）",
                            content: `
                            windowsSnapshot 的基础字段（id / type / contentHash / parentWindowId / status /
                            compressLevel）与落盘契约见 observable.debug_files.patches.windows_snapshot。本节只记
                            visible 侧独有的 **fileDiff 扩展**:

                            \`\`\`
                            fileDiff?: {           // 仅 file_window; 用于前端 CodeMirror Merge unified 渲染
                              previousContent: string;  // 上一 loop file 内容 (added 时 empty)
                              currentContent: string;   // 本 loop file 内容 (removed 时为 "")
                              path: string;
                              isBinary?: boolean;       // 二进制 / 超大文件时 true; previousContent/currentContent 为空
                              tooLarge?: boolean;       // > 200KB 时 true; 同上
                            }
                            \`\`\`

                            **位置**: src/persistable/debug-file.ts 的 LlmLoopDebugMetaRecord 扩展 + writeLoopDebugMeta 写入点
                            **不进 thread.json**: contentHash / fileDiff 都是 debug 视角派生字段, 业务字段保持最小

                            前端通过现有 GET /api/runtime/.../debug/loops/:N endpoint 拿到带 windowsSnapshot 的 meta;
                            不引入新 endpoint。
                            `,
                        },
                        "type_dispatch_diff_renderer": {
                            title: "Type-Dispatch Window Diff Renderer",
                            content: `
                            用户痛点: 展开 "changed" window 时统一嵌 LLMInputJsonViewer 看全文,
                            肉眼找 diff 太累。升级方向: 每个 window type 自己 dispatch 一个 diff renderer
                            (web 端注册, 与 backend renderXml/compressView/contentHash 同精神, 但纯前端 dispatch)。

                            **架构** (web/src/domains/sessions/components/window-diff-renderers/):
                            - registry.ts: registerWindowDiffRenderer / getWindowDiffRenderer
                            - 每 type 一个 .tsx 独立文件; index.ts side-effect 注册
                            - LoopDiffView 在 row 展开时调 \`getWindowDiffRenderer(type)\` dispatch; 未注册 → FallbackJsonDiff
                            - ErrorBoundary 包裹每个 renderer, 抛错 fallback 到 JSON tree + 一行 "renderer X failed" 提示

                            **type 设计**:
                            - **file_window**: **CodeMirror Merge unified 单栏** (复用 @codemirror/merge);
                              **数据来源: backend 预算的 fileDiff.{previousContent,currentContent}** (见 windowsSnapshot
                              扩展; 在 buildWindowsSnapshot 时读上一 loop meta 的 fileDiff.currentContent 作为 prev,
                              当前 file_window 的 content 作为 current; 不重复算 unified diff text, 让前端库做)
                            - **talk_window**: 消息级 diff (按 message.id 配对; 新加绿底 / 修改 inline / 删除 strike)
                            - **do_window**: child status 变化 + transcript diff
                            - **plan_window**: step-level diff (按 step.id 配对; status / text / subPlanWindowId 变化)
                            - **search_window**: match 集合 diff (按 path+line 配对)
                            - **knowledge_window**: body 文本 diff (复用 CodeMirror Merge unified)
                            - **program_window**: history 执行记录 diff (新增 exec / output 变化)
                            - **command_exec**: args 字段级 diff (refine 累积)
                            - **relation_window**: body 文本 diff (CodeMirror Merge unified)
                            - **root / skill_index / todo / custom**: FallbackJsonDiff (通用 JSON tree 高亮变化)

                            **数据获取策略** (hybrid):
                            - **file_window** (可能大文本): backend 预算 fileDiff 写进 snapshot;
                              前端直接渲, 不 fetch input.json
                            - **其它 type** (内容小): 前端展开时 fetch loop N + loop N-1 的 input.json,
                              提取该 window id 的完整对象, 喂 type-specific renderer
                            - 缓存: 单 component lifetime 内 loop input keyed by loopIndex
                            - 切 loop / 切 window 时重置 cache (避免内存膨胀)

                            **不变量**:
                            - Type-dispatch (新 type 加 renderer 不动主框架; 未注册自动 fallback)
                            - 前端 only (除 file_window backend 预算外, 不动 backend 协议)
                            - Fallback 优雅 (renderer 抛错 / 数据缺 → JSON tree)
                            - 不破坏现有 (LLMInputJsonViewer / WindowDiffRow 折叠态 / LoopActionPopover 全保留)
                            - visibility-first (变化是视觉信号; renderer 错误打 console.warn)

                            **CodeMirror Merge 选 unified 单栏** (user 拍板; 不是 split 双栏): 同一窗口内行级 +/-,
                            视觉信息密度高, 适合 loop diff 浏览场景。

                            完整 design 见 docs/2026-05-27-type-dispatch-window-diff-view-design.md。
                            `,
                            named: {
                                "WindowDiffRenderer": "web 端的 dispatch hook 类型; (previous, current, windowType, windowId) => ReactNode",
                                "registerWindowDiffRenderer": "在 web/.../window-diff-renderers/registry.ts; side-effect 注册",
                                "FallbackJsonDiff": "通用 JSON tree diff; 未注册 type / renderer 抛错时兜底",
                                "fileDiff": "WindowSnapshotEntry 上的可选字段; 仅 file_window 类填; 含 previousContent + currentContent + path + isBinary?/tooLarge?",
                                "ErrorBoundary": "包裹每个 renderer; 抛错 fallback + console.warn 显式 'renderer X failed: <msg>'",
                                "CodeMirror Merge unified": "@codemirror/merge ^6.0.0; unified 单栏行级 diff; web/package.json 已有依赖",
                                "数据获取 hybrid": "file_window 走 backend 预算 fileDiff; 其它 type 前端 fetch input.json 提取",
                            },
                        },
                    },
                    sources: [
                        ["docs/2026-05-25-agent-loop-visualizer-plan.md", "Round 3 R0a~R0d 原版 plan (含 list-loops endpoint + LoopEventBadge taxonomy)"],
                    ],
                    todo: [
                        "E2: src/observable/window-hash.ts 新建 + LlmLoopDebugMetaRecord 扩展 windowsSnapshot + 写入点 + 单测",
                        "E3: 前端 LoopTimeline 重构为时光机 (LoopNavigator / LoopMiniTimeline / LoopDiffView / WindowDiffRow) + 废弃 LoopEntry + 保留 LoopEventBadge/LoopActionPopover",
                        "E4: e2e 用 fixture meta.json 模拟 N+1 loop hash 变化 → 断言 UI 渲染 added/changed/removed/unchanged",
                        "后续 phase: server method 等价路径 (Agent 自查 diff)",
                    ],
                },
                "session_threads_index": {
                    title: "session_threads_index - user home = session 内 threads 索引目录",
                    content: `
                    User home (访问 \`/flows/<sid>\` 或 \`/flows/<sid>/threads/user/root\`) 不再是
                    "user 视角的 chat list", 而重定位为 **session 内 threads 的索引目录 + 关系可见**。
                    设计完整版见 docs/2026-05-26-session-threads-index-design.md。

                    视图形态 (A + B 折中):
                    - 默认渲染**多 Object 分栏 + 栏内 threadTree** (A)
                    - 选中某 thread 时**叠加关系连线** (B 的局部); 不画全图避免杂乱

                    threads 之间 4 种关系 (全部来自 OOC 已有数据, 不发明新协议):
                    - **creator** (do fork 子线程): thread.parentThreadId / childThreadIds → 树形缩进
                    - **talk** (跨 object callee): talk_window.target / targetThreadId → 跨栏箭头 / hover tooltip
                    - **share** (window 转移): window.sharing.kind="ref"|"lent_out" → 节点 chip + 详情
                    - **reflectable** (super flow): sessionId="super" → 折叠区域单独列 (不混入主分栏)

                    保留原 user.root 发消息流程:
                    - 选中 user.root 的 talk_window → 右栏仍渲染 ChatPanel (现有交互不破坏)
                    - 选中其它 thread → 右栏渲染 ThreadInspectDetail (只读检查面板)

                    路由扩展 (?selected= 协议):
                    - \`?selected=chat:<wid>\` → user.root 的 talk_window (现有)
                    - \`?selected=thread:<obj>:<tid>\` → 任意 (object, thread) 二元组 (新)

                    数据流 (lazy fetch):
                    - 列表: \`GET /api/flows/:sid/threads\` 扩展返回 metadata (status / parentThreadId /
                      childThreadIds / creatorThreadId / talkPeers / shares / createdAt / isSuperFlow)
                    - 选中后: \`GET /api/flows/:sid/objects/:oid/threads/:tid\` 拿完整 ThreadContext

                    不变量:
                    - **session 视角**: 只显示 sessionId 对应的 threads; super flow 独立 session 不混入
                    - **纯只读**: UI 不修改 thread 数据
                    - **不发明新协议**: 4 种关系全部 derive 自既有字段
                    - **不破坏 ChatPanel 流**: user.root.talk_window 选中时完全保留现有发消息能力
                    - **lazy fetch**: 列表用 metadata; 详情按需获取
                    `,
                    named: {
                        "SessionThreadsIndex": "user home 主组件; 渲染 session 内所有 (object, thread) 二元组",
                        "ObjectColumn": "单 object 分栏组件; 含 threadTree (root + children)",
                        "ThreadNode": "单 thread 节点; 含状态色点 + title + relation chips + hover tooltip",
                        "ThreadInspectDetail": "右栏 — 非 chat thread 的只读检查面板 (status / created / parent / shares / LoopTimeline 集成)",
                        "RelationOverlay": "选中 thread 时的关系叠加层; SVG 在 ObjectColumn 之上画连线 (creator/talk/share)",
                        "selected=thread:<obj>:<tid>": "URL 中表达选中任意 thread 的协议 (与 chat:<wid> 并列)",
                    },
                    patches: {
                        "data_extension": {
                            title: "listThreads API 扩展 - 关系字段返回",
                            content: `
                            原 \`GET /api/flows/:sid/threads\` 仅返 \`{ items: [{ objectId, threadId }] }\`,
                            不足以表达 4 种关系。本概念要求扩展 listThreads 返回:

                            \`\`\`
                            type ListThreadsItem = {
                              objectId: string;
                              threadId: string;
                              status: ThreadStatus;
                              createdAt?: number;
                              parentThreadId?: string;
                              creatorThreadId?: string;
                              creatorObjectId?: string;
                              childThreadIds: string[];
                              talkPeers: Array<{ targetObjectId, targetThreadId?, windowId }>;
                              shares: {
                                holding: Array<{ windowId, kind: "ref", ownerObjectId?, ownerThreadId? }>;
                                lentOut: Array<{ windowId, borrowerObjectId?, borrowerThreadId? }>;
                              };
                              isSuperFlow?: boolean;
                            }
                            \`\`\`

                            实现: 对每个 thread 调 readThread 拿完整 ThreadContext 后提取字段;
                            预期 session 内 threads < 50, 一次 listing 串行 fs.read 可接受 (<100ms)。
                            退化: thread.json 损坏 / ENOENT → status="failed" + 其它字段 undefined, 不抛错。
                            `,
                        },
                        "relation_overlay": {
                            title: "RelationOverlay - 选中 thread 时的关系连线 (A+B 折中)",
                            content: `
                            选中某 thread 后, SVG overlay 在分栏之上画该 thread 与其它 thread 的关系连线:
                            - **creator/parent**: 实线箭头 (子→父) 或 (父→子)
                            - **talk peer**: 虚线带箭头 (本 thread 的 talk_window → callee thread)
                            - **share lent_out**: 虚线 (本 thread → borrower thread)
                            - **share ref holding**: 虚线 (本 thread ← owner thread)

                            实现: 每个 ThreadNode 在 DOM 上有 \`data-thread-id\` + \`data-object-id\`;
                            overlay 通过 getBoundingClientRect 算出端点位置画 SVG line/path。

                            **不画全图**: 仅在选中状态下画当前 thread 的关系; 未选中时分栏内只有 hover tooltip
                            提示关系。这是 A (分栏) + B (按需画线) 的折中: 视觉清晰 + 关系可见。
                            `,
                        },
                        "select_routing": {
                            title: "?selected= 协议扩展 - chat + thread 两种 variant",
                            content: `
                            web/src/app/routing.ts 需扩展 \`selected\` 联合类型:
                            \`\`\`
                            type Selected =
                              | { kind: "chat"; windowId: string }      // 现有
                              | { kind: "thread"; objectId: string; threadId: string }; // 新
                            \`\`\`

                            URL 形态:
                            - 现有: \`?selected=chat:<wid>\`
                            - 新: \`?selected=thread:<obj>:<tid>\`

                            未识别的 tag silently dropped (与现有 unknown tag 处理一致)。
                            parseRouteState / toPath 同步更新。
                            `,
                        },
                        "chat_pane_preserved": {
                            title: "ChatPanel 保留路径 - 不破坏现有发消息流程",
                            content: `
                            SelectionDetail 根据 selected.kind 路由:
                            - \`chat:<wid>\` (user.root 的 talk_window) → 渲染 ChatPanel (现有, 不变)
                            - \`thread:<obj>:<tid>\` (任意 thread) → 渲染 ThreadInspectDetail (新, 只读)
                            - 未选中 → empty state (含 H-3 "去 welcome" 按钮 if no talk_windows)

                            这条边界保护: SessionThreadsIndex 是新的"枚举视图", 不替代 chat 交互。
                            选 user.root + talk_window 时, 整个 ChatPanel + composer + polling 都按现有逻辑工作。
                            `,
                        },
                    },
                    sources: [["docs/2026-05-26-session-threads-index-design.md", "完整 design (含 4 种关系定义 + 视图选型 + 数据需求 + 实施 D1~D5 分阶段)"]],
                    todo: [
                        "D2: 后端 service.listThreads 扩展返回 metadata + route-audit schema 断言",
                        "D3: 前端 SessionThreadsIndex / ObjectColumn / ThreadNode / ThreadInspectDetail + routing 扩展",
                        "D4: RelationOverlay 关系连线叠加层 (本 round MVP 必做)",
                        "D5: UserThreadHome 内部主体完全替换为 SessionThreadsIndex (保留 ChatPanel 路径)",
                    ],
                },
            },
            patches: {
                "stone_vs_flow_scope": {
                    title: "stone client 与 flow client/pages 的作用域选择",
                    content: `
                    选择哪一层取决于 "UI 与 session 状态的耦合程度":

                    - stone client（跨 session 稳定）适合 Object 的"主页"/"身份名片"/"长期面板"。
                    - flow client/pages（与 session 绑定）适合"本次任务进度"、"实时输出"、"会话内可编辑视图"。

                    错放的代价:
                    - 把临时 session 状态放 stone client → 其它 session 看到陈旧/无关 UI。
                    - 把跨 session 资源放 flow page → 每个 session 都得复制一遍，不易维护。
                    `,
                },
                "display_name_from_self_md": {
                    title: "displayName 派生约定 - UI 表层展示 objectId 时的语义化标题",
                    content: `
                    决策（2026-05-20，Supervisor）：OOC **不引入新的 displayName 字段**到 stone/flow 数据模型；
                    UI 表层需要展示 \`objectId\` 时（thread selector、breadcrumb、sidebar、chat 头等）
                    应**从该 Object 自己的 stone self.md 第一行 \`# Title\` 派生 displayName**。

                    设计动机:
                    - 与 reflectable 哲学一致：身份由 Object **自己写在 self.md 里**，不由外部赋予；
                      这与 \`createStoneObject\` 留白 self.md 让 Object 后续主动写入的契约也匹配（persistable.stone）。
                    - 零 schema 变更：现有 10 个 agent_of_* / supervisor 的 self.md 都已自然以
                      \`# AgentOfX（中文名）\` / \`# Supervisor\` 起首，无需 backend 迁移。
                    - 自洽元编程：Object 通过 super flow 更新 self.md 改自己身份 → 下一次 UI 加载看到新 displayName，
                      与 client_evolution 的演化链路对称。

                    UI 派生规则（前端实现指南）:
                    1. 取 self.md 内容 → split('\\n')[0] → 去掉前导 \`# \` → trim() → 即 displayName。
                    2. 缓存：UI 端按 objectId 缓存 self.md（与现有 stone-self.ts read 接口一致），TTL 同 stone 读取范式。
                    3. fallback：self.md 不存在 / 第一行不是 \`# ...\` / 内容为空 → 退回原始 objectId（防止空字符串）。
                    4. tooltip：UI 显示 displayName 的位置必须保留原始 objectId 在 hover/title attr，让调试可见。
                    5. 不要在 LLM 上下文中替换 objectId —— LLM 看到的仍是 objectId，displayName 纯前端表层。

                    边界与不做的事:
                    - 不引入 \`stone.displayName\` 字段、不引入 \`flow.displayName\` 字段、不引入 alias 表。
                    - 不允许 UI "重命名 Object" 的可写动作（如果有需求，Object 自己改 self.md 即可，复用 reflectable）。
                    - thread id 的语义化不在本约定范围（thread 没有 self.md）——
                      thread id 由 visible 自己用 createdAt / threadKind 等元信息做表层 humanize（参见 issue #3 A2 修复）。

                    与其它维度的关系:
                    - persistable.stone.self.md 是数据源（content[0] line）。
                    - collaborable: message.from 在 UI 层展示时同样适用本约定。
                    - reflectable: Object 想改自己的 displayName，去改 self.md 即可，是元编程闭环的自然延伸。
                    `,
                    named: {
                        "displayName 派生": "UI 表层从 self.md 第一行 # Title 派生的语义化标题",
                        "self.md 第一行": "约定的 displayName 数据源；空 / 缺失时退回 objectId",
                        "不引入 displayName 字段": "刻意不动 schema，保持数据模型最小",
                    },
                    sources: [["src/persistable/stone-self.ts", "self.md 的读写接口；displayName 派生只需 readSelf 后取首行"]],
                },
            },
            todo: [
                "agent-native parity 缺口（见 root.patches.agent_native_parity）：ui_methods 只经 HTTP 暴露给客户端，agent 端无等价 tool 路径。这是 parity 公理下的显式技术债，非可选演化。",
                "客户端渲染入口（把 .tsx 真正渲染成可交互页面的 host）当前仓库内没有；OOC 仅提供 tsx 文件路径与读写接口，渲染管线由外部消费方实现。需要在文档与 README 里明示这一边界。",
            ],
            warnings: [
                "stones/<self>/client/index.tsx 与 flow client/pages/*.tsx 文件被 OOC 写下来，但仓库内没有提供配套的客户端渲染器；纯文档/纯仓库层面无法直接 '看见' UI 效果，必须由外部消费方接入渲染。",
            ],
        },
        "extendable": {
            title: "extendable - 外接外部世界的集成层（非能力维度）",
            content: `
            extendable 不是 Agent 的内在能力维度（与上面 8 个并列），而是 OOC 触达外部系统的**扩展层**:
            把外部世界（飞书 / notion / slack / github 等）按统一模板接入为 Object 可调用的 ContextWindow 与 command。

            为什么不是维度: 它够的是外部世界、不构成 Agent 自我（判据见 root.patches.dimension_criterion）。"寄生于 executable"只是物理挂载事实，非排除理由。代码隔离在 src/extendable/ 下，避免外部 OAPI 细节污染 executable 核心。

            统一模板:
            1. OAPI 调用收口到 \`src/extendable/lark/cli.ts\` 的 larkExec helper（凭据 / 超时 / as-user 统一处理）。
            2. 每个外部系统建 \`src/extendable/<name>/\`，barrel（index.ts）自注册 WindowType + open command。
            3. executable 侧（src/executable/windows/root/index.ts）通过 extendable barrel 拉 open command，不反向依赖。

            新接一个外部世界（notion / slack / github）按相同模板建 \`src/extendable/<name>/\` 即可，不触碰 executable 核心（除非要新增 WindowType 字面量）。
            完整 case 见 meta/case.feishu-integration.doc.ts。
            `,
            named: {
                "extendable": "非能力维度的外接集成层：把外部世界按统一模板接入为可调用的 Window 与 command",
                "larkExec": "所有飞书 OAPI 调用的收口 helper，定义于 src/extendable/lark/cli.ts",
                "barrel 自注册": "每个 src/extendable/<name>/index.ts 导出 WindowType + open command，由 executable root 拉取注册",
            },
            relations: [
                [{ title: "executable", content: "extendable 寄生于 executable：新增 WindowType + open command 经 executable root 注册" }, "extendable 是 executable 的扩展点，物理隔离但逻辑挂载"],
            ],
            sources: [["src/extendable/", "外接集成层实现根目录；lark barrel 见 src/extendable/lark/index.ts，OAPI helper 见 src/extendable/lark/cli.ts:larkExec；case 见 meta/case.feishu-integration.doc.ts"]],
        },
    },
    patches: {
        "dimension_criterion": {
            title: "维度判定轴 - self-constitutive",
            content: `
            判定一个东西是不是 OOC Agent 的"内在能力维度"，标准是: 它是否**构成 Agent 的「自我」(self-constitutive)**。

            这条标准的来历（grill 定稿，否掉了一版更弱的标准）:
            - 弃用版: "维度 = 无法由组合其他维度得到的能力"。问题在于这是**静态实现快照**，会误砍掉"想发展的演化方向"——reflectable / visible 今天实现上确实寄生在别的维度上，但它们各自扛着"自我进化""GenUI"两条招牌演化轴。用"今天可不可组合"当尺子是错的。
            - 定稿版: 维度 = 构成 Agent「自我」的能力。即使实现寄生，只要它描述的是"Agent 自己的某个可演化面"，就是维度。

            按此标准，8 维度分两组:
            - 运行时底座: thinkable / executable / collaborable / observable / persistable —— Agent 据以存在、思考、行动、协作、被观测、落盘的基础。
            - 自我塑造三件套: reflectable（改知识/反思）/ programmable（改方法）/ visible（改界面）—— Agent 改写"自己"的三个面，是 OOC 自我进化主张的载体。

            extendable 被排除的**正面理由**: 它够的是**外部世界**（飞书/notion/...），外部系统不构成 Agent 自我，所以是"外接集成层"而非维度。
            注意: "寄生于 executable"**不是** extendable 被排除的真正理由（reflectable 也寄生于多个维度），真正的判据是"是否构成自我"。
            `,
            named: {
                "self-constitutive": "维度判定轴: 一个能力是否构成 Agent 的「自我」；是则为维度，否则为外接层/协议",
                "运行时底座": "thinkable/executable/collaborable/observable/persistable，Agent 存在与运作的基础五维",
                "自我塑造三件套": "reflectable/programmable/visible，Agent 改写自己知识/方法/界面的三维",
            },
        },
        "agent_native_parity": {
            title: "agent-native parity - 双消费方对称公理",
            content: `
            一条贯穿全维度的横切公理: **任何"用户（人类）能做的事，agent 也应能做"**——每个维度都同时有"人类面"与"agent 面"两个消费方，设计时都要回答这两面分别是什么、当前缺哪个。

            它不是某个维度专属，已在多处独立冒头:
            - observable: 人类在控制面看 debug/timeline；agent 自查自己历史（当前仍是缺口）。
            - visible: 人类通过 HTTP callMethod 调 ui_methods；agent 端等价 tool 路径（当前仍是缺口，见 visible.warnings）。
            - collaborable: agent 用 talk_window.say；人类用 app.client ChatPanel——同一件"发消息"两条通道。
            - executable.permission: agent 发起 command；人类在控制面 approve/reject。

            边界（对称的是"能不能做"，不是"看到的体量"）:
            - 对称的: 能否做某动作（发消息 / 调方法 / 查状态 / 反思）。
            - 不必对称的: 看到的体量。典型是 observable——人类 debug 可翻全量历史；agent 不在业务 thread 里全量自观测（会撞 context_budget + reasoning 不反复喂回）。
            - 正确形态不是"豁免对称"，而是"换执行场所": agent 的自观测放到 **super flow** 里做（独立 context，读落盘产物），人类在控制面看同一份产物。两面都全量，只是场所不同。

            落地要求: 升为公理后，各维度里"agent 面还没做"的 todo 应从"预留"改写为"违反 parity 公理的显式缺口"。
            `,
            named: {
                "agent-native parity": "横切公理: 用户能做的事 agent 也能做；每维度都有人类面/agent 面两个消费方",
                "双消费方对称": "agent-native parity 的别名，强调每个能力都要服务 agent 与人类两个消费方",
            },
        },
        "object_relations": {
            title: "对象关系三轴 + Supervisor=root parent + seed 信任链",
            content: `
            OOC 里 Object 之间有三种关系轴，各有不同的权力语义:

            1. 自我轴 — super（self-scoped）: Object 通过 sessionId="super" 的反思通道观察 / 修改"自己"。详见 reflectable。
            2. peer 平等轴 — talk / do / relation_window: 同级 Agent 之间平等协作，只能 talk（说服）不能直接改对方。详见 collaborable。
            3. parent-child 层级轴: child Agent 物理嵌套在 parent 的 children/ 下（objectId 用 "/" 编码）。此轴有三个侧面:
               - knowledge 继承（已有）: child 继承祖先 seed knowledge，见 thinkable.knowledge 的 B-tree 协议。
               - 可见性（已有）: 每轮默认派生 sibling + 一级 child 的 relation_window，见 collaborable.relation_window。
               - 修改权: **self-scope 自治**——object 改自己子树（含自己 seed）自治，cross-object 才 PR——见下。

            Supervisor = world 级最顶层 parent object: harness 的"1 Supervisor + N Agent"即这棵 object 树的实例——Supervisor 是 root parent，AgentOfX 是一级 children。

            修改权 = **self-scope 自治**（唯一规则，对所有 object 一视同仁；复用 stone-versioning 的 self/cross 划界）:
            - 任何 object 改自己子树 objects/<self>/...（含自己的 seed: self.md / readme.md / server / knowledge）= self-scope → 自治 ff-merge，无需任何人 review。
            - child 改自己（含自己 seed）= self-scope 自治，**不经 parent review**。
            - parent 改 child（child 物理在 objects/<parent>/children/<child>/，落在 parent 子树）= 对 parent 也是 self-scope → 自治。
            - cross-object（改不在自己子树的别人，如 child 改 parent）= cross-scope → PR-Issue review。
            - child sediment（pools/.../knowledge/memory|relations）= 运行时自治，写就生效，不进 git。
            - 运行时管控（叫停跑偏的 child）走 collaborable talk，不暴力写 child 运行时状态。

            user 闸门 = **git 本身**（不是 OOC 内的 PR gate）: 所有 stone 改动都进 git（write_file 写 stones/ 经 stone-versioning，详见 persistable.stone-versioning）。self-scope 自治 commit + git 历史给 user 兜底（review / rollback）。
            - user 双重语义: 运行时 passive（不思考、不作 peer，是交互起点 user.root）；设计期 supreme（git 层终极闸门）。
            - dogfooding 极限 = Object 自治演化自己（self-scope 不阻塞），但每次改动留 git 痕迹，user 通过 git 兜底——自举 ≠ 失控。
            `,
            named: {
                "对象关系三轴": "自我(super) / peer 平等(talk) / parent-child 层级，三种不同权力语义的关系",
                "parent-child 层级轴": "child Agent 嵌套在 parent/children/<child>/；含 knowledge 继承 / 可见性 / 修改权三侧面",
                "Supervisor=root parent": "harness 的最顶层 Supervisor 即 object 树的 root parent object",
                "self-scope 自治": "object 改自己子树（含自己 seed）自治 ff-merge 无需 review；cross-object 才 PR",
                "user 闸门=git": "user 通过 git history/review/rollback 兜底所有 stone 改动，非 OOC 内 PR gate",
            },
            todo: [
                "self-scope 自治已由 task#17 落地（write_file 写 stones/ 经 stone-versioning，self 自动 ff-merge / cross 走 PR）；嵌套 child 用完整 objectId 自 metaprog 需放开 isValidObjectId 允许 \"/\"（见 persistable.stone-versioning todo）。",
            ],
        },
    },
    warnings: [
        "【2026-05-26 移除特性】issue 看板（session 级共享议题 + issue_window + create_issue / open_issue / issue.comment / @mention 唤醒 + flows/<sid>/issues/ 文件存储 + issue-service / IssueWindow / deriveIssueWindowKnowledge）整套已从 OOC 中移除。原因：协作语义未想清楚，避免半成品概念污染设计空间。**不要**重新引入该概念到 meta 或代码；如未来需要类似机制，应作为新设计而非历史回滚。**注意区分**：stone-versioning 内部的 'PR-Issue' 是冲突决策的命名（self-scope vs cross-scope merge），与本处移除的 issue 看板**不是同一概念**，PR-Issue 保留。",
    ],
};
