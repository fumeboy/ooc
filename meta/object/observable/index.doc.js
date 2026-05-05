import { object_v20260504_1 } from "@meta";

export const observable_v20260504_1 = {
    parent: object_v20260504_1,
    index: `
Observable 描述 Object 如何被观察、被理解与被验证。

在 OOC 中，Object 的“思考过程”是可记录、可回放、可调试的。
可观察性来自两个方面:
- events
    - thread 中发生的所有事情按时间记录
- effects
    - Object 对外产生的所有副作用按类型归档

OOC 系统具有两个开关， pause 和 debug
- pause 用于暂停指定 session 下所有 object 的所有 thread 的执行
    thinkloop 会停止在 LLM 请求后、工具执行前的阶段，在这个阶段，允许人工修改 LLM 输出进行调试
- debug 用于开启每轮 LLM 输入输出的记录
相关设计可以见 persistable 文档

可观察的对象（概念层）:
- thread tree
    - 线程结构、节点状态、父子关系
- context
    - 本轮 LLM 输入窗口（哪些信息被注入）
- tool calls
    - 本轮行动计划（open/refine/submit/close/wait 的调用序列）
- errors
    - 失败原因、堆栈、可复现证据

Observable 的目标:
- 让“对象为什么这么做”可解释
- 让“对象做了什么”可追溯
- 让“对象是否真的完成”可验证
`,
    persistable: persistable_v20260504_1,
};

