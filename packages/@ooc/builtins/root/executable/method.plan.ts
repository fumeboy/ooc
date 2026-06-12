/**
 * root.plan method — 委托到 plan_window constructor。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import { isString } from "@ooc/builtins/_shared/executable/utils.js";

import "@ooc/builtins/plan";

const PLAN_TIP = `plan 把任务拆成可执行步骤，以 plan_window 挂在 context。
参数（任一即可）：plan（简单文本）、title/description、steps（数组）。`;

export enum PlanMethodPath {
  Plan = "plan",
}

function hasAnyInput(args: Record<string, unknown>): boolean {
  return (
    (isString(args.plan) && args.plan.trim().length > 0) ||
    isString(args.title) ||
    isString(args.description) ||
    Array.isArray(args.steps)
  );
}

export const planMethod: ObjectMethod = {
  description: "Create a plan window breaking a task into steps (pass plan text, or a steps list of { text, status? }).",
  intents: [PlanMethodPath.Plan],
  schema: {
    args: {
      plan: { type: "string", required: false, description: "计划文本（快捷方式）" },
      title: { type: "string", required: false, description: "plan 标题" },
      description: { type: "string", required: false, description: "plan 描述" },
      steps: { type: "array", required: false, description: "步骤列表 [{ id?, text, status? }]" },
    },
  },
  onFormChange(change, { args }) {
    const ready = hasAnyInput(args);
    return {
      tip: ready ? "Creating plan..." : PLAN_TIP,
      intents: [{ name: "plan" }],
      quick_exec_submit: ready,
    };
  },
  exec: (ctx) => executePlanMethod(ctx),
};

export const executePlanMethod = makeRootDelegator({
  method: "plan",
  constructorKind: "plan",
  objectLabel: "plan_window",
});
