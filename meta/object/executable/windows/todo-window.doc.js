import * as todo from "@src/executable/windows/todo";

/**
 * todo_window 概念：可见待办，由 root.todo 一步直建。
 *
 * sources:
 *  - todo — type 注册（无 LLM 可调用 command；唯一动作就是 close）
 */
export const todo_window_v20260515_1 = {
  name: "TodoWindow",
  description: `
todo_window 是一条可见待办，由 root.todo 在 args 给齐时 open 立即提交 form 直建。

按子字段展开：

- fields — 2 个字段（content 待办正文 / onCommandPath 高亮触发 path 集合）
- commands — 空表（无 LLM 可继续调用的动作，仅可通过顶层 close tool 释放）
- onCloseHook — 未注册 hook，走 WindowManager 默认移除路径
`.trim(),
  sources: { todo },

  fields: {
    title: "fields",
    content: `todo_window 的字段集合。`,

    content: {
      title: "content",
      content: `
      待办正文（同时作为 title 来源；过长截断）。
      `,
    },

    onCommandPath: {
      title: "onCommandPath",
      content: `
可选；当 LLM 调用命中这些 command path 时，渲染层把该 todo 高亮为强提醒，
让 LLM 在相关上下文时"想起这件事"。
      `,
    },
  },

  commands: {
    title: "commands",
    content: `
todo_window 注册的 commands 表为空：没有 LLM 可继续调用的动作。
唯一可触发的释放路径是顶层 close tool（windowId=该 todo_window.id）；
等价语义：待办完成 / 撤销。
    `,
  },

  onCloseHook: {
    title: "on Close Hook",
    content: `
todo_window 未注册 onClose hook；WindowManager.close 走默认路径——直接从 contextWindows 移除 window，
无额外副作用。
    `,
  },
};
