/**
 * todo_window — 由 root.todo command 通过 C 规则直建的可见待办。
 *
 * spec § todo_window：
 * - 没有 LLM 可调用的 command；唯一动作是 close（待办完成）
 * - onClose 无副作用，window 直接释放
 * - 渲染显示 content 与 onCommandPath（Step 2 的 file/knowledge window 同样模式）
 */

import { registerWindowType } from "./registry.js";

registerWindowType("todo", {
  // commands 留空：todo 没有可被 LLM 进一步调用的动作
  commands: {},
  // onClose 无副作用：window 释放即完成
});
