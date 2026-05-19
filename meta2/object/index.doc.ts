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

    Agent 由几个维度组合:
    - thinkable: 可以思考
    - executable: 可以行动
    - collaborable: 可以协作
    - observable: 可观测、记录、debug
    - reflectable: 可以自我反思、经验沉淀、元编程
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
        "persistable": "OOC Agent 由几个维度组合，persistable 是其中之一，定义 Agent 的持久化存储能力",
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
    }
};
