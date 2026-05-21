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

    Agent 具有 stone 和 flow 两种模式:
    - stone: stone 象征 “静”，持有 Object 的长期数据和长期程序。
    - flow: flow 象征“动”，一个 Object 可以参与多个 session，每个 session 下有一个 flow ，每个 flow 都有自己的 session 级的数据字段和程序方法。

    Agent 由几个维度组合:
    - thinkable: 可以思考
    - executable: 可以行动
    - collaborable: 可以协作
    - observable: 可观测、记录、debug
    - reflectable: 可以自我反思、经验沉淀、元编程
    - programmable: 可以为自己编写函数方法（server 方法库）
    - visible: 可以为自己编写 UI 页面
    - persistable: 可以持久化存储
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
        "stone": "OOC Agent 的静态形态，定义 Agent 的长期数据和长期程序",
        "flow": "OOC Agent 的动态形态，定义 Agent 的 session 级数据和程序",
    },
    children: {
        "thinkable": {
            title: "OOC Agent thinkable 概念",
            content: `
            Thinkable 描述 Object 的思考能力。

            核心组成:
            1. LLM 交互模块: 思考的核心是与 LLM 交互，常规需要适配 OpenAI 和 Claude provider，并以 Responses-first 的 item 模型表达消息、tool call 与 tool result。
            2. ContextBuilder 模块: 设计如何构建 LLM 输入（context），通过统一的抽象信息单元 ContextWindow 来构建 context，ContextWindow 具有名为 command 的方法供 LLM 调用。
            3. 函数调用模块: 支持 LLM 调用函数程序，通过基础 tool (open/refine/submit/close) 来调用 ContextWindow command。额外具有 tool wait 用于等待 IO 结果。
            4. 类 SubAgent 模式支持: 思考的过程通过 thread 承载，thread 可以派生子 thread，形成一个 Thread Tree，每个 thread 可以并行思考。

            ContextWindow 是信息展示单元，也是可操作的对象，ContextWindow 提供名为 command 的窗口方法供 LLM 交互。

            基础工具 open 用于开启一个 ContextWindow，close 用于关闭一个 ContextWindow。
            基础场景是可以通过 open 工具打开一个文件，文件内容就会以 file 类型的 ContextWindow 出现在 LLM 的输入中。

            使用渐进式披露思想的多步函数调用:
                执行 command 时，会先通过 open tool 开启一个 form 类型的 ContextWindow，open 后系统会自动激活这个 command 的初始知识，告诉 LLM 如何执行这个 command。
                Form 可以通过 refine 工具多次填充表单参数，系统可以根据 CommandForm 填充的参数动态计算出填表所需的相应知识，最后通过 submit tool 触发 command 执行。

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
                "Command": "ContextWindow 上挂载的窗口方法，通过 open/refine/submit/close 由 LLM 间接调用",
                "open/refine/submit/close/wait": "基础 tool 集合，open/close 管理 ContextWindow，refine/submit 驱动 command 表单，wait 等待 IO",
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
                    - plan: 当前 thread 显式记录的计划，由 plan command 覆盖式更新。
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
                            - issue_window 订阅 session 级 Issue 看板。
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
                      - activates_on: 渐进式披露规则，结构为 { show_description_when?: string[]; show_content_when?: string[] }，命中前者只注入 description，命中后者注入完整正文。
                    - markdown body: frontmatter 之外的正文，构成 KnowledgeDoc.body。

                    Knowledge 的核心设计是渐进式激活:
                    LLM 还没进入某个行动路径时，只看到少量描述或完全看不到。
                    当 LLM 打开某个 command_exec window，并逐步 refine 参数时，系统根据 command path 自动激活对应知识。

                    例如:
                    - 打开 program command 时，激活程序执行相关知识。
                    - 打开 talk.relation_update 路径时，激活关系更新相关知识。
                    - 显式 open_knowledge 时，把某篇知识作为 knowledge_window 打开。

                    这样可以避免所有知识一股脑进入 Context，控制 token 体积，同时让 LLM 在需要时获得足够指导。
                    `,
                    named: {
                        "frontmatter": "markdown 文档头部的结构化元信息",
                        "activates_on": "knowledge 声明自身何时进入 Context 的激活规则",
                        "command path": "某个 command 的语义路径，如 talk.continue、talk.relation_update、program",
                        "knowledge_window": "把 knowledge 正文作为 ContextWindow 展示给 LLM 的窗口",
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
                            thread 之间不能直接读取彼此的 contextWindows / events / threadLocalData。

                            跨线程影响必须显式经过 inbox / outbox、do_window transcript 或 talk_window transcript。
                            这样所有协作痕迹都能被观察、回放和 debug。
                            `,
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
                    6. 分派 tool call: 把 open/refine/submit/close/wait 等调用交给 executable。
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
            },
        },
        "executable": {
            title: "OOC Agent executable 概念",
            content: `
            Executable 描述 Object 的行动能力。

            Thinkable 让 Object 能思考，Executable 让 Object 能改变世界。
            在 OOC 中，LLM 不直接调用任意函数，也不直接读写任意状态；它只能通过一组稳定的 tool 原语与 ContextWindow 交互。

            Executable 的核心分层:
            1. Tool 原语层: open / refine / submit / close / wait，是 LLM 直接看见的稳定接口（见 executable.tools.todo: compress 仍是规划项）。
            2. Command 层: do / talk / program / plan / todo / end / open_file / open_knowledge / write_file / glob / grep / create_issue / open_issue 等具体行动。
            3. ContextWindow 层: 行动产生或操作的上下文对象，比如 file_window、talk_window、program_window、do_window、issue_window。
            4. Registry / Manager 层: 注册不同 window type 的 command、render、close hook、basicKnowledge。
            5. Knowledge Activation 层: 根据 command path 自动激活执行所需知识。

            因此，Executable 不是 "给 LLM 一堆工具"。
            它是一套以 ContextWindow 为中心的行动协议: LLM 先打开一个行动窗口，逐步补充参数，提交执行，再根据执行结果继续思考。
            `,
            named: {
                "Executable": "Object 的行动能力维度，定义 LLM 如何通过 tool、command、ContextWindow 改变系统状态",
                "Tool": "LLM 直接可调用的稳定原语，如 open/refine/submit/close/wait",
                "Command": "具体行动单元，如 do/talk/program/open_file",
                "ContextWindow": "可展示、可操作、可挂载 command 的上下文窗口对象",
                "WindowType": "ContextWindow 的类型分支，如 root/file/program/talk/do/knowledge/search/issue",
                "CommandExec": "一次 command 调用过程对应的临时窗口，也可理解为 form window",
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

                    基础 tool（当前实现 5 个）:
                    - open: 打开一个 ContextWindow，或打开一次 command_exec 行动入口。
                    - refine: 为已经打开的 command_exec window 继续补充或修改参数。
                    - submit: 提交 command_exec window，真正触发 command 执行。
                    - close: 关闭一个 ContextWindow，或取消/清理一个 command_exec window。
                    - wait: 声明当前 thread 等待某个 talk_window / do_window 的未来 IO。

                    Tool 层的设计目标是让 LLM 学会少量稳定动作:
                    - 需要新信息时 open。
                    - 参数不够时 refine。
                    - 准备好后 submit。
                    - 用完后 close。
                    - 没有未来输入就 end，有未来输入才 wait。
                    `,
                    named: {
                        "open": "打开 window 或 command_exec 的工具原语",
                        "refine": "补充 command_exec 参数但不执行的工具原语",
                        "submit": "提交 command_exec 并触发 command 执行的工具原语",
                        "close": "关闭 window 或取消行动入口的工具原语",
                        "wait": "让当前 thread 等待未来 IO 的工具原语",
                    },
                    todo: [
                        "compress tool: 用于压缩当前 thread 的 events，控制长期运行体积。当前仅在 LlmToolName 类型联合与 ProcessEvent.toolName 中保留位置（src/thinkable/llm/types.ts、src/thinkable/context/index.ts），src/executable/tools/index.ts 注释明确 '暂不包括 compress'，TOOL_HANDLERS 也未注册。等待实现策略与触发时机定义后落地。",
                    ],
                    patches: {
                        "stable_tool_surface": {
                            title: "tool surface 应保持稳定",
                            content: `
                            LLM 直接学习的是 tool 原语。
                            如果每新增一个能力就新增一个 tool，模型的行动面会不断变化，调试和知识激活也会复杂化。

                            因此新能力应优先表现为新的 command 或新的 window type，而不是新的顶层 tool。
                            `,
                        },
                    },
                },
                "commands": {
                    title: "commands - 具体行动单元",
                    content: `
                    Command 是 LLM 通过 open / refine / submit 间接调用的具体行动。

                    LLM 通常不是直接 "调用 program 函数"，而是:
                    1. open(command="program") 打开一个 command_exec window。
                    2. refine(...) 补充代码、语言、执行参数等。
                    3. submit(...) 执行 command。
                    4. command 产生副作用，比如创建 program_window 或写入 thread.plan。

                    root window 注册一组顶层 command（与 src/executable/windows/root/index.ts ROOT_COMMANDS 一致）:
                    - do: 派生子 thread，创建 do_window。
                    - talk: 与 user 或其他 Object 对话，创建 talk_window。
                    - program: 执行 shell / javascript / typescript 等程序，创建 program_window。
                    - plan: 更新当前 thread 的 plan。
                    - todo: 创建可见待办 todo_window。
                    - end: 标记当前 thread 完成。
                    - open_file: 把文件作为 file_window 引入 Context。
                    - open_knowledge: 把知识文档作为 knowledge_window 引入 Context。
                    - write_file: 创建或覆盖文件，并通常打开对应 file_window。
                    - glob: 按文件名模式搜索，创建 search_window。
                    - grep: 按文件内容正则搜索，创建 search_window。
                    - create_issue: 在 session 内创建 Issue 看板议题，创建 issue_window 并自动订阅。
                    - open_issue: 把已有 Issue 拉进本 thread 作为订阅 window（dedup，不重复挂）。

                    Command Path 是 command 与 knowledge 协作的关键。
                    command 可以根据当前参数暴露更细的语义路径，比如 talk.continue、talk.wait、talk.relation_update。
                    knowledge 通过 activates_on 声明自己关心哪些 path，从而实现按需激活。
                    `,
                    named: {
                        "root window": "每个 thread 隐含存在的根窗口，注册顶层 command",
                        "do": "派生子 thread 的 command",
                        "talk": "开启或继续对话的 command",
                        "program": "执行程序的 command",
                        "plan": "更新 thread.plan 的 command",
                        "todo": "创建待办窗口的 command",
                        "end": "结束当前 thread 的 command",
                        "open_file": "把文件载入 Context 的 command",
                        "open_knowledge": "把知识文档载入 Context 的 command",
                        "write_file": "写入文件的 command",
                        "glob": "按路径模式查找文件的 command",
                        "grep": "按内容正则查找文件的 command",
                        "create_issue": "在 session 内创建 Issue 看板议题的 command",
                        "open_issue": "把已存在 Issue 订阅为 issue_window 的 command",
                    },
                    patches: {
                        "command_path_activation": {
                            title: "Command Path 驱动知识激活",
                            content: `
                            command path 是一种渐进式语义披露机制。

                            例:
                            - open(command="talk") 时，只激活 talk 基础知识。
                            - refine({ context: "continue" }) 后，激活 talk.continue 知识。
                            - refine({ type: "relation_update" }) 后，再激活 talk.relation_update 知识。

                            这样 LLM 只有在真正进入某条行动路径时，才看到该路径的完整操作说明。
                            `,
                        },
                    },
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

                            它类似一个 form:
                            - open 时创建，记录 command 名称和初始参数。
                            - refine 时累积参数，并重新计算 command path。
                            - submit 时执行 command。
                            - 成功后可自动移除，失败时保留 result 供 LLM 查看和修正。

                            command_exec window 让 "函数调用" 不再是一次性黑盒。
                            LLM 可以看见自己正在填写什么参数、还缺什么、激活了哪些知识、执行结果是什么。
                            `,
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
                    },
                },
                "window_types": {
                    title: "window types - 内置 ContextWindow 类型",
                    content: `
                    OOC 内置多种 ContextWindow type。

                    这些 type 不是 UI 组件分类，而是 LLM 的上下文对象分类（与 src/executable/windows/types.ts WindowType 联合一致）:
                    - root: 每个 thread 隐含存在的根 window，注册顶层 command。
                    - command_exec: 一次 command 调用的临时 form window。
                    - do: 子 thread 的父侧窗口，展示子任务状态与 transcript。
                    - talk: 与 user 或其他 Object 的持续会话窗口。
                    - todo: 可见待办窗口。
                    - program: 程序执行窗口，可多次 exec。
                    - file: 文件内容窗口，支持 range / reload / edit 等操作。
                    - knowledge: 知识文档窗口，承载显式打开或协议合成的 knowledge。
                    - search: glob / grep 搜索结果窗口，支持 open_match。
                    - issue: session 级 Issue 看板的订阅窗口；close 即取消订阅，Issue 自身 status 由每轮 deriveIssueWindowKnowledge 渲染。

                    每个 window type 都应该回答四个问题:
                    1. 它在 Context 中如何渲染给 LLM？
                    2. 它支持哪些 command？
                    3. 它何时可以 close，close 时有什么副作用？
                    4. 它需要向 LLM 注入什么 basicKnowledge？
                    `,
                    named: {
                        "root": "thread 的隐含根窗口，提供顶层 command",
                        "command_exec": "一次 command 调用的临时窗口",
                        "do_window": "父 thread 观察和继续子 thread 的窗口",
                        "talk_window": "与 user 或其他 Object 对话的窗口",
                        "todo_window": "可见待办窗口",
                        "program_window": "程序执行窗口",
                        "file_window": "文件内容窗口",
                        "knowledge_window": "知识文档窗口",
                        "search_window": "搜索结果窗口",
                        "issue_window": "session 级 Issue 看板的订阅窗口",
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

                    当 LLM 打开 command_exec window 时，系统根据 command 和当前参数计算 command path。
                    每一次 refine 都可能改变 command path，从而触发新的 knowledge 激活。

                    激活出来的 knowledge 会进入 Context，指导 LLM 如何继续填写参数或执行动作。

                    这形成一个闭环:
                    1. LLM open 一个 command。
                    2. 系统展示该 command 的基础知识。
                    3. LLM refine 参数。
                    4. 系统根据更具体的 command path 激活更具体的知识。
                    5. LLM submit 执行。

                    这个闭环让 OOC 可以把复杂能力拆成多步披露，而不是在一开始把所有说明都塞给 LLM。
                    `,
                    named: {
                        "knowledge activation": "根据 command path 把相关 knowledge 注入 Context 的过程",
                        "progressive disclosure": "渐进式披露，只在需要时展示更具体的信息",
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
            6. Issue: session 级共享议题；通过 create_issue / open_issue 派生 issue_window，构成跨 thread 的订阅协作。

            因此 collaborable 是 thinkable 和 executable 之上的协作语义层:
            thread 用消息说话，用 ContextWindow 持续维护一段对话或一个共享议题。
            `,
            named: {
                "Collaborable": "Object 的协作能力维度，定义 thread/object 间如何用消息与窗口协作",
                "ThreadMessage": "跨 thread 的最小消息单元，记录 from/to、object、window 归属与 source",
                "inbox / outbox": "thread 接收 / 发出消息的列表，是跨 thread 影响的唯一通道",
                "do_window": "同 object 内 fork 子线程的对话窗口",
                "talk_window": "跨 object 持续会话窗口",
                "talk-delivery": "跨 object 派送消息的统一入口",
                "creator window": "thread 启动时指向创建方的恒在窗口",
                "Issue": "session 级共享议题，用于多 object 协作",
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
                    do_window 与 talk_window 长得像，但语义不同。判定规则在 src/executable/windows/init.ts isCreatorSelf:
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
                    deliverTalkMessage（src/executable/windows/talk-delivery.ts）是跨 object 派送的唯一路径。
                    无论是 LLM 通过 talk_window.say 还是控制面代用户发，都汇集到这里。

                    一次派送做 5 件事:
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

                    UI 通知与 worker 调度不在本模块；前者由控制面自己决定何时 refresh，后者由 worker 自然轮询 running thread。
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
                    （src/executable/windows/init.ts）。

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
                    `,
                    named: {
                        "creatorWindowIdOf": "派生 creator window 稳定 id 的函数",
                        "isCreatorWindow": "标记某 window 为 creator window 的字段；true 时不可 close",
                        "user.root": "objectId='user' 且 thread.id='root' 的特殊 root thread，没有 creator",
                        "self-driven root": "没有 creator 信息的 root thread；不注入 phantom creator",
                    },
                },
                "issue": {
                    title: "issue - session 级共享议题",
                    content: `
                    Issue 是 session 内多个 flow object 共享的协作议题（参见 src/persistable/issue.ts / issue-service.ts）。

                    与 talk / do 的区别:
                    - talk / do 是一对一/父子的消息流，归属某条 thread。
                    - Issue 不归属任何 object，存放在 \`flows/<sessionId>/issues/\` 下（session 级共享）。
                    - 任何 object 都可订阅同一个 Issue（通过 issue_window），通过 comment + @mention 协作。

                    数据形态:
                    - Issue: { id, title, description?, status: open|closed, createdByObjectId, comments: Comment[], ... }
                    - Comment: { id, text, authorObjectId, authorKind: llm|user, mentions: string[], createdAt }
                    - IssueIndex: { nextId, issues: IssueIndexEntry[] } — 列表渲染用摘要，避免全量加载。

                    访问路径:
                    - LLM: 通过 root.create_issue / root.open_issue command 创建或订阅；产生 issue_window。
                    - 控制面 (HTTP): 通过 issue-service 走 enqueueSessionWrite 串行化写入，避免 index.json 被踩坏。

                    issue_window:
                    - 表示"本 thread 是否订阅该 Issue"；close 即取消订阅（WindowManager.close 默认语义）。
                    - 不带 status 字段，Issue 自身 status 每轮由 deriveIssueWindowKnowledge 渲染给 LLM。
                    - 内存字段 lastSeenCommentId / lastNotifiedAt 不持久化（详见 persistable.strip_volatile_for_persist）。
                    `,
                    named: {
                        "Issue": "session 级共享议题；status 为 open / closed",
                        "Comment": "Issue 内部按 id 单调递增追加的评论；带 @mention",
                        "issue_window": "本 thread 对某 Issue 的订阅窗口",
                        "create_issue / open_issue": "root window 上创建或订阅 Issue 的 command",
                        "@mention": "评论中 @ 某 objectId 触发对应 object 的 worker 唤醒",
                    },
                    patches: {
                        "session_scope": {
                            title: "Issue 是 session 级而非 object 级",
                            content: `
                            Issue 存放在 \`flows/<sessionId>/issues/\` 下，而不是某个 object 的 threads/ 目录里。

                            这一选择让多个 object 自然地共享同一个议题，不需要把 Issue 复制到每个 subscriber 的本地。
                            订阅关系通过各 thread 自己的 issue_window 表达；取消订阅 = close 自己的 issue_window，
                            不影响 Issue 本体与其它订阅者。
                            `,
                        },
                    },
                },
                "relation_window": {
                    title: "relation_window - peer 关系的专属 window type",
                    content: `
                    当 thread.contextWindows 中存在指向某 peer 的 talk_window 时，
                    每轮 render 时由 synthesizer 自动派生一组 window，承载"你对该 peer 的关系认知":

                    1. **RelationWindow**（type="relation"，id 稳定 \`w_rel_<peerId>\`）：
                       专属 window type，注册 \`edit\` command（详见 children/edit_command）。
                       这是 relation 的命令面入口——LLM 想更新 relation 不再依赖 write_file 弱 prompt。
                    2. **伴随 KnowledgeWindow**（source="relation"）：peer readme + 双层 self relation 正文：
                       - peer readme: \`stones/<peerId>/readme.md\`；不存在则跳过该条。
                       - self relation 合并体: 同一 KnowledgeWindow body 内分两段:
                         \`## long_term (stones/<self>/knowledge/relations/<peer>.md)\` +
                         \`## session (flows/<sid>/objects/<self>/knowledge/relations/<peer>.md)\`。
                         缺失的段显示占位提示，引导 LLM 走 \`relation_window.edit\` 命令。

                    **两层文件 (long_term × session)**:
                    - long_term: \`stones/<self>/knowledge/relations/<peer>.md\` —— 跨 session 长期认知；
                      只能由 super flow 写入（保 reflectable 元编程闭环）。
                    - session: \`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md\` —— 本 session 临时认知；
                      由 relation_window.edit(scope="session") 直接落盘，不污染长期 relations。

                    派生不持久化进 thread.contextWindows；id 稳定方便 UI 跨轮稳定。

                    跳过规则（全部静默，仅 console.debug）:
                    - target === SUPER_ALIAS_TARGET（super 自反）→ 完全跳过整组派生。
                    - thread.persistence 缺失 → 完全跳过。
                    - peer stones 目录 / readme.md 不存在 → 跳过 peer readme 那条（其它仍生成）。
                    `,
                    named: {
                        "RelationWindow": "type=\"relation\" 的 ContextWindow；relation 命令面入口",
                        "deriveRelationWindow": "按 talk_window peer 派生 RelationWindow 的函数",
                        "long_term relation": "stones/<self>/knowledge/relations/<peer>.md，跨 session 长期",
                        "session relation": "flows/<sid>/objects/<self>/knowledge/relations/<peer>.md，仅本 session",
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
                            super 收到后由 super flow 协议正常处理 stone 层 relation 的编辑。

                            两种 scope 都不绕过 reflectable 协议:
                            - session 是真正"局部认知"，本来就不属 reflectable 写入面；
                            - long_term 严格走 super，相当于把 "write_file stones/.../relations/..." 替换为
                              结构化的 talk 请求，super 仍是 stones 写入的唯一通道。
                            `,
                            named: {
                                "scope=session": "写 flow 层，立即生效，仅本 session 可见",
                                "scope=long_term": "派给 super flow，由 super 写 stone 层",
                                "临时 TalkWindow": "不挂到 thread 的一次性派送载体；避免 super 通道常驻 contextWindows",
                            },
                            sources: [["src/executable/windows/relation.ts", "RelationWindow + edit command 注册与 executeRelationEdit；派送复用 src/executable/windows/talk-delivery.ts:deliverTalkMessage；scope=session 写盘 src/persistable/flow-relation.ts:writeFlowRelation"]],
                        },
                    },
                    sources: [["src/executable/windows/relation.ts", "RelationWindow 与 edit command；派生函数 deriveRelationWindow / deriveRelationCompanionKnowledge 见 src/thinkable/knowledge/synthesizer.ts；flow 层文件 IO 见 src/persistable/flow-relation.ts"]],
                },
            },
            patches: {
                "no_shared_state_across_threads": {
                    title: "thread 之间不共享内存状态",
                    content: `
                    thread 不能直接读取彼此的 contextWindows / events / threadLocalData。

                    跨线程影响必须显式经过 inbox / outbox、do_window transcript 或 talk_window transcript。
                    这是 collaborable 的硬约束:让协作链路始终可观察、可回放、可 debug，
                    而不是依靠隐式的共享指针。
                    `,
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
            },
        },
        "observable": {
            title: "OOC Agent observable 概念",
            content: `
            Observable 描述 Object 的可观测能力。

            Object 在每一轮思考中产生的 LLM 输入输出、tool 调用、context 状态都应该可记录、可查看、
            可暂停、可回放。observable 不改变 Object 的行为，只在 thinkloop 周围加观测点，
            让人类（或上层控制面）能"看进去"。

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
                    - loop_NNNN.meta.json: provider / model / latencyMs / messageCount / toolCount / toolCallCount / contextBytes / status / error。

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
                        "ContextSnapshot": "结构化快照类型；字段子集见 src/persistable/debug-file.ts:14-24",
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
            },
        },
        "reflectable": {
            title: "OOC Agent reflectable 概念",
            content: `
            Reflectable 描述 Object 的自我反思能力 + 元编程的触发协议。

            Object 可以反思自己、沉淀经验、修改自身的知识与方法。
            OOC 不为此专门设一套"反思 API"，而是复用既有协作设施 —— 通过一个名为
            "super" 的特殊 session 把 Object 引到一条专用反思线程上，在那里改写自己的
            stone（self.md / readme.md / knowledge/memory）。下一轮新 thread 自动看见这些
            落盘的新内容，行为随之自我演化。

            核心组成:
            1. super session: 受保护的 sessionId（"super"），表示 Object 的反思通道。
            2. super alias target: talk_window.target === "super" 时被 talk-delivery 翻译为指向自己的 super 分身。
            3. Reflectable protocol knowledge: 当 thread.persistence.sessionId === "super" 时，synthesizer 自动注入 REFLECTABLE_KNOWLEDGE。
            4. memory 写入: super flow 中允许写 stones/<self>/{self.md, readme.md, knowledge/memory/*.md, knowledge/relations/*.md}。
            5. 元编程范围分工: reflectable 提供"为什么 / 何时 / 在哪条线程上"做元编程的协议；
               具体可改的对象由 programmable（函数方法库）与 visible（UI 页面）两个维度承担。

            Reflectable 不是新机制，是几个既有维度（collaborable.talk-delivery / persistable.stone /
            thinkable.knowledge）在 sessionId="super" 这个特殊上下文下被协同利用的结果。
            `,
            named: {
                "Reflectable": "Object 的反思 / 元编程能力维度",
                "super session": "受保护的 sessionId='super'，承载 Object 的反思线程",
                "super alias target": "talk_window.target='super'，翻译为指向自身的 super 分身",
                "REFLECTABLE_KNOWLEDGE": "进入 super flow 时自动注入的协议知识；告诉 LLM 反思场景该做什么",
                "memory": "stones/<self>/knowledge/memory/<slug>.md，Object 的长期记忆仓库",
                "metaprogramming": "通过 write_file 把新认知 / 新方法落到自己的 stone，下一轮自动生效",
            },
            children: {
                "super_session": {
                    title: "super_session - 受保护的反思通道",
                    content: `
                    SUPER_SESSION_ID = "super"（src/executable/windows/super-constants.ts）是被全系统硬编码识别的
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
                    （src/executable/windows/talk-delivery.ts:87-89）:
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
                    src/thinkable/knowledge/synthesizer.ts:162 处会检查 thread.persistence?.sessionId:
                    \`\`\`
                    if (thread.persistence?.sessionId === SUPER_SESSION_ID) {
                      protocolEntries[REFLECTABLE_BASIC_PATH] = REFLECTABLE_KNOWLEDGE;
                    }
                    \`\`\`

                    REFLECTABLE_KNOWLEDGE（src/thinkable/reflectable/reflectable-knowledge.ts）告诉 LLM:
                    - 你还是同一个 Object，super flow 只是另一条会话脉络。
                    - 本轮做反思 / 沉淀，不是执行新业务任务。
                    - 读 inbox 中 caller 的反思请求；理解对方要你沉淀 / 调整什么。
                    - 写到 stones/<self>/knowledge/memory/<slug>.md（slug 用 kebab-case 概括主题）。
                    - 必要时（caller 明确要求改身份）允许写 self.md / readme.md。
                    - 通过 creator talk_window 回复结论 (say + close)。
                    - 用 end command 结束本轮 super 思考。

                    这条协议知识只在 super flow 注入，普通业务线程不会看见。
                    `,
                    named: {
                        "REFLECTABLE_BASIC_PATH": "字符串常量 'internal/executable/reflectable/basic'",
                        "REFLECTABLE_KNOWLEDGE": "super flow 中要给 LLM 的协议知识正文",
                    },
                },
                "memory_layout": {
                    title: "memory_layout - 长期记忆的落盘位置",
                    content: `
                    super flow 中允许写的路径（来自 REFLECTABLE_KNOWLEDGE 约束）:
                    - stones/<self>/knowledge/memory/<slug>.md: 长期记忆仓库；每条记忆一个文件，slug 用 kebab-case。
                      示例: ooc-collaboration-framework.md、tool-error-handling.md。
                    - stones/<self>/self.md: 内部第一人称叙述（caller 明确要求改身份时）。
                    - stones/<self>/readme.md: 对外公开自述（caller 明确要求改对外说明时）。
                    - stones/<self>/knowledge/relations/<peer>.md: long_term relation 文件（与 collaborable.relation_window 联动；session 层另有 flows/<sid>/objects/<self>/knowledge/relations/<peer>.md 由 relation_window.edit(scope="session") 直接写入）。

                    禁止动的路径（不在 super flow 的工作范围内）:
                    - stones/<self>/server/ / client/ / files/ / .stone.json
                    - 任何业务 session 下的 thread.json
                    - 业务代码（program shell / file_window.edit 业务文件）

                    写入方式: 通过 open(command="write_file", path="...", content="...") 命令；
                    已存在的文件可用 open_file + edit 增量更新。
                    `,
                    named: {
                        "memory/<slug>.md": "长期记忆条目；一条记忆一个文件",
                        "kebab-case slug": "用短横线小写连字概括主题的命名风格",
                    },
                },
                "metaprogramming": {
                    title: "metaprogramming - 元编程闭环",
                    content: `
                    Reflectable 不只是"写感想"，更重要的是构成一个元编程闭环:

                    1. 业务线程遇到值得沉淀的事情，open 一个 target='super' 的 talk_window，say 反思请求。
                    2. talk-delivery 把请求派送到 super flow 下的反思 thread；该 thread 看见 REFLECTABLE_KNOWLEDGE。
                    3. 反思 thread 通过 write_file 把结论落到 stones/<self>/knowledge/memory/<slug>.md（或 self.md / readme.md）。
                    4. 反思 thread 通过 creator talk_window 简短回复，然后 end。
                    5. 下次（同 Object 的任意新 thread）启动时，新写入的 memory 文件作为 knowledge 自动出现在 Context 中，
                       LLM 看见新认知 / 新约束，行为随之改变。

                    Reflectable 只负责"为什么 / 何时 / 在哪条线程上"做元编程，不定义"改的东西具体是什么形状":
                    - 修改自身函数方法（server method library 的形状、加载、调用约定、版本演化）→ 见 programmable 维度。
                    - 修改自身 UI 页面（stone client / flow client/pages 的形状、agent-native 访问）→ 见 visible 维度。
                    - 修改自身知识 / 身份 / 数据（self.md / readme.md / data.json / knowledge）→ 这是 reflectable 默认覆盖的范围，
                      因为它们直接喂回 thinkable 的 context，闭环最短。

                    因此 super flow 的典型工作是写知识/身份/记忆/关系记录；如果 caller 显式请求改 server / client，
                    需要走 programmable / visible 定义的演化路径（详见对应维度的 patches）。
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

                    一定要 write_file 到 stones/<self>/knowledge/memory/<slug>.md，文件才是长期记忆。
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

                    super flow 默认仅写自身 stone 内的知识 / 身份 / 数据文件。
                    如果 caller 明确请求修改自身函数方法或 UI 页面，应走对应维度定义的演化路径:
                    - 编辑 stones/<self>/server/index.ts → 见 programmable.method_evolution。
                    - 编辑 stones/<self>/client/index.tsx 或 flow client/pages/*.tsx → 见 visible.client_evolution。

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

            核心组成:
            1. world root: \`{baseDir}/\`，包含 \`stones/\` 与 \`flows/\` 两棵子树。
            2. stone tree: 持久层，包含 \`stones/{branch}/objects/<objectId>/\`（per-Object
               长期身份与知识，跨 session 共享）以及未来挂在 \`stones/{branch}/\` 根的
               world-level 持久资源。
            3. flow tree: ephemeral 层，\`flows/{sessionId}/\` 既有 \`objects/<objectId>/\`
               （per-Object 在该 session 的工作产物）也有 session 级共享文件（如 \`issues/\`）。
            4. 三种 ref 抽象: FlowObjectRef / ThreadPersistenceRef / StoneObjectRef。
            5. 序列化策略: 写盘前剥离 in-process 内存字段（IssueWindow 的游标等），读盘时兜底补 creator window。

            **stone vs flow 是 World 级别的二分**（不是 Agent 级别的）：
            - stone = 持久（跨 session 永存）；flow = ephemeral（一次会话）
            - 两侧都有 \`objects/\` 中间层把 per-Object 与 world/session 级共享分开
            - LLM 提示词仍写 \`stones/<self>/...\`（rewriter 自动注入 branch + objects/）

            所有路径计算 / IO 都集中在 src/persistable/；其它层（executable / thinkable / observable）
            通过 ref + 函数调用访问磁盘，不直接拼路径。
            `,
            named: {
                "Persistable": "Object 的持久化能力维度，定义 stone / flow 文件树与 ref 抽象",
                "OOC world": "包含 stones/ 与 flows/ 两棵子树的统一文件树",
                "stone": "Object 的长期身份 / 知识目录；跨 session 共享",
                "flow": "Object 在某 session 内的临时运行状态",
                "FlowObjectRef": "定位 flow object 目录的 ref（baseDir/sessionId/objectId）",
                "ThreadPersistenceRef": "FlowObjectRef + threadId，定位单条 thread",
                "StoneObjectRef": "定位 stone 目录的 ref（baseDir/objectId）",
                "deriveStoneFromThread": "从 ThreadPersistenceRef 派生 StoneObjectRef 的便捷函数",
            },
            children: {
                "world_layout": {
                    title: "world_layout - OOC world 目录结构",
                    content: `
                    完整目录形态（参见 src/persistable/common.ts + flow-object.ts + stone-object.ts + issue.ts + debug-file.ts）:

                    \`\`\`
                    {baseDir}/
                      stones/
                        .stones_repo/              ← bare git repo（详见 stone_versioning）
                        <branch>/                  ← linked worktree（main + 任意 metaprog 分支）
                          .git                     ← 文件，gitdir 指回 .stones_repo/worktrees/<branch>
                          objects/                 ← per-Object 持久区（2026-05-21 引入）
                            <objectId>/
                              .stone.json          ← stone 元数据（type='stone', objectId）
                              self.md              ← 对内身份（写入 LlmGenerateParams.instructions）
                              readme.md            ← 对外公开介绍
                              data.json            ← stone 数据（顶层 spread merge）
                              knowledge/
                                memory/            ← 长期记忆（reflectable 写入位置）
                                relations/<peer>.md ← 对各 peer 的认知
                                ...其它 knowledge 文档
                              server/index.ts      ← stone server 源码
                              client/index.tsx     ← stone client 源码
                              files/               ← 用户文件留存位
                          # （未来：world-level 资源放在 stones/<branch>/ 根本身，
                          #   与 objects/ 子目录物理分离）
                      flows/
                        <sessionId>/
                          .session.json          ← session 元数据（type='flow-session', sessionId, title）
                          issues/
                            index.json           ← Issue 索引（nextId + 摘要列表）
                            issue-{id}.json      ← 单 Issue 完整内容
                          objects/
                            <objectId>/
                              .flow.json         ← flow object 元数据
                              threads/<threadId>/
                                thread.json      ← thread 序列化
                                debug/           ← observable 落盘的 input/output/loop 文件
                              client/pages/      ← flow 级 client 页面
                    \`\`\`

                    **关于 stones/<branch>/objects/ 中间层（2026-05-21 重组）**：
                    flow vs stone 不是 OOC Agent 才有的状态——整个 OOC World 都按
                    "stone（持久）vs flow（单次会话）" 二分；flows/ 已有 \`<sid>/objects/\`
                    把"per-Object 在该 session 的工作产物"与"session 级共享文件（如
                    issues/）"分开，stones/ 现在对称地用 \`<branch>/objects/\` 把
                    "per-Object 持久身份"与"world-level 持久资源"分开。

                    这让 \`stones/<branch>/\` 根本身可承载未来的 world-level stone 资源
                    （注册表、共享知识、PR-Issue 长寿存储等），不必为它们造新的顶级目录。
                    LLM 提示词仍写 \`stones/<self>/...\`（\`session-path.ts:rewriteStonesPath\`
                    自动注入 branch 与 \`objects/\`）；只有 metaprog 协议 / scope 判定 /
                    bootstrap migration 等系统层显式知道 \`objects/\` 这一层。

                    路径计算函数：objectDir / threadDir / stoneDir / sessionDir / issueFile / issueIndexFile /
                    llmInputFile / llmOutputFile / loopInputFile / loopOutputFile / loopMetaFile。
                    `,
                    named: {
                        ".stone.json / .flow.json / .session.json": "三类元数据文件，标记目录类型与归属",
                        "objectDir / threadDir / stoneDir / sessionDir": "路径计算函数，避免散落拼接",
                    },
                },
                "stone": {
                    title: "stone - Object 的长期身份与知识",
                    content: `
                    stone（src/persistable/stone-object.ts）是 Object 跨 session 持续存在的部分。
                    无论 Object 参与了哪些 session，它的 stone 都是同一份。

                    子项与用途:
                    - self.md (stone-self.ts): 对内身份；readSelf / writeSelf；buildInputItems 时读取并注入 LlmGenerateParams.instructions。
                    - readme.md (stone-readme.ts): 对外公开介绍；其它 Object 在 collaborable.relation_window 的伴随 KnowledgeWindow 中会读到。
                    - data.json (stone-data.ts): 结构化数据；readData / writeData 整体覆盖、mergeData 顶层 spread 合并。
                    - knowledge/ (stone-object.ts knowledgeDir / memoryDir / relationsDir / relationFile / readRelation):
                      Object 的知识文档；memory 子目录是 reflectable 的写入位置，relations 子目录承载关系认知。
                    - server/index.ts (stone-server.ts): stone server 源码；readServerSource / writeServerSource，自动 mkdir。
                    - client/index.tsx (stone-client.ts): stone client 源码；readStoneClientSource / writeStoneClientSource。
                    - files/ (stone-object.ts filesDir): 用户文件留存位。

                    createStoneObject 创建完整目录骨架 + 写 .stone.json，但不写 self.md / readme.md / data.json / server/index.ts ——
                    这些由 Object 后续主动写入。
                    `,
                    named: {
                        "self.md / readme.md / data.json": "stone 的身份 + 公开介绍 + 数据三件套",
                        "knowledge/memory": "长期记忆目录",
                        "knowledge/relations/<peer>.md": "对各 peer 的认知文件",
                        "stone server / client": "stone 自带的服务端 / 客户端源码",
                        "createStoneObject": "创建 stone 骨架的函数；不写入业务内容文件",
                        "self.md 第一行 = displayName": "UI 表层展示 objectId 时从 self.md 首行派生语义化标题；详见 visible.display_name_from_self_md",
                    },
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
                    },
                },
                "issue_files": {
                    title: "issue_files - session 级共享议题文件",
                    content: `
                    Issue 文件不在某个 object 下，而在 \`flows/<sessionId>/issues/\` 中（src/persistable/issue.ts）。
                    这与 collaborable.issue 的"session 级共享"决定相符。

                    文件:
                    - index.json: { nextId, issues: IssueIndexEntry[] }；列表渲染用摘要，避免每次全量加载 issue-*.json。
                    - issue-{id}.json: 单 Issue 完整内容（含 comments[]）。

                    路径计算函数: issuesDir / issueFile(baseDir, sessionId, issueId) / issueIndexFile(baseDir, sessionId)。

                    sessionId 严格校验（防 path-traversal）:
                    - 模式 \`/^[a-zA-Z0-9_-]{1,64}$/\`，不允许 . / \\ .. 等。
                    - 拼绝对文件路径前一律调用 ensureSessionId，HFS+ percent-encoded 也阻挡。

                    读 API 兜底:
                    - readIssue 不存在返回 undefined（ENOENT 静默）。
                    - readIssueIndex 不存在返回空 \`{ nextId: 1, issues: [] }\`，便于首次创建。

                    串行化:
                    - issue-service.ts 通过 enqueueSessionWrite(sessionId, ...) 串行 createIssue / appendComment / closeIssue，
                      避免 index.json 被踩坏。
                    `,
                    named: {
                        "issues/index.json": "Issue 索引文件；含 nextId 与摘要列表",
                        "issues/issue-{id}.json": "单 Issue 完整内容",
                        "ensureSessionId": "拼路径前的严格校验",
                        "enqueueSessionWrite": "session 级写串行化队列",
                    },
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
                    - LlmLoopDebugMetaRecord: 见 src/persistable/debug-file.ts:100-129，包含 latency / messageCount / status / error 等观测指标。
                    `,
                    named: {
                        "debugDir": "thread 的 debug 子目录路径",
                        "llm.input.json / llm.output.json": "最近一次 LLM 调用的两个常驻文件",
                        "loop_NNNN.*.json": "loop-level 三类文件",
                    },
                },
                "refs": {
                    title: "refs - 三种 ref 抽象",
                    content: `
                    src/persistable/common.ts 定义了三种 ref，承担所有路径计算的入口:

                    \`\`\`
                    FlowObjectRef       = { baseDir, sessionId, objectId }
                    ThreadPersistenceRef = FlowObjectRef & { threadId }
                    StoneObjectRef       = { baseDir, objectId }
                    \`\`\`

                    转换:
                    - deriveStoneFromThread(threadRef): { baseDir: threadRef.baseDir, objectId: threadRef.objectId }，
                      让 program / server / 反思场景从 thread 切到 stone 视角。

                    设计要点:
                    - ref 是纯数据，不持有句柄；可以自由序列化、跨进程传递。
                    - 所有路径函数（objectDir / threadDir / stoneDir / sessionDir）输入是 ref，输出是绝对路径字符串。
                    - 其它层（executable / thinkable）从不直接拼 path，统一通过 ref + helper。
                    `,
                    named: {
                        "FlowObjectRef": "{ baseDir, sessionId, objectId }",
                        "ThreadPersistenceRef": "FlowObjectRef + threadId",
                        "StoneObjectRef": "{ baseDir, objectId }",
                        "deriveStoneFromThread": "从 thread ref 派生 stone ref",
                    },
                },
            },
            patches: {
                "strip_volatile_for_persist": {
                    title: "持久化前剥离 in-process 字段",
                    content: `
                    stripVolatileForPersist（src/persistable/thread-json.ts:30-41）在 writeThread 前剥离纯内存字段:
                    - IssueWindow.lastSeenCommentId: worker 内存里维护的"已读评论游标"。
                    - IssueWindow.lastNotifiedAt: 10s 限频的"上次写 inbox 通知时间"。

                    这两个字段不进 thread.json，否则:
                    - worker 重启后游标可能比 Issue 文件还前进，导致永远收不到新评论通知。
                    - 或者 Issue 文件回滚后游标错位，造成 hang。

                    重启后首次 sync 视为"已读全部当前评论"，再增量推进。
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
                    - flows/、debug/ 等运行时产物不入 git（R2）

                    架构对称性：main 不再是"主仓库"，跟未来添加的任何 worktree 平级。
                    新 worktree 通过 \`git -C stones/.stones_repo worktree add ../{name} {branch}\` 加挂。
                    （灵感来自 plugins_worktrees 的 \`.plugins_repo/\` 模式。）

                    OOC Server 启动接受 \`--stones-branch=<name>\`（默认 main），所有 stoneDir 解析为
                    \`{baseDir}/stones/{stonesBranch}/objects/{objectId}\`（2026-05-21 起 \`objects/\`
                    中间层，详见 world_layout）。Object 想做高赌注修改时不直接写 main，
                    通过 metaprog 协议（programmable.metaprog_protocol）开 worktree → 编辑 → 试运行 → commit → merge。

                    路径划界（R5/R6）：commit 累积 diff（vs main merge-base）的所有路径都以 \`objects/{authorObjectId}/\`
                    开头 → self-scope，自治 fast-forward merge；任一路径越界 → cross-scope，整 commit 走 PR-Issue
                    给 supervisor 评审。Supervisor（R12）是元自治例外，不参与本协议。

                    错误自我编程的恢复（F3）：启动期 recovery-check 自检每个 Object 的 server/index.ts；
                    加载失败的开 [recovery-needed] PR-Issue 给 supervisor，由 supervisor metaprog rollback。

                    布局演化兼容：早期非 bare 形态（\`stones/main/.git/\` 是目录）被识别为
                    \`layout: "legacy-embedded"\`，保持原状不强制升级；新建 world 一律走 bare。
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
                        "recovery-check": "启动期自检；server/index.ts 加载失败的 Object 自动开 [recovery-needed] Issue",
                        "Bootstrap commit": "首次启动 author=bootstrap 的一次性 squash commit，通过临时 clone scratch 灌入 bare repo 后 push",
                        "legacy-embedded": "已有 world 的非 bare 老式布局（main/.git/ 是目录）；ensureStoneRepo 兼容识别但不强制升级",
                    },
                    sources: [
                        [
                            "src/persistable/stone-versioning.ts",
                            "openMetaprogWorktree / commitWorktree / classifyWorktreeBranch / tryMergeSelf / requestPrIssueReview / resolvePrIssue / rollback / pruneStaleWorktrees；R12 supervisor 例外；所有 git 操作通过 enqueueSessionWrite('git:'+baseDir) 串行；底层 git 命令在 src/persistable/stone-git.ts；bare init + linked worktree 编排在 src/persistable/stone-bootstrap.ts:ensureStoneRepo (createBareRepoWithMainWorktree 处理 bootstrap commit 通过 scratch clone 灌入 bare)；启动期 recovery-check 在 src/app/server/bootstrap/recovery-check.ts",
                        ],
                    ],
                },
            },
        },
        "programmable": {
            title: "OOC Agent programmable 概念",
            content: `
            Programmable 描述 Object 持有并演化自身函数方法库的能力。

            Object 在自己的 stone 里有一份 \`server/index.ts\`，导出 llm_methods / ui_methods 两份方法字典。
            这些方法 *不是* OOC 的内置 tool，也不是新的 LLM tool；它们是 Object 自己写给自己的"可被复用的函数程序"。
            LLM 通过既有的 \`executable.commands.program\` (function 模式) 调用 llm_methods；
            UI / agent-native 客户端通过 HTTP 调用 ui_methods。

            核心组成:
            1. server method 形状: ServerMethod = { description? / params? / knowledge? / fn }；fn(ctx, args) 是真正执行入口。
            2. 双字典分流: llm_methods 给 LLM 用（通过 program.function）；ui_methods 给 UI / agent-native 用（通过 HTTP callMethod）。
            3. ProgramSelf 注入: program ts/js sandbox 收到 self = { dir, callMethod, getData, setData, getThreadLocal, setThreadLocal }。
            4. 动态加载与热更: loader 按 \`server/index.ts\` 的 mtime 缓存；写文件后下一次调用自动重新 import。
            5. 元编程闭环（与 reflectable 配合）: super flow 通过 write_file 写 server/index.ts → 下一次 callMethod 看到新方法。

            Programmable 不是新增 LLM tool 面，而是给 Object 一个"私有函数库"，让它可以把高频动作或复杂逻辑封装成命名方法，
            然后通过 program.function 一行调用，避免每次都重写代码。
            `,
            named: {
                "Programmable": "Object 持有/演化自身函数方法库的能力维度",
                "ServerMethod": "单个可被注册到 server 的方法：{ description?, params?, knowledge?, fn }",
                "llm_methods": "server/index.ts 导出的、给 LLM 通过 program.function 调用的方法字典",
                "ui_methods": "server/index.ts 导出的、给 UI/agent-native 通过 HTTP callMethod 调用的方法字典",
                "ProgramSelf": "program ts/js sandbox 注入的 self 对象，承载 callMethod / getData / setData / getThreadLocal",
                "loadLlmServerMethods / loadUiServerMethods": "按 mtime 缓存、自动热更的 server 方法加载器",
                "ServerMethodContext": "server method 执行时收到的 ctx：{ self, thread: { id, inject } }",
            },
            children: {
                "server_method_library": {
                    title: "server_method_library - 方法库的形状",
                    content: `
                    每个 Object 的方法库定义在 \`stones/<self>/server/index.ts\`，导出两份字典:
                    \`\`\`
                    export const llm_methods: Record<string, ServerMethod> = { ... };
                    export const ui_methods: Record<string, ServerMethod> = { ... };
                    \`\`\`

                    ServerMethod 字段（src/executable/server/types.ts:36-58）:
                    - description?: 给调用方看的方法说明。
                    - params?: 参数定义（name / type? / description? / required?）；当前 *不强制* schema 校验。
                    - knowledge?: 动态知识函数 (args) => string；与 command.match(args) → paths 同理，
                      在 program.function 模式下被并入 \`internal/executable/program/function\` 的 knowledge entry。
                      缺省时由默认实现从 description + params 拼基线文本。
                    - fn: (ctx: ServerMethodContext, args: Record<string, unknown>) => unknown | Promise<unknown>，真正执行入口。

                    ctx 形态:
                    - ctx.self: 同 ProgramSelf，方法内部可以继续调其它 method。
                    - ctx.thread: { id, inject(text) }，方便方法在执行中向调用方线程注入 context_change/inject 事件。
                    `,
                    named: {
                        "stones/<self>/server/index.ts": "方法库源码文件路径",
                        "ServerMethod.fn": "方法的真正执行入口；返回值由 program 路径作为 returnValue 暴露",
                        "ctx.thread.inject": "方法主动写一条 context_change/inject 事件给调用方",
                    },
                },
                "loader": {
                    title: "loader - 加载与热更",
                    content: `
                    src/executable/server/loader.ts 负责按需 import server/index.ts，并按 mtime 缓存:

                    \`\`\`
                    const mod = await import(\`\${file}?t=\${mtime}\`);  // ?t=mtime 破坏 Node import cache
                    \`\`\`

                    行为:
                    - 文件 ENOENT → 返回 {}，调用方拿到空字典而非异常。
                    - mtime 未变 → 复用缓存条目，不重新 import。
                    - mtime 变化 → 走新的 query string，等价于强制重新 import 一份新模块。
                    - 解析失败 → 抛带原始错误信息的异常，由调用方决定怎么呈现。

                    暴露的接口:
                    - loadLlmServerMethods(stoneRef) / loadUiServerMethods(stoneRef): 分别取两份字典。
                    - loadServerMethods 是 loadLlmServerMethods 的别名（兼容旧调用方）。
                    - clearServerLoaderCache(): 测试钩子，清空缓存以避免测试间互相污染。
                    `,
                    named: {
                        "?t=mtime": "破坏 Node import cache 的 query string trick",
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
                    - callMethod(name, args?): lazy load + reload server/index.ts，找到 llm_methods[name] 后调用 fn(ctx, args)。
                      找不到时抛出 \`方法 X 不存在；当前可用：a, b, c\` 的错误。
                    - getData(key) / setData(key, value): 读写 stone 的 data.json；setData 是顶层 merge 而非整体覆盖。
                    - getThreadLocal(key) / setThreadLocal(key, value): 读写 thread.threadLocalData；
                      跨 exec 共享（程序窗口同一线程内的 ts/js exec 之间），但不持久化（重启即丢）。

                    ProgramSelf 在两条路径上被使用:
                    - program command ts/js exec: sandbox 把 self 注入到用户代码（详见 executable.commands.program 与 src/executable/program/sandbox/）。
                    - program.function exec: runFunctionProgram(thread, fn, args) 直接 self.callMethod(fn, args) 拿返回值。
                    `,
                    named: {
                        "createProgramSelf": "构造 ProgramSelf 的工厂函数",
                        "self.callMethod": "调用 server 方法的入口；自动 lazy load + 按 mtime reload",
                        "threadLocalData": "thread 级共享数据；ts/js exec 间通过 self.getThreadLocal/setThreadLocal 传值",
                    },
                },
                "llm_invocation_paths": {
                    title: "llm_invocation_paths - LLM 调用方法的两条路径",
                    content: `
                    LLM 不直接看见 server 方法库，它通过既有的 program command 间接调用，有两种调用形态:

                    **路径 A: program.function 一行调用（推荐）**
                    \`\`\`
                    open(command="program", args={ function: "doX", args: { ... } })
                    \`\`\`
                    系统走 src/executable/program/function.ts:runFunctionProgram，直接 self.callMethod(fn, args)，
                    返回值被 formatProgramResult 包成可读字符串进入 program_window.history。
                    适合"调用一个明确的、命名好的方法"。

                    **路径 B: program ts/js exec 里手动调用**
                    \`\`\`
                    open(command="program", args={ language: "ts", code: "return await self.callMethod('doX', { ... });" })
                    \`\`\`
                    sandbox 注入了 self，用户代码可以做任意计算 + 多次 callMethod。
                    适合"组合多个方法、做一些数据处理后再调用"。

                    两条路径共享同一份 ProgramSelf 与同一份 llm_methods 字典，行为一致；只是入口形态不同。
                    program.function 模式下，knowledge() 函数会针对当前 args 给 LLM 注入更具体的提示。
                    `,
                    named: {
                        "program.function": "program command 的 function 模式；一行直接调 server 方法",
                        "runFunctionProgram": "function 路径的执行入口",
                        "formatProgramResult": "把 returnValue / error 包成可读字符串的格式化函数",
                    },
                },
                "method_evolution": {
                    title: "method_evolution - 方法库的演化路径",
                    content: `
                    Object 演化自身方法库的标准路径:

                    1. 触发点（典型: reflectable.metaprogramming 的反思请求）。
                    2. super flow 中通过 \`open(command="write_file", path="stones/<self>/server/index.ts", content="...")\` 重写方法库源码。
                    3. 下一次 callMethod 触发时，loader 看到 mtime 变化 → ?t=mtime 强制重新 import → 新方法立刻生效。
                    4. 不需要重启进程、不需要重新部署。

                    写新方法时需要遵守 ServerMethod 形状（fn 必填）；description / params / knowledge 可选但建议补全，
                    因为 LLM 在 program.function 模式下会看见对应的 knowledge entry，写得清楚直接影响调用质量。

                    更细的边界（路径权限、是否允许 super flow 自动写 server）由 reflectable.business_task_isolation 与
                    caller 的显式请求共同决定；programmable 本身只描述 *如何写* 才能生效，不规定 *谁可以写*。
                    `,
                    named: {
                        "writeServerSource": "src/persistable/stone-server.ts:22-25，覆盖式写 server/index.ts",
                        "热更生效条件": "mtime 变化 → loader cache 失效 → 下一次 callMethod 重新 import",
                    },
                },
            },
            patches: {
                "llm_vs_ui_methods": {
                    title: "llm_methods 与 ui_methods 的分流",
                    content: `
                    同一份 server/index.ts 中两个字典服务不同调用方:

                    - llm_methods: 给 LLM 通过 program.function 调用；走 createProgramSelf → loadLlmServerMethods。
                      入参由 LLM 在 program form 里填，返回值进 program_window.history 让 LLM 看到。
                    - ui_methods: 给 UI / agent-native 客户端通过 HTTP 调用；由 app/server flows.callMethod 或
                      stones.callMethod 路径 (src/app/server/modules/flows/service.ts:483- / stones/service.ts:157)
                      走 loadUiServerMethods 拿到方法字典并执行。

                    两个字典共享同一份 ServerMethod 形状与 loader 缓存条目；但调用入口、调用方身份、错误呈现位置不同。
                    一个方法到底该放哪个字典，看的是"调用方是 LLM 还是用户/agent"。如果两者都需要，可以同时挂在两个字典里。
                    `,
                },
                "per_object_isolation": {
                    title: "server 是 stone 级别，跨 session 共享",
                    content: `
                    server/index.ts 位于 \`stones/<self>/\` 下，不是 \`flows/<sid>/objects/<obj>/\` 下。

                    含义:
                    - 同一个 Object 在不同 session 里看见同一份方法库；不会"换 session 就丢方法"。
                    - 多个 session 并发调用同一个方法时共享 loader 缓存条目；mtime 变化对所有 session 一起生效。
                    - 没有 flow 级私有方法库；如需 session 特化逻辑，应该在方法内通过 ctx.thread / self.getData 区分，
                      而不是 fork 一份新的 server。
                    `,
                },
            },
            todo: [
                "params schema 校验当前未实现（src/executable/server/types.ts:42 注释明确 '当前不强制校验'）。如果未来要支持自动参数检查/转换，需要在 program.function 路径 + ui callMethod 路径都加上。",
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

                    - flow 级: src/app/server/modules/flows/service.ts:483- callMethod({ sessionId, objectId, method, args })
                      → loadUiServerMethods({ baseDir, objectId }) → 找到 ui_methods[method] → 执行 fn。
                    - stone 级: src/app/server/modules/stones/service.ts:157 走同样的 loader + 调度路径。

                    错误形态（与 AppServerError 协议一致）:
                    - 加载失败 → \`METHOD_LOAD_FAILED\`。
                    - 方法不存在 → \`METHOD_NOT_FOUND\`。
                    - 执行抛错 → 由 service 层兜底转 AppServerError 返回给 HTTP 调用方。

                    这条路径与 LLM 的 program.function 路径在同一份 server/index.ts 上分流（按 llm_methods vs ui_methods 字典），
                    互不干扰。
                    `,
                    named: {
                        "flows.callMethod / stones.callMethod": "app/server 暴露的 HTTP 入口",
                        "loadUiServerMethods": "拿到 ui_methods 字典的 loader 接口（与 llm_methods 共用缓存条目）",
                        "AppServerError": "app/server 统一错误协议",
                    },
                },
                "client_evolution": {
                    title: "client_evolution - UI 资源的演化路径",
                    content: `
                    Object 演化自身 UI 的标准路径:

                    1. 触发点（典型: caller 明确要求 'UI 需要加一个 X 视图' 类反思请求）。
                    2. super flow 中通过 \`open(command="write_file", path="stones/<self>/client/index.tsx", content="...")\` 重写 stone client；
                       或写 flow 级 page \`open(command="write_file", path="flows/<sid>/objects/<obj>/client/pages/<page>.tsx", content="...")\`。
                    3. 下次客户端加载该路径时拿到新 tsx 源码（具体打包/渲染管线由消费方实现）。
                    4. 如果新 UI 要调用新方法，需要先把对应 ui_methods 写到 server/index.ts（程序面与界面面分别演化）。

                    与 programmable.method_evolution 的对应关系: 一个改方法、一个改界面；两者都通过 write_file + loader/打包 自然热更。
                    `,
                    named: {
                        "client tsx 演化": "write_file → 下次客户端加载看到新版",
                        "界面与方法分离演化": "tsx 与 server/index.ts 是两份文件；界面要新能力时常需先扩 ui_methods",
                    },
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
                    UI 表层需要展示 \`objectId\` 时（thread selector、breadcrumb、sidebar、chat 头、Issue author chip 等）
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
                    - collaborable: Issue.createdByObjectId / message.from 在 UI 层展示时同样适用本约定。
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
                "agent-native UI 等价路径尚未实现：当前 ui_methods 只通过 HTTP 暴露给客户端，agent 端没有等价的 tool 路径可走（'任何用户能做的事 agent 也能做'尚未在代码层达成）。设计上属于 visible 维度的下一步演化。",
                "客户端渲染入口（把 .tsx 真正渲染成可交互页面的 host）当前仓库内没有；OOC 仅提供 tsx 文件路径与读写接口，渲染管线由外部消费方实现。需要在文档与 README 里明示这一边界。",
            ],
            warnings: [
                "stones/<self>/client/index.tsx 与 flow client/pages/*.tsx 文件被 OOC 写下来，但仓库内没有提供配套的客户端渲染器；纯文档/纯仓库层面无法直接 '看见' UI 效果，必须由外部消费方接入渲染。",
            ],
        },
    }
};
