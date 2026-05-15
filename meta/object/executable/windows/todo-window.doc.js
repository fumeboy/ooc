import * as todo from "@src/executable/windows/todo";

/**
 * todo_window 概念：可见待办，由 root.todo 一步直建。
 *
 * sources:
 *  - todo — close 命令注册（todo 没有其它命令；唯一动作就是 close 即"完成/撤销"）
 */
export const todo_window_v20260515_1 = {
  name: "TodoWindow",
  description: `
todo_window 是一条可见待办，由 root.todo 在 args 给齐时 open 立即提交 form 直建。

- content：待办正文（同时作为 title 来源；过长截断）
- onCommandPath：可选；命中这些 command path 时强提醒
- 没有 LLM 可调用的命令；唯一动作是 close（待办完成 / 撤销）
- onClose 无副作用，window 直接释放
`.trim(),
  sources: { todo },
};
