/**
 * agent.todo —— agency 之一：登记一条可见待办，产生 todo 对象。
 *
 * 新契约下经 `ctx.runtime.instantiate("_builtin/agent/todo", args)` 委托 todo class 的
 * construct 造一个 todo 子对象。返回一句提示文本。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ObjectMethodResult,
} from "@ooc/core/types";
import type { SelfProxy } from "@ooc/core/types";
import type { Data } from "../types.js";

export const todoMethod: ObjectMethod<Data> = {
  name: "todo",
  description: "Create a visible todo item in context.",
  schema: {
      content: { type: "string", required: true, description: "待办内容" },
      activates_on: { type: "array", required: false, description: "命中这些 intent 时强提醒" },
    },
  exec: async (ctx: ExecutableContext, _self: SelfProxy<Data>, args: Record<string, unknown>): Promise<ObjectMethodResult> => {
    const ref = await ctx.runtime.instantiate({class:"_builtin/agent/todo", args});
    return {
      refs: [ref]
    };
  },
};
