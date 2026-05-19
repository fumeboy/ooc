type DocTreeNode = {
    title: string; // 文档节点标题
    content?: string; // 文档节点内容

    named?: Record<string, string>; // content 中提到的名词的词典

    children?: Record<string, DocTreeNode>; // 该节点的主要组成部分
    patches?: Record<string, DocTreeNode>; // 该节点的补充(比如特殊逻辑、边界情况等)
    relations?: [[DocTreeNode, string]]; // 该节点与其他节点的关系， [0] 为其他节点，[1] 为关系描述
    sources?: [[any, string]]; // 该节点与源代码的关系， [0] 为源代码，[1] 为关系描述
};
/**
 * Object 文档树的根节点。
 *
 * 这一层只回答 Object 在 OOC 中是什么，
 * 作为后续能力维度子树的阅读入口。
 */
export const objectRoot_v20260519_1: DocTreeNode = {
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
            1. LLM 交互模块: 思考的核心是与 LLM 交互， 常规需要适配 OpenAI 和 Claude provider。
            2. ContextBuilder 模块: 设计如何构建 LLM 输入（context）， 通过统一的抽象信息单元 ContextWindow 来构建 context， ContextWindow 具有名为 command 的方法供 LLM 调用。
            3. 函数调用模块: 支持 LLM 调用函数程序，通过基础 tool (open/refine/submit/close) 来调用 ContextWindow command。额外具有 tool wait 用于等待 IO 结果。
            4. 类 SubAgent 模式支持: 思考的过程通过 thread 承载，thread 可以派生子 thread，形成一个 Thread Tree，每个 thread 可以并行思考。

            ContextWindow 是信息展示单元，也是可操作的对象，ContextWindow 提供名为 command 的窗口方法供 LLM 交互

            基础工具 open 用于开启一个 ContextWindow, close 用于关闭一个 ContextWindow。 
            基础场景是可以通过 open 工具打开一个文件，文件内容就会以 file 类型的 ContextWindow 出现在 LLM 的输入中。

            使用渐进式披露思想的多步函数调用:
                执行 command 时，会先通过 open tool 开启一个 form 类型的 ContextWindow, open 后系统后自动激活这个 command 的初始知识，让告诉 LLM 如何执行这个 command。
                Form 可以通过 refine 工具多次填充表单参数，系统可以根据 CommandForm 填充的参数动态计算出填表所需的相应知识，最后通过 submit tool 触发 command 执行。
            `,
            named: {
                "ContextWindow": "OOC 系统中 Context 的抽象信息单元，具有名为 command 的方法供 LLM 调用",
                "Thread": "OOC 系统中思考的过程，thread 可以派生子 thread, 每个 thread 可以并行思考",
                "command": "OOC 系统中 ContextWindow 的方法，用于操作 ContextWindow 内容",
                "form-window": "OOC 系统中 ContextWindow 的一种 type，要执行 command 时会打开这个类型的 window，可以多次填充表单参数，最后通过 submit tool 触发 command 执行",
                "open": "OOC 系统中 ContextWindow 的基础工具，用于开启一个 ContextWindow",
                "refine": "OOC 系统中 ContextWindow 的基础工具，用于填充填充表单参数",
                "submit": "OOC 系统中 ContextWindow 的基础工具，用于触发 command 执行",
                "close": "OOC 系统中 ContextWindow 的基础工具，用于关闭一个 ContextWindow",
            },
            children: {
                "ContextWindow": {
                    title: "ContextWindow - OOC 系统中 Context 的抽象信息单元",
                    content: `
                    ContextWindow 是 OOC 系统中 Context 的抽象信息单元，具有名为 command 的方法供 LLM 调用。
                    thread 初始具有一个 Root ContextWindow, 这个 Root ContextWindow 具有基础 command 用于进行 OOC 系统的各项基础操作:
                    - talk: 用于开启一个 talk_window, 可以实现 Object 之间的对话。
                    - do: 用于开启一个 sub thread, 用于 Agent 并行处理多个子任务。
                    - program: 用于开启一个 program_window, 就像一个程序员打开一个 terminal 窗口，可以运行 shell/javascript/typescript 程序。

                    【本节点没写完 TODO】
                    `,
                }
            },
        }
    }
};
