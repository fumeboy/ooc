/**
 * agent.todo —— agency 之一：登记一条可见待办，产生 todo 对象。
 *
 * 新契约下经 `ctx.runtime.instantiate("_builtin/agent/todo", args)` 委托 todo class 的
 * construct 造一个 todo 子对象。返回一句提示文本。
 */

import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const TODO_TIP = `todo 登记一条可见待办，产生 todo_window。
参数：content（必填，待办内容）、activates_on（可选，命中这些 intent 时强提醒）。`;

export const todoMethod: ObjectMethod<Data> = {
  name: "todo",
  description: "Create a visible todo item in context.",
  schema: {
    args: {
      content: { type: "string", required: true, description: "待办内容" },
      activates_on: { type: "array", required: false, description: "命中这些 intent 时强提醒" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) return `[todo] ${TODO_TIP}`;
    if (!ctx.runtime) return `[todo] ${TODO_TIP}\n（runtime 不可用，无法实例化 todo 对象）`;
    const id = await ctx.runtime.instantiate("_builtin/agent/todo", args);
    return `已创建 todo 对象（id=${id}）。`;
  },
};
