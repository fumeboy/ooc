import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const mark_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  index: `
\`mark\` 不是独立的 tool，而是任意 tool 调用都可以携带的**附加参数**。
用于标记 inbox 中的消息已读。

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

## 为什么是附加参数而不是独立 tool

每一轮 LLM 通常只调一个 tool（open / refine / submit / close / wait）。
如果 mark 是独立 tool，LLM 想 "标记几条消息 + 同时做某件事" 就需要两轮 ThinkLoop。

把 mark 做成附加参数，让 LLM 可以"边做事边整理收件箱"，节省往返。
`,
};
