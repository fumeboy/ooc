/**
 * root.todo command — 通过 C 规则直建一个 todo_window。
 *
 * spec § todo_window：
 * - open(command="todo", title="...", args={ content, on_command_path? })
 * - args.content 已具备时不追加任何新 knowledge → C 规则命中 → 自动 submit
 * - submit 副作用：在父 thread.contextWindows 下挂一个 type=todo 的 window
 * - 不支持 refine 后 submit 的多步路径，但模型上仍然合法（只是用户体验上 LLM 一步即可）
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../command-types.js";
import { ROOT_WINDOW_ID, generateWindowId, type TodoWindow } from "../types.js";

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
- args.content 给齐时会通过 C 规则自动执行，不需要再 refine / submit
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
  /**
   * knowledge 仅在缺 content 时给出 input 提示；
   * content 已具备时不追加 entry → 配合 C 规则触发自动 submit。
   */
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [TODO_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.content !== "string" || args.content.trim().length === 0) {
      entries[TODO_INPUT_PATH] =
        "todo 需要 content；用 refine(args={ content: \"...\", on_command_path: [...] })，或在 open 时一次性给齐。";
    }
    return entries;
  },
  exec: (ctx) => executeTodoCommand(ctx),
};

/** 截断 title，保持 context 紧凑。 */
function deriveTitle(content: string, maxLen = 60): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

/**
 * root.todo 执行入口：在 ctx.thread.contextWindows 下挂一个 todo_window。
 *
 * 与 do command 同样直接 mutate ctx.thread.contextWindows；WindowManager.submit 完成后
 * 上层会再调用 toData() 重写父字段（保持一致由调用层串起来）。
 */
export async function executeTodoCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[todo] 缺少 thread context。";
  const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
  if (!content) return "[todo] 缺少 content 参数。";

  const onCommandPath = Array.isArray(ctx.args.on_command_path)
    ? (ctx.args.on_command_path as unknown[]).filter((v): v is string => typeof v === "string")
    : undefined;

  const todoWindow: TodoWindow = {
    id: generateWindowId("todo"),
    type: "todo",
    parentWindowId: ROOT_WINDOW_ID,
    title: deriveTitle(content),
    status: "open",
    createdAt: Date.now(),
    content,
    onCommandPath,
  };
  if (ctx.manager) {
    // 优先通过 WindowManager 插入，避免被 toData() 覆盖
    ctx.manager.insertTypedWindow(todoWindow);
  } else {
    // fallback：无 manager 时直接 mutate thread（仅 executeCommand 直接调用场景）
    thread.contextWindows = [...(thread.contextWindows ?? []), todoWindow];
  }
  return undefined;
}
