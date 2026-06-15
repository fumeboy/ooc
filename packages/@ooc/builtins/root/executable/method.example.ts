/**
 * root.example —— 教学样板：实例化一个 example 对象（authoring reference）。
 *
 * 新契约下经 `ctx.runtime.instantiate("_builtin/example", args)` 委托 example class 的
 * construct 造一个 example 子对象。返回一句提示文本。
 */

import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

export const exampleMethod: ObjectMethod<Data> = {
  name: "example",
  description: "Create an example object (authoring reference).",
  schema: {
    args: {
      message: { type: "string", required: false, description: "要展示的文本（可多行）" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    if (!ctx.runtime) return "[example] runtime 不可用，无法实例化 example 对象。";
    const id = await ctx.runtime.instantiate("_builtin/example", args);
    return `已创建 example 对象（id=${id}）。`;
  },
};
