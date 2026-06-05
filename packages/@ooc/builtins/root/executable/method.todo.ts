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

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";

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


export const todoCommand: ObjectMethod = {
  paths: [TodoCommandPath.Todo, TodoCommandPath.OnCommandPath],
  schema: {
    args: {
      content: { type: "string", required: true, description: "待办内容" },
      on_command_path: { type: "array", required: false, description: "命中这些 command path 时强提醒" },
    },
  } as MethodCallSchema,
  intent: (args): Intent[] => {
    const r: Intent[] = [];
    if (Array.isArray(args.on_command_path) && args.on_command_path.length > 0) {
      r.push({ name: TodoCommandPath.OnCommandPath });
    }
    return r;
  },
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 在契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs（runtime 保证此 form 即 method_exec form）。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [TODO_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    if (typeof args.content !== "string" || args.content.trim().length === 0) {
      entries[TODO_INPUT_PATH] =
        "todo 还缺以下参数: content。\n" +
        "请用 refine(form_id, args={ content: \"<待办内容>\", on_command_path?: [\"<cmd>\"] }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeTodoCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托给 todo_object constructor。
 *
 * 直接返回 constructor 的 MethodOutcome；manager.submit 会走 §2 分支
 * 用 insertTypedWindow 挂载 todoWindow。
 */
export const executeTodoCommand = makeRootDelegator({
  command: "todo",
  constructorKind: "todo",
  objectLabel: "todo_object",
});
