import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * Todo window — 由 root.todo command 一步直建（args 给齐时 open 立即提交 form）。
 *
 * - content：待办正文（同时作为 title 来源；过长截断）
 * - onCommandPath：可选；命中这些 command path 时强提醒（替代旧 todo form 的 on_command_path）
 * - 没有 LLM 可调用的 command；只能被 close
 */
export interface TodoWindow extends BaseContextWindow {
  type: "todo";
  content: string;
  onCommandPath?: string[];
  status: "open" | "done";
}
