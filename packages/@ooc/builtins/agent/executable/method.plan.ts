/**
 * agent.plan —— agency 之一：把任务拆成可执行步骤，以 plan_window 挂在 context。
 *
 * 新契约下，plan 不再走 root delegator + registry lookupConstructor，而是经
 * `ctx.runtime.instantiate("_builtin/agent/plan", args)` 委托 plan class 的 construct
 * 造一个 plan 子对象。返回一句提示文本。
 */

import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { SelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import type { Data } from "../types.js";

const PLAN_TIP = `plan 把任务拆成可执行步骤，以 plan_window 挂在 context。
参数（任一即可）：plan（简单文本）、title/description、steps（数组）。`;

export const planMethod: ObjectMethod<Data> = {
  name: "plan",
  description:
    "Create a plan window breaking a task into steps (pass plan text, or a steps list of { text, status? }).",
  schema: {
    args: {
      plan: { type: "string", required: false, description: "计划文本（快捷方式）" },
      title: { type: "string", required: false, description: "plan 标题" },
      description: { type: "string", required: false, description: "plan 描述" },
      steps: { type: "array", required: false, description: "步骤列表 [{ id?, text, status? }]" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: SelfProxy<Data>, args: Record<string, unknown>) => {
    if (!ctx.runtime) return `[plan] ${PLAN_TIP}\n（runtime 不可用，无法实例化 plan 对象）`;
    const id = await ctx.runtime.instantiate("_builtin/agent/plan", args);
    return `已创建 plan 对象（id=${id}）。`;
  },
};
