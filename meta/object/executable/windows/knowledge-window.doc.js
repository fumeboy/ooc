import * as knowledgeWindow from "@src/executable/windows/knowledge";

/**
 * knowledge_window 概念：把一条 stone knowledge doc 显式 pin 进 context。
 *
 * sources:
 *  - knowledgeWindow — close 命令注册 + render
 */
export const knowledge_window_v20260515_1 = {
  name: "KnowledgeWindow",
  description: `
knowledge_window 把一条 stone knowledge doc 显式 pin 进 context（source=explicit），
由 root.open_knowledge 在 args 给齐 path 时 open 立即提交 form 直建。

knowledge_window 也作为 protocol / activator 来源 knowledge 的运行时载体——
collectExecutableKnowledgeEntries 把这两类合成为 source=protocol / activator 的
knowledge_window 仅出现在响应体里，不写回 thread.json 持久化字段。

唯一可调命令：close（撤销 pin）。
`.trim(),
  sources: { knowledgeWindow },
};
