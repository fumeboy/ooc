import type { Concept, DocNode } from "@meta/doc-types";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as toolSchema from "@src/executable/tools/schema";

/* ────────────────────────────────────────────────────────────────
 *  目录页：mark 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * mark 概念：任意 tool 调用都可携带的附加参数，用来标记 inbox 中的消息。
 *
 * sources:
 *  - toolSchema — mark 在 tool schema 中的定义
 */
export type MarkConcept = Concept & {
  sources: { toolSchema: typeof toolSchema };

  /** mark 在 tool 调用中的形态（数组 + 每项的 messageId / type / 可选 tip） */
  attachmentForm: DocNode;

  /** ack / ignore / todo 3 种 type 各自含义 */
  markTypes: {
    title: string;
    summary?: string;
    /** 已确认收到并处理 */
    ack: DocNode;
    /** 决定不处理（忽略） */
    ignore: DocNode;
    /** 转为待办，稍后处理 */
    todo: DocNode;
  };

  /** 可选 tip 字段的语义 */
  tipField: DocNode;

  /** 为什么是附加参数而不是独立 tool */
  designRationale: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const mark_v20260506_1: MarkConcept = {
  name: "Mark",
  get parent() {
    return tools_v20260506_1;
  },
  sources: { toolSchema },
  description: `
mark 不是独立 tool，而是任意 tool 调用都可携带的附加参数，用来标记 inbox 中的消息。
`.trim(),

  attachmentForm: {
    title: "附加形态",
    summary: "mark 作为附加参数挂在任意 tool 调用上，值是 mark item 数组",
    content: `
\`\`\`
open(type=command, command=program, ..., mark=[
  { messageId: "msg_123", type: "ack" },
  { messageId: "msg_456", type: "todo", tip: "等下处理" }
])
\`\`\`

每个 mark item 必有 messageId 与 type；tip 可选。
    `.trim(),
  },

  markTypes: {
    title: "type 取值",
    summary: "ack / ignore / todo 3 种",

    ack: {
      title: "ack",
      content: "已确认收到并处理。",
    },

    ignore: {
      title: "ignore",
      content: "决定不处理（忽略）。",
    },

    todo: {
      title: "todo",
      content: "转为待办，稍后处理。",
    },
  },

  tipField: {
    title: "tip 字段",
    summary: "可选简短说明，帮助下一轮 LLM 理解当时的标记意图",
    content: `
可选 tip 字段：附加一段简短说明，帮助下一轮 LLM 理解当时为什么这样标记。
没有 tip 时只保留 type 的语义；有 tip 时下一轮 LLM 阅读 inbox 标记会看到这段补充。
    `.trim(),
  },

  designRationale: {
    title: "设计原因",
    summary: "让 LLM 在一轮里边做事边整理收件箱，省一次 ThinkLoop 往返",
    content: `
每一轮 LLM 通常只调一个 tool（open / refine / submit / close / wait）。
如果 mark 是独立 tool，LLM 想"标记几条消息 + 同时做某件事"就需要两轮 ThinkLoop。
把 mark 做成附加参数让 LLM 可以"边做事边整理收件箱"，节省往返。
    `.trim(),
  },
};
