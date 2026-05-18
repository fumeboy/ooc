import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as todoSource from "@src/executable/windows/root/todo";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.todo command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Todo 概念：登记一个可见待办，提交后产出持久 todo_window。
 *
 * sources:
 *  - todo — root.todo command 实现
 */
export type TodoConcept = Concept & {
  sources: { todo: typeof todoSource };

  /** 调用形态与一步直建特性 */
  callShape: DocNode;

  /** submit 副作用与 close 路径 */
  submitEffects: {
    title: string;
    summary?: string;
    spawnTodoWindow: DocNode;
    noLlmCommands: DocNode;
    closePath: DocNode;
    formAutoRemove: DocNode;
  };

  /** root.todo 注册的 command path */
  pathList: DocNode;

  /** todo_window 作为独立 ContextWindow type 的语义 */
  contextWindowModel: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const todo_v20260514_1: TodoConcept = {
  name: "Todo",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { todo: todoSource },
  description: `
todo 登记一个可见待办，提交后产出一个 todo_window 持久挂在当前 thread 的
contextWindows。
`.trim(),

  callShape: {
    title: "调用形态",
    summary: "args 给齐时 open 立即提交 form，无需 refine/submit",
    content: `
\`\`\`
open(command="todo", title="登记后续待办", args={
  content: "补充 program 的真实链路测试",                  // 必填，待办内容
  on_command_path?: ["program", "program.function"]      // 可选
})
\`\`\`

args 给齐时 open 立即提交 form；不需要再显式调 refine / submit。
on_command_path 用于在指定 command path 激活时把这条 todo 高亮提示给 LLM。
    `.trim(),
  },

  submitEffects: {
    title: "submit 副作用",
    summary: "4 项规则：挂窗 / 无 sub-command / close 表达完成 / form 自动移除",

    spawnTodoWindow: {
      title: "1. 挂 todo_window",
      content: "submit 副作用：在 thread.contextWindows 下挂一个 type=todo 的 window。",
    },

    noLlmCommands: {
      title: "2. todo_window 无 LLM 可调用的 command",
      content: `
todo_window 是纯展示型——LLM 不能向其 open(parent_window_id=..., command=...) 派生 sub-command。
唯一可做的事情是 close 它。
      `.trim(),
    },

    closePath: {
      title: "3. 完成或撤销 → close window",
      content: `
close(window_id="<todo_window_id>", reason="...") 表达"已完成"或"已撤销"。
reason 让下一轮 LLM 理解关闭原因。
      `.trim(),
    },

    formAutoRemove: {
      title: "4. command_exec form 自动移除",
      content: `
submit 成功后 command_exec form 自动从 contextWindows 移除；
todo_window 是独立产物，自身的可见性与 form 解耦。
      `.trim(),
    },
  },

  pathList: {
    title: "command path",
    summary: "root.todo 注册的 path",
    content: `
\`\`\`
todo
todo.on_command_path
\`\`\`

todo.on_command_path 仅在 args 包含 on_command_path 时激活，
对应的 knowledge 才会进入 context。
    `.trim(),
  },

  contextWindowModel: {
    title: "独立 ContextWindow 型",
    summary: "可见性不依赖 command_exec form 生命周期；直到显式 close 才离开",
    content: `
todo_window 是独立的 ContextWindow type，可见性不依赖 command_exec form 的生命周期。
这让 todo 与"普通 form 执行后即消失"形成对比——todo 的本质是持久挂件，
直到 LLM 显式 close 才离开 context。
    `.trim(),
  },
};
