import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const mark_v20260506_1 = {
    parent: tools_v20260506_1,
    index: `
\`mark\` 不是独立的 tool，而是任意 tool 调用都可以携带的**附加参数**。
用于标记 inbox 中的消息状态。

\`\`\`
任意 tool 调用，如：
open(type=command, command=program, ..., mark=[
  { messageId: "msg_123", type: "ack" },
  { messageId: "msg_456", type: "todo", tip: "等下处理" }
])
\`\`\`

## 标记类型

| type | 含义 |
|---|---|
| ack    | 已确认收到并处理 |
| ignore | 决定不处理（忽略） |
| todo   | 转为待办，稍后处理 |

可选 \`tip\` 字段：附加一段简短说明，帮助下一轮 LLM 理解当时为什么这样标记。

## 行为

引擎在分派任意 tool call 之前先处理 mark 数组：

\`\`\`
for each m in args.mark:
  tree.markInbox(threadId, m.messageId, m.type, m.tip)
\`\`\`

mark 后：
- 消息从"未读"列表中移除
- 被标记的消息仍然保留在 inbox（不删除），可被回看
- ack / ignore 标记的消息不再"打扰"——LLM 不会反复看到它
- todo 标记的消息进入 todos 列表（详见 thinkable/context 的 todos 渲染）

## 为什么是附加参数而不是独立 tool

每一轮 LLM 通常只调一个 tool（open / refine / submit / close / wait）。
如果 mark 是独立 tool，LLM 想 "标记几条消息 + 同时做某件事" 就需要两轮 ThinkLoop。

把 mark 做成附加参数，让 LLM 可以"边做事边整理收件箱"，节省往返。

## 不触发线程复活

mark 只更新已存在消息的状态，不写入新 inbox 消息——
因此**不会**让 done 线程翻回 running，也不会唤醒 waiting 线程。
`,
};
