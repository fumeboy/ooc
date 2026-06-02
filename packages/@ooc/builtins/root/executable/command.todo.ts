/**
 * root.todo command — 委托到 todo_object constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.todo 的构造逻辑已迁到 packages/@ooc/builtins/todo/executable/index.ts
 * 的 kind="constructor" todo method。这里保留 root method 表项（knowledge / paths 仍在 root 维度暴露），
 * exec 走 lookupConstructor("todo") 委托。
 *
 * 知识（KNOWLEDGE）保留在本文件作为 root protocol knowledge，避免 LLM 在还没 open form
 * 时丢失"todo 在 root 上可调"的入口提示。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/command-types.js";
import { lookupConstructor } from "@ooc/core/extendable/_shared/registry.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 todo_object constructor 注册
import "@ooc/builtins/todo";

const TODO_BASIC_PATH = "internal/executable/todo/basic";
const TODO_INPUT_PATH = "internal/executable/todo/input";

const KNOWLEDGE = `
todo 用于登记一条可见待办，直接产生一个 todo_window 挂到当前 thread。

参数：
- content: 必填，待办内容
- on_command_path: 可选，命中这些 command path 时强提醒（数组）

示例：
open(command="todo", title="补集成测试", args={ content: "补 program shell 集成测试", on_command_path: ["program.shell"] })

提示：
- args.content 给齐时 open 会立刻提交 form，不需要再 refine / submit
- 完成或撤销时 close(window_id="<todo_window_id>")
`.trim();

export enum TodoCommandPath {
  Todo = "todo",
  OnCommandPath = "todo.on_command_path",
}

export const todoCommand: CommandTableEntry = {
  paths: [TodoCommandPath.Todo, TodoCommandPath.OnCommandPath],
  match: (args) => {
    const hit: string[] = [TodoCommandPath.Todo];
    if (Array.isArray(args.on_command_path) && args.on_command_path.length > 0) {
      hit.push(TodoCommandPath.OnCommandPath);
    }
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [TODO_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.content !== "string" || args.content.trim().length === 0) {
      entries[TODO_INPUT_PATH] =
        "todo 还缺以下参数: content。\n" +
        "请用 refine(form_id, args={ content: \"<待办内容>\", on_command_path?: [\"<cmd>\"] }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeTodoCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托给 todo_object constructor。
 *
 * 直接返回 constructor 的 MethodOutcome；manager.submit 会走 §2 分支
 * 用 insertTypedWindow 挂载 todoWindow。
 */
export async function executeTodoCommand(
  ctx: CommandExecutionContext,
): Promise<MethodOutcome | string | undefined> {
  const ctor = lookupConstructor("todo");
  if (!ctor) return "[todo] todo_object constructor 未注册（registry 期望 kind=\"constructor\" 的 todo method）。";
  const raw = await ctor.exec(ctx);
  return raw;
}
