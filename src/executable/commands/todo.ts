import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const KNOWLEDGE = `
todo 用于登记一个可见待办，并可选配置在命中特定 command 或 command path 时提醒。

参数说明：
- content: 必填，待办内容
- on_command_path: 可选，命中这些 command 或 command path 时额外提醒

调用示例：
open(type="command", command="todo", description="登记后续待办")
refine(form_id, { content: "补充 program 的真实链路测试", on_command_path: ["program", "program.function"] })
submit(form_id)
`;

export enum TodoCommandPath {
  /** 基础 todo 指令：登记一个待办。 */
  Todo = "todo",
  /** 按 command 或 command path 命中时提醒。 */
  OnCommandPath = "todo.on_command_path",
}

export const todoCommand: CommandTableEntry = {
  paths: [
    TodoCommandPath.Todo,
    TodoCommandPath.OnCommandPath,
  ],
  match: (args) => {
    const hit: string[] = [TodoCommandPath.Todo];
    if (Array.isArray(args.on_command_path) && args.on_command_path.length > 0) {
      hit.push(TodoCommandPath.OnCommandPath);
    }
    return hit;
  },
  // 暂不实现具体执行逻辑
};

/** 执行 todo 命令（占位实现，暂未实现具体逻辑） */
export async function executeTodoCommand(_ctx: CommandExecutionContext): Promise<void> {
  // 暂未实现具体逻辑
}
