/**
 * plan —— executable 维度（object method）。
 *
 * object method 签名 `(ctx, self, args)`，**可改 self（Data）、可副作用**。
 * self = plan 的纯业务数据（title/description/steps/status/...）；副作用（造子 plan）经 ctx.runtime。
 * 与 readable 维度（投影 + window method，在 ../readable/index.ts）物理分离。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { SelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import { isString } from "@ooc/builtins/_shared/executable/utils.js";
import type { Data, PlanWindowStep } from "../types.js";

// ─────────────────────────── helpers ──────────────────────────────────────────

function generateStepId(): string {
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const VALID_STEP_STATUS = new Set(["pending", "in-progress", "done", "blocked"] as const);

function asStepStatus(v: unknown): PlanWindowStep["status"] | undefined {
  if (typeof v !== "string") return undefined;
  return (VALID_STEP_STATUS as Set<string>).has(v) ? (v as PlanWindowStep["status"]) : undefined;
}

export function normalizeStepsInput(input: unknown): PlanWindowStep[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: PlanWindowStep[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const text = isString(obj.text) ? obj.text : "";
    if (!text) continue;
    const status = asStepStatus(obj.status) ?? "pending";
    const id = isString(obj.id) && obj.id.length > 0 ? obj.id : generateStepId();
    out.push({ id, text, status });
  }
  return out;
}

// ─────────────────────────── object methods ───────────────────────────────────

const updatePlanMethod: ObjectMethod<Data> = {
  name: "update_plan",
  description: "Update this plan's title or description.",
  schema: {
    args: {
      title: { type: "string", description: "新 plan 标题" },
      description: { type: "string", description: "新 plan 说明" },
    },
  },
  exec: (_ctx: ExecutableContext, self: SelfProxy<Data>, args: Record<string, unknown>) => {
    const title = isString(args.title) ? args.title : undefined;
    const description = isString(args.description) ? args.description : undefined;
    if (title === undefined && description === undefined) {
      return "[plan.update_plan] 至少需要 args.title 或 args.description 之一。";
    }
    if (title !== undefined) self.data.title = title;
    if (description !== undefined) self.data.description = description;
    return undefined;
  },
};

const addStepMethod: ObjectMethod<Data> = {
  name: "add_step",
  description: "Append a new step to this plan.",
  schema: {
    args: {
      text: { type: "string", required: true, description: "步骤描述" },
      status: {
        type: "string",
        enum: ["pending", "in-progress", "done", "blocked"],
        description: "初始状态（默认 pending）",
      },
    },
  },
  exec: (_ctx: ExecutableContext, self: SelfProxy<Data>, args: Record<string, unknown>) => {
    const text = isString(args.text) ? args.text.trim() : "";
    if (!text) return "[plan.add_step] 缺少 args.text（步骤描述）。";
    const status = asStepStatus(args.status) ?? "pending";
    const step: PlanWindowStep = { id: generateStepId(), text, status };
    self.data.steps = [...self.data.steps, step];
    return `added step ${step.id}`;
  },
};

const updateStepMethod: ObjectMethod<Data> = {
  name: "update_step",
  description: "Update a step's text or status.",
  schema: {
    args: {
      step_id: { type: "string", required: true, description: "目标 step id" },
      text: { type: "string", description: "新文本" },
      status: {
        type: "string",
        enum: ["pending", "in-progress", "done", "blocked"],
        description: "新状态",
      },
    },
  },
  exec: (_ctx: ExecutableContext, self: SelfProxy<Data>, args: Record<string, unknown>) => {
    const stepId = isString(args.step_id) ? args.step_id : "";
    if (!stepId) return "[plan.update_step] 缺少 args.step_id。";
    const text = isString(args.text) ? args.text : undefined;
    const status = asStepStatus(args.status);
    if (text === undefined && status === undefined) {
      return "[plan.update_step] 至少需要 args.text 或 args.status 之一。";
    }
    const idx = self.data.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return `[plan.update_step] step "${stepId}" 不存在。`;
    const cur = self.data.steps[idx]!;
    const nextStep: PlanWindowStep = {
      ...cur,
      text: text !== undefined ? text : cur.text,
      status: status !== undefined ? status : cur.status,
    };
    const nextSteps = self.data.steps.slice();
    nextSteps[idx] = nextStep;
    self.data.steps = nextSteps;
    return undefined;
  },
};

const expandStepMethod: ObjectMethod<Data> = {
  name: "expand_step",
  description: "Expand a step into its own sub plan object.",
  schema: {
    args: {
      step_id: { type: "string", required: true, description: "目标 step id" },
      title: { type: "string", description: "sub plan 的 title；缺省 = 父 step 的 text" },
      description: { type: "string", description: "sub plan 的描述" },
    },
  },
  exec: async (ctx: ExecutableContext, self: SelfProxy<Data>, args: Record<string, unknown>) => {
    if (!ctx.runtime) return "[plan.expand_step] 缺少 runtime context。";
    const stepId = isString(args.step_id) ? args.step_id : "";
    if (!stepId) return "[plan.expand_step] 缺少 args.step_id。";
    const idx = self.data.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return `[plan.expand_step] step "${stepId}" 不存在。`;
    const cur = self.data.steps[idx]!;
    if (cur.subPlanWindowId) {
      return `[plan.expand_step] step "${stepId}" 已经展开为 sub plan "${cur.subPlanWindowId}"；如需重做请先 collapse_subplan。`;
    }
    const childTitle = isString(args.title) ? args.title : cur.text;
    const childDescription = isString(args.description) ? args.description : undefined;

    // 造子 plan 对象，由 runtime 挂进当前 thread；子 plan 反向软链回本 plan。
    const childId = await ctx.runtime.instantiate("_builtin/agent/plan", {
      title: childTitle,
      description: childDescription,
      parentPlanWindowId: ctx.object.id,
      parentStepId: stepId,
    });

    const nextSteps = self.data.steps.slice();
    nextSteps[idx] = { ...cur, subPlanWindowId: childId };
    self.data.steps = nextSteps;
    return `expanded step ${stepId} into sub plan ${childId}`;
  },
};

const collapseSubplanMethod: ObjectMethod<Data> = {
  name: "collapse_subplan",
  description: "Collapse a step's expanded sub plan back into the step.",
  schema: {
    args: {
      step_id: { type: "string", required: true, description: "目标 step id" },
    },
  },
  exec: async (ctx: ExecutableContext, self: SelfProxy<Data>, args: Record<string, unknown>) => {
    const stepId = isString(args.step_id) ? args.step_id : "";
    if (!stepId) return "[plan.collapse_subplan] 缺少 args.step_id。";
    const idx = self.data.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return `[plan.collapse_subplan] step "${stepId}" 不存在。`;
    const cur = self.data.steps[idx]!;
    if (!cur.subPlanWindowId) {
      return `[plan.collapse_subplan] step "${stepId}" 未展开 sub plan。`;
    }
    const childId = cur.subPlanWindowId;

    const nextSteps = self.data.steps.slice();
    nextSteps[idx] = { ...cur, subPlanWindowId: undefined };
    self.data.steps = nextSteps;

    // 关掉子 plan 对象（runtime 协助）。
    await ctx.runtime?.close?.(childId);
    return `collapsed sub plan ${childId} from step ${stepId}`;
  },
};

const markDoneMethod: ObjectMethod<Data> = {
  name: "mark_done",
  description: "Mark this plan as done.",
  exec: (_ctx: ExecutableContext, self: SelfProxy<Data>) => {
    self.data.status = "done";
    return undefined;
  },
};

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description: "Close this plan window (cascades to sub plans).",
  exec: () => undefined,
};

const executable: ExecutableModule<Data> = {
  methods: [
    updatePlanMethod,
    addStepMethod,
    updateStepMethod,
    expandStepMethod,
    collapseSubplanMethod,
    markDoneMethod,
    closeMethod,
  ],
};

export default executable;
