import type { Concept, DocNode } from "@meta/doc-types";
import * as todo from "@src/executable/windows/todo";

/**
 * todo_window 概念：可见待办，由 root.todo 一步直建。
 *
 * sources:
 *  - todo — type 注册（无 LLM 可调用 command；唯一动作就是 close）
 */
export type TodoWindowConcept = Concept & {
  sources: { todo: typeof todo };

  /** 2 个关键字段（待办正文 / 高亮触发 path 集合） */
  fields: {
    title: string;
    summary?: string;
    /** 待办正文（兼作 title 来源） */
    content: DocNode;
    /** 命中后高亮该 todo 的 command path 集合 */
    onCommandPath: DocNode;
  };

  /** 命令面：todo_window 不注册 LLM 可调用动作 */
  commands: DocNode;

  /** 未注册 onClose hook，走 WindowManager 默认移除路径 */
  onCloseHook: DocNode;
};

export const todo_window_v20260515_1: TodoWindowConcept = {
  name: "TodoWindow",
  sources: { todo },
  description: `
todo_window 是一条可见待办，由 root.todo 在 args 给齐时 open 立即提交 form 直建。
`.trim(),

  fields: {
    title: "字段",
    summary: "todo_window 的两个关键字段",

    content: {
      title: "content",
      summary: "待办正文（兼作 title 来源；过长截断）",
    },

    onCommandPath: {
      title: "onCommandPath",
      content: `
可选；当 LLM 调用命中这些 command path 时，渲染层把该 todo 高亮为强提醒，
让 LLM 在相关上下文时"想起这件事"。
      `.trim(),
    },
  },

  commands: {
    title: "命令面",
    content: `
todo_window 注册的 commands 表为空：没有 LLM 可继续调用的动作。
唯一可触发的释放路径是顶层 close tool（windowId=该 todo_window.id）；
等价语义：待办完成 / 撤销。
    `.trim(),
  },

  onCloseHook: {
    title: "onClose hook",
    content: `
todo_window 未注册 onClose hook；WindowManager.close 走默认路径——直接从
contextWindows 移除 window，无额外副作用。
    `.trim(),
  },
};
