import { object_v20260504_1 } from "@meta";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";

export const thinkable_v20260504_1 = {
    parent: object_v20260504_1,
    index: `
Object 具有思想能力

思想能力的核心是与 LLM 交互，这里的关键是构造 LLM 输入 (Context)

Context 是一个信息窗口，从所有信息 (Knowledge) 中筛选出与当前问题相关的信息，是 Context Enginering 的工作

    Context 的组成为:
    - i
        - role (who am i)
        - knowledge (what i know / what i can do)
            - skill
            - memory
            - relation 
    - process (what i am doing, and doing for what)
        - requirement (doing for what)
            - plan
            - todo list
        - parent (this thread derived from which thread)
        - events (what happened indexed by time)
        - effects (what happened indexed by type)
            - inbox (threads in)
            - outbox (threads out)
            - opened knowledge
            - opened form

思想的过程通过 Thread 表示，Thread 可以派生子 Thread，形成一个 Thread Tree
通过 do command 来派生子 Thread (具体见 executable 文档)
派生子 Thread 可以不只是在当前 Thread 派生，也可以指定其他 Thread 派生 (例如询问其他 Thread 的信息，就可以基于这个 Thread 去派生一个子 Thread)


`,
        executable: executable_v20260504_1,
    }