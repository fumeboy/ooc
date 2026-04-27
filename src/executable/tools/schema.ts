/** mark 参数的 JSON Schema（所有 tool 共用） */
export const MARK_PARAM = {
  type: "array",
  description: "标记 inbox 消息。可在任何 tool 调用时附带。",
  items: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "inbox 消息 ID" },
      type: { type: "string", enum: ["ack", "ignore", "todo"], description: "标记类型" },
      tip: { type: "string", description: "标记说明" },
    },
    required: ["messageId", "type", "tip"],
  },
} as const;

/** title 参数的 JSON Schema（open/refine/submit 共用） */
export const TITLE_PARAM = {
  type: "string",
  description: "一句话说明本次工具调用在做什么（面向观察者的自然语言，建议不超过 20 个汉字）。例如：\"读取 gene.md\"、\"回复用户问题\"、\"分解任务为 3 个子线程\"。对于 submit + think(context=\"fork\")，此 title 同时作为新创建子线程的名字。",
} as const;
