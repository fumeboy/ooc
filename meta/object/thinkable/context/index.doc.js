export const context_v20260504_1 = {
    parent: thinkable_v20260504_1,
    index: `
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

    Process Event:
        - LLM output text message
        - LLM tool call message (包括调用结果)
        - inject message
            - 上下文变更提示 (新消息、知识变更 等)
`,
}