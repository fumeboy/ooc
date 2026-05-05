import { object_v20260504_1 } from "@meta";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";

export const executable_v20260504_1 = {
    parent: object_v20260504_1,
    index: `
Executable 描述 Object 的行动 / 编程能力。

三部分:
- Object 如何进行行动 (其中包括 Object 如何执行一段临时程序)
- Object 如何为自己编写程序文件
- Object 如何为自己编写前端界面

1. Object 如何进行行动:
    - tools (LLM 会进行调用)
        - open
            - 用于开始一次行动(选择一个 command 执行), 会生成一个 form 并分配 form id
            - open 可以用来开启一个文档，开启后，文档信息会出现在 context 中提供给 LLM
        - refine
            - 用于完善 form 中的参数
        - submit
            - 用于提交 form, 不允许填充参数
        - close
            - 用于关闭 form, 放弃提交，需要解释原因
        - wait
            - 放弃思考循环，等待新的事件
    - forms
        - 用于暂存一次行动的参数与状态
        - 让复杂行动可以分步填写，而不是一次性完成
    - commands
        - program
            用于执行一段程序，支持 ts/js/shell
            也可以执行 Object 所具有的程序方法
        - talk
            和其他 Object 进行对话
            特殊地，可以和 super 进行对话, 来进行长期生效(而非某次session生效)的自我迭代、元编程
            具体见 reflectable 文档
        - do
            派生子 thread
        - plan
            设置/更新当前 thread 计划、todo list
        - defer
            注册一个 hook 事件，在指定类型的行动执行时触发
        - end
            结束当前 thread
        - compress
            压缩上下文
    关心的问题:
    - Object 能做什么
    - 一次行动需要哪些参数
    - 行动的副作用如何落盘
    - 行动完成后如何反馈

    渐进式披露设计:
        form 在 open/refine 选择 command、填充参数时，根据所填参数，计算出相关的知识
            context 中会自动 open 这些知识
            同时 process events 中会 inject 一条消息，通知 LLM 已经 open 了这些知识
        根据知识，再进行下一步的思考，考虑清楚才 submit 执行

2. Object 如何为自己编写程序文件:
    TODO

3. Object 如何为自己编写前端界面:
    TODO
`,
    reflectable: reflectable_v20260504_1,
};

