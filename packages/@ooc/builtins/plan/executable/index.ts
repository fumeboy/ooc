/**
 * plan_window — 行动计划窗口 module。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
} from "@ooc/core/extendable/_shared/types.js";
import type { PlanWindow, PlanWindowStep } from "../types.js";

import type { WindowManager } from "@ooc/core/executable/windows/_shared/manager.js";
import { isString } from "@ooc/builtins/_shared/executable/utils.js";

// ─────────────────────────── helpers ──────────────────────────────────────────

function generateStepId(): string {
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const VALID_STEP_STATUS = new Set(["pending", "in-progress", "done", "blocked"] as const);

function asStepStatus(v: unknown): PlanWindowStep["status"] | undefined {
  if (typeof v !== "string") return undefined;
  return (VALID_STEP_STATUS as Set<string>).has(v) ? (v as PlanWindowStep["status"]) : undefined;
}

function requirePlanWindow(ctx: MethodExecutionContext): PlanWindow {
  return ctx.self as PlanWindow;
}

function updatePlanWindow(ctx: MethodExecutionContext, next: PlanWindow): void {
  if (ctx.manager) {
    (ctx.manager as WindowManager).upsertWindow(next, ctx.thread);
  } else {
    Object.assign(ctx.self as PlanWindow, next);
  }
}

// ─────────────────────────── commands ─────────────────────────────────────────

const updatePlanMethod: ObjectMethod = {
  description: "Update this plan's title or description.",
  schema: {
    args: {
      title: { type: "string", description: "新 plan 标题" },
      description: { type: "string", description: "新 plan 说明" },
    },
  },
  onFormChange(change, { args }) {
    const hasAny = isString(args.title) || isString(args.description);
    return {
      tip: hasAny ? "Updating plan..." : "update_plan: 至少提供 title 或 description 之一。",
      intents: [{ name: "update_plan" }],
      quick_exec_submit: hasAny,
    };
  },
  exec: (ctx) => executeUpdatePlan(ctx),
};

async function executeUpdatePlan(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  const title = isString(ctx.args.title) ? ctx.args.title : undefined;
  const description = isString(ctx.args.description) ? ctx.args.description : undefined;
  if (title === undefined && description === undefined) {
    return "[plan_window.update_plan] 至少需要 args.title 或 args.description 之一。";
  }
  const next: PlanWindow = {
    ...w,
    title: title !== undefined ? title : w.title,
    description: description !== undefined ? description : w.description,
  };
  updatePlanWindow(ctx, next);
  return undefined;
}

const addStepMethod: ObjectMethod = {
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
  onFormChange(change, { args }) {
    const hasText = isString(args.text) && args.text.trim().length > 0;
    return {
      tip: hasText ? "Adding step..." : "add_step: 需要 args.text（步骤描述）。",
      intents: [{ name: "add_step" }],
      quick_exec_submit: hasText,
    };
  },
  exec: (ctx) => executeAddStep(ctx),
};

async function executeAddStep(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  const text = isString(ctx.args.text) ? ctx.args.text.trim() : "";
  if (!text) return "[plan_window.add_step] 缺少 args.text（步骤描述）。";
  const status = asStepStatus(ctx.args.status) ?? "pending";
  const step: PlanWindowStep = {
    id: generateStepId(),
    text,
    status,
  };
  const next: PlanWindow = { ...w, steps: [...w.steps, step] };
  updatePlanWindow(ctx, next);
  return `added step ${step.id}`;
}

const updateStepMethod: ObjectMethod = {
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
  onFormChange(change, { args }) {
    const hasStepId = isString(args.step_id);
    const hasField = isString(args.text) || args.status !== undefined;
    return {
      tip: hasStepId && hasField ? "Updating step..." : "update_step: 需要 step_id 以及 text 或 status。",
      intents: [{ name: "update_step" }],
      quick_exec_submit: hasStepId && hasField,
    };
  },
  exec: (ctx) => executeUpdateStep(ctx),
};

async function executeUpdateStep(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  const stepId = isString(ctx.args.step_id) ? ctx.args.step_id : "";
  if (!stepId) return "[plan_window.update_step] 缺少 args.step_id。";
  const text = isString(ctx.args.text) ? ctx.args.text : undefined;
  const status = asStepStatus(ctx.args.status);
  if (text === undefined && status === undefined) {
    return "[plan_window.update_step] 至少需要 args.text 或 args.status 之一。";
  }
  const idx = w.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return `[plan_window.update_step] step "${stepId}" 不存在。`;
  const cur = w.steps[idx]!;
  const nextStep: PlanWindowStep = {
    ...cur,
    text: text !== undefined ? text : cur.text,
    status: status !== undefined ? status : cur.status,
  };
  const nextSteps = w.steps.slice();
  nextSteps[idx] = nextStep;
  const next: PlanWindow = { ...w, steps: nextSteps };
  updatePlanWindow(ctx, next);
  return undefined;
}

const expandStepMethod: ObjectMethod = {
  description: "Expand a step into its own sub plan_window.",
  schema: {
    args: {
      step_id: { type: "string", required: true, description: "目标 step id" },
      title: { type: "string", description: "sub plan 的 title；缺省 = 父 step 的 text" },
      description: { type: "string", description: "sub plan 的描述" },
    },
  },
  onFormChange(change, { args }) {
    const hasStepId = isString(args.step_id);
    return {
      tip: hasStepId ? "Expanding step..." : "expand_step: 需要 args.step_id。",
      intents: [{ name: "expand_step" }],
      quick_exec_submit: hasStepId,
    };
  },
  exec: (ctx) => executeExpandStep(ctx),
};

async function executeExpandStep(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  if (!ctx.thread) return "[plan_window.expand_step] 缺少 thread context。";
  const stepId = isString(ctx.args.step_id) ? ctx.args.step_id : "";
  if (!stepId) return "[plan_window.expand_step] 缺少 args.step_id。";
  const idx = w.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return `[plan_window.expand_step] step "${stepId}" 不存在。`;
  const cur = w.steps[idx]!;
  if (cur.subPlanWindowId) {
    return `[plan_window.expand_step] step "${stepId}" 已经展开为 sub plan "${cur.subPlanWindowId}"；如需重做请先 collapse_subplan。`;
  }
  const childTitle = isString(ctx.args.title) ? ctx.args.title : cur.text;
  const childDescription = isString(ctx.args.description) ? ctx.args.description : undefined;

  const childId = generateWindowId("plan");
  const child: PlanWindow = {
    id: childId,
    class: "plan",
    parentWindowId: ROOT_WINDOW_ID,
    title: childTitle,
    status: "active",
    createdAt: Date.now(),
    description: childDescription,
    steps: [],
    parentPlanWindowId: w.id,
    parentStepId: stepId,
  };

  const nextSteps = w.steps.slice();
  nextSteps[idx] = { ...cur, subPlanWindowId: childId };
  const nextParent: PlanWindow = { ...w, steps: nextSteps };

  updatePlanWindow(ctx, nextParent);
  if (ctx.manager) {
    (ctx.manager as WindowManager).insertTypedWindow(child, ctx.thread);
  } else {
    ctx.thread.contextWindows = [...(ctx.thread.contextWindows ?? []), child];
  }
  return `expanded step ${stepId} into sub plan ${childId}`;
}

const collapseSubplanMethod: ObjectMethod = {
  description: "Collapse a step's expanded sub plan back into the step.",
  schema: {
    args: {
      step_id: { type: "string", required: true, description: "目标 step id" },
    },
  },
  onFormChange(change, { args }) {
    return {
      tip: isString(args.step_id) ? "Collapsing subplan..." : "collapse_subplan: 需要 args.step_id。",
      intents: [{ name: "collapse_subplan" }],
      quick_exec_submit: isString(args.step_id),
    };
  },
  exec: (ctx) => executeCollapseSubplan(ctx),
};

async function executeCollapseSubplan(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  if (!ctx.thread) return "[plan_window.collapse_subplan] 缺少 thread context。";
  const stepId = isString(ctx.args.step_id) ? ctx.args.step_id : "";
  if (!stepId) return "[plan_window.collapse_subplan] 缺少 args.step_id。";
  const idx = w.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return `[plan_window.collapse_subplan] step "${stepId}" 不存在。`;
  const cur = w.steps[idx]!;
  if (!cur.subPlanWindowId) {
    return `[plan_window.collapse_subplan] step "${stepId}" 未展开 sub plan。`;
  }
  const childId = cur.subPlanWindowId;

  const nextSteps = w.steps.slice();
  nextSteps[idx] = { ...cur, subPlanWindowId: undefined };
  const nextParent: PlanWindow = { ...w, steps: nextSteps };
  updatePlanWindow(ctx, nextParent);

  const all = ctx.thread.contextWindows ?? [];
  const childIdx = all.findIndex((c) => c.id === childId);
  if (childIdx >= 0) {
    const child = all[childIdx]!;
    if (child.class === "plan") {
      const archivedChild: PlanWindow = { ...(child as PlanWindow), status: "archived" };
      if (ctx.manager) {
        (ctx.manager as WindowManager).upsertWindow(archivedChild, ctx.thread);
      } else {
        const nextAll = all.slice();
        nextAll[childIdx] = archivedChild;
        ctx.thread.contextWindows = nextAll;
      }
    }
  }
  return `collapsed sub plan ${childId} from step ${stepId}`;
}

const markDoneMethod: ObjectMethod = {
  description: "Mark this plan as done.",
  exec: (ctx) => executeMarkDone(ctx),
};

async function executeMarkDone(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  const next: PlanWindow = { ...w, status: "done" };
  updatePlanWindow(ctx, next);
  return undefined;
}

const closeMethod: ObjectMethod = {
  description: "Close this plan window (cascades to sub plans).",
  exec: () => undefined,
};

// ─────────────────────────── constructor ──────────────────────────

const PLAN_TIP = `plan 把当前任务拆成可执行步骤，以 plan_window 挂在 context。
参数（任一即可）：plan（简单文本）、title/description、steps（数组）。`;

function constructorHasAnyInput(args: Record<string, unknown>): boolean {
  return (
    (isString(args.plan) && args.plan.trim().length > 0) ||
    isString(args.title) ||
    isString(args.description) ||
    Array.isArray(args.steps)
  );
}

function normalizeStepsInput(input: unknown): PlanWindowStep[] | undefined {
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

const planConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Create a plan window breaking a task into actionable steps.",
  intents: ["plan"],
  schema: {
    args: {
      plan: { type: "string", description: "简单文本（落入 description）；与 title/description/steps 二选一" },
      title: { type: "string", description: "plan 标题" },
      description: { type: "string", description: "plan 描述" },
      steps: { type: "array", description: "steps 数组 [{id?, text, status?}, ...]" },
    },
  },
  onFormChange(change, { args }) {
    const hasInput = constructorHasAnyInput(args);
    return {
      tip: hasInput ? "Creating plan..." : PLAN_TIP,
      intents: [{ name: "plan" }],
      quick_exec_submit: hasInput,
    };
  },
  permission: () => "allow",
  exec: async (ctx) => {
    if (!ctx.thread) return { ok: false, error: "[plan] 缺少 thread context。" };
    const args = ctx.args;
    if (!constructorHasAnyInput(args)) {
      return {
        ok: false,
        error: "[plan] 需要 args.plan (简单文本) 或 args.title / args.description / args.steps 之一。",
      };
    }
    const legacyPlanText = isString(args.plan) ? args.plan : undefined;
    const inputTitle = isString(args.title) ? args.title : undefined;
    const inputDescription = isString(args.description) ? args.description : legacyPlanText;
    const inputSteps = normalizeStepsInput(args.steps);

    const plan: PlanWindow = {
      id: generateWindowId("plan"),
      class: "plan",
      parentWindowId: ROOT_WINDOW_ID,
      title: inputTitle ?? "Plan",
      status: "active",
      createdAt: Date.now(),
      description: inputDescription,
      steps: inputSteps ?? [],
    };
    return { ok: true, window: plan };
  },
};

builtinRegistry.registerExecutable("plan", {
  methods: {
    update_plan: updatePlanMethod,
    add_step: addStepMethod,
    update_step: updateStepMethod,
    expand_step: expandStepMethod,
    collapse_subplan: collapseSubplanMethod,
    mark_done: markDoneMethod,
    close: closeMethod,
    plan: planConstructor,
  },
});
