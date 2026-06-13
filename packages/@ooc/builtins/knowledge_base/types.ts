import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * KnowledgeBase window —— knowledge_base 成员对象在 context 里的窗形态。
 *
 * knowledge_base 是 agent 组合持有的 **tool-object 成员**（非 Agent）：可查询的知识存储。
 * `open_knowledge` 把一篇 knowledge doc 作为 `knowledge` 窗引入 context（doc 是窗，store 是成员——
 * 故成员类型名 knowledge_base，区别于已有的 `knowledge` 窗口类型）。
 */
export interface KnowledgeBaseWindow extends BaseContextWindow {
  class: "knowledge_base";
  status: "open" | "closed";
}
