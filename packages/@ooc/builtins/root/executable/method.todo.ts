/**
 * root.todo command — 委托到 todo_object constructor。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";

import "@ooc/builtins/todo";

const TODO_TIP = `todo 登记一条可见待办，产生 todo_window。
参数：content（必填，待办内容）、activates_on（可选，命中这些 intent 时强提醒）。`;

export enum TodoMethodPath {
  Todo = "todo",
  OnMethodPath = "todo.activates_on",
}

export const todoMethod: ObjectMethod = {
  description: "Create a visible todo item in context.",
  intents: [TodoMethodPath.OnMethodPath],
  schema: {
    args: {
      content: { type: "string", required: true, description: "待办内容" },
      activates_on: { type: "array", required: false, description: "命中这些 intent 时强提醒" },
    },
  },
  onFormChange(change, { args }) {
    const hasActivates = Array.isArray(args.activates_on) && args.activates_on.length > 0;
    const intents = hasActivates ? [{ name: TodoMethodPath.OnMethodPath }] : [{ name: "todo" }];
    const hasContent = typeof args.content === "string" && args.content.trim().length > 0;
    return {
      tip: hasContent ? "Creating todo..." : TODO_TIP,
      intents,
      quick_exec_submit: hasContent,
    };
  },
  exec: (ctx) => executeTodoMethod(ctx),
};

export const executeTodoMethod = makeRootDelegator({
  method: "todo",
  constructorKind: "todo",
  objectLabel: "todo_object",
});
