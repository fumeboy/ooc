import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * Todo window — 由 root.todo command 一步直建（args 给齐时 open 立即提交 form）。
 *
 * - content：待办正文（同时作为 title 来源；过长截断）
 * - activatesOn：可选；命中这些 intent 时强提醒（替代旧 todo form 的 activates_on）
 * - 没有 LLM 可调用的 method；只能被 close
 */
export interface TodoWindow extends BaseContextWindow {
  class: "todo";
  content: string;
  activatesOn?: string[];
  status: "open" | "done";
}
