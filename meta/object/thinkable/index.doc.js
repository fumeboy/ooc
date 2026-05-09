import { object_v20260504_1 } from "@meta/object/index.doc";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { identity_v20260505_1 } from "@meta/object/thinkable/identity.doc";
import { llm_v20260508_1 } from "@meta/object/thinkable/llm/index.doc";
import { knowledge_v20260505_1 } from "@meta/object/thinkable/knowledge/index.doc";
import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";
import { thinkloop_v20260505_1 } from "@meta/object/thinkable/thinkloop/index.doc";
import { context_v20260505_1 } from "@meta/object/thinkable/context/index.doc";

export const thinkable_v20260504_1 = {
    parent: object_v20260504_1,
    index: `
Thinkable 描述 Object 的思考能力。

思考的核心是与 LLM 交互，关键是构造 LLM 输入（Context）。

思考的过程 (process) 通过 Thread 表示，Thread 可以派生子 Thread，形成一个 Thread Tree。
LLM 可以通过 do command 派生子 Thread（具体见 executable 文档）。
派生子 Thread 不限于在当前 Thread，也可以指定其他 Thread 派生（例如询问其他 Thread 的信息）。

子领域：

- identity
    - Object 对自己的双面认知 (自我 / 对我介绍)
- llm
    - Object 如何请求模型、处理 provider 协议差异与流式输出
- knowledge
    - Object 拥有什么知识，以及这些知识如何按 command 渐进式激活进入 Context
- context
    - 单轮 LLM 输入的组成与构建（Context Engineering）
    - context 通过多个 信息窗口 进行组装，包括 identity、knowledge、memory、process 等。
- thread
    - 思考的运行时结构：线程树、节点状态、子线程、调度
- thinkloop
    - 单轮循环的引擎：context-build → llm → tool_use → 循环
`,
    identity: identity_v20260505_1,
    llm: llm_v20260508_1,
    knowledge: knowledge_v20260505_1,
    context: context_v20260505_1,
    thread: thread_v20260505_1,
    thinkloop: thinkloop_v20260505_1,
    executable: executable_v20260504_1,
}
