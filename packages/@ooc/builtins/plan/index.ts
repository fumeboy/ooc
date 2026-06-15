/**
 * plan —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 constructor + 后端维度（executable / readable）。
 * plan 是**非单例 class**（有 constructor，可按需造多个 plan 实例；expand_step 经 runtime 造子 plan）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import { isString } from "@ooc/builtins/_shared/executable/utils.js";
import executable, { normalizeStepsInput } from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data, PlanWindowStep } from "./types.js";

function constructorHasAnyInput(args: Record<string, unknown>): boolean {
  return (
    (isString(args.plan) && args.plan.trim().length > 0) ||
    isString(args.title) ||
    isString(args.description) ||
    Array.isArray(args.steps) ||
    // 子 plan（expand_step）经 runtime 造时只带 parent 软链，亦视为合法输入。
    isString(args.parentPlanWindowId)
  );
}

export const Class: OocClass<Data> = {
  construct: {
    description: "Create a plan window breaking a task into actionable steps.",
    schema: {
      args: {
        plan: {
          type: "string",
          description: "简单文本（落入 description）；与 title/description/steps 二选一",
        },
        title: { type: "string", description: "plan 标题" },
        description: { type: "string", description: "plan 描述" },
        steps: { type: "array", description: "steps 数组 [{id?, text, status?}, ...]" },
      },
    },
    exec: (_ctx: ConstructorContext, args: Record<string, unknown>): Data => {
      if (!constructorHasAnyInput(args)) {
        throw new Error(
          "[plan] 需要 args.plan (简单文本) 或 args.title / args.description / args.steps 之一。",
        );
      }
      const legacyPlanText = isString(args.plan) ? args.plan : undefined;
      const inputTitle = isString(args.title) ? args.title : undefined;
      const inputDescription = isString(args.description) ? args.description : legacyPlanText;
      const inputSteps: PlanWindowStep[] | undefined = normalizeStepsInput(args.steps);

      const data: Data = {
        title: inputTitle ?? "Plan",
        description: inputDescription,
        steps: inputSteps ?? [],
        status: "active",
      };
      if (isString(args.parentPlanWindowId)) data.parentPlanWindowId = args.parentPlanWindowId;
      if (isString(args.parentStepId)) data.parentStepId = args.parentStepId;
      return data;
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
