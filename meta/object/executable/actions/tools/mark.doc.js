import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as toolSchema from "@src/executable/tools/schema";

export const mark_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Mark",
  sources: { toolSchema },
  description: `
mark 不是独立 tool，而是任意 tool 调用都可携带的附加参数，用来标记 inbox 中的消息。

按子字段展开：

- attachmentForm — mark 在 tool 调用中的形态（数组 + 每项的 messageId / type / 可选 tip）
- markTypes — 3 种 type 各自的含义
- tipField — 可选 tip 字段的语义
- designRationale — 为什么是附加参数而不是独立 tool
`.trim(),

  attachmentForm_v20260517_1: {
    index: `
mark 作为附加参数挂在任意 tool 调用上，值是 mark item 数组：

\`\`\`
open(type=command, command=program, ..., mark=[
  { messageId: "msg_123", type: "ack" },
  { messageId: "msg_456", type: "todo", tip: "等下处理" }
])
\`\`\`

每个 mark item 必有 messageId 与 type；tip 可选。
`.trim(),
  },

  markTypes_v20260517_1: {
    index: `mark item.type 取值集合（3 种）；每种独立子节点。`,

    ack_v20260517_1: {
      index: `### ack — 已确认收到并处理。`,
    },

    ignore_v20260517_1: {
      index: `### ignore — 决定不处理（忽略）。`,
    },

    todo_v20260517_1: {
      index: `### todo — 转为待办，稍后处理。`,
    },
  },

  tipField_v20260517_1: {
    index: `
可选 tip 字段：附加一段简短说明，帮助下一轮 LLM 理解当时为什么这样标记。
没有 tip 时只保留 type 的语义；有 tip 时下一轮 LLM 阅读 inbox 标记会看到这段补充。
`.trim(),
  },

  designRationale_v20260517_1: {
    index: `
每一轮 LLM 通常只调一个 tool（open / refine / submit / close / wait）。
如果 mark 是独立 tool，LLM 想"标记几条消息 + 同时做某件事"就需要两轮 ThinkLoop。
把 mark 做成附加参数让 LLM 可以"边做事边整理收件箱"，节省往返。
`.trim(),
  },
};
