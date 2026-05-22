/**
 * todo_window — 由 root.todo command 一步直建的可见待办。
 *
 * - 没有 LLM 可调用的 command；唯一动作是 close（待办完成）
 * - onClose 无副作用，window 直接释放
 * - 渲染显示 content 与 onCommandPath
 */

import { registerWindowType } from "../_shared/registry.js";

registerWindowType("todo", {
  // commands 留空：todo 没有可被 LLM 进一步调用的动作
  commands: {},
  // onClose 无副作用：window 释放即完成
});
