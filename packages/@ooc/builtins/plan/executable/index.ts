/**
 * plan_window — 行动计划窗口 module。
 *
 * 见 docs/2026-05-26-remove-issue-add-subplan-design.md §3 /
 * meta/object.doc.ts:executable.children.context_window.children.plan_window
 *
 * 职责（与 file/talk/do 同协议）：
 * - types: PlanWindow / PlanWindowStep（已在 types.ts）
 * - commands: update_plan / add_step / update_step / expand_step / collapse_subplan / mark_done / close
 * - renderXml: live 完整渲染（title / description / steps 列表）
 * - compressView: level 1 / level 2 折叠态
 * - onClose: cascade close 所有 sub plan_window
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import {
  builtinRegistry,
  type OnCloseContext,
  type RenderContext,
} from "@ooc/core/extendable/_shared/registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ContextWindow,
} from "@ooc/core/extendable/_shared/types.js";
import type { PlanWindow, PlanWindowStep } from "../types.js";
import {
  xmlElement,
  xmlText,
  type XmlNode,
} from "@ooc/core/thinkable/context/xml.js";
import { readable } from "../readable.js";

import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import type { WindowManager } from "@ooc/core/executable/windows/_shared/manager.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { isString, emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";


// ─────────────────────────── knowledge paths ──────────────────────────────────

const PLAN_WINDOW_UPDATE_PLAN_BASIC = "internal/windows/plan/update_plan/basic";
const PLAN_WINDOW_ADD_STEP_BASIC = "internal/windows/plan/add_step/basic";
const PLAN_WINDOW_UPDATE_STEP_BASIC = "internal/windows/plan/update_step/basic";
const PLAN_WINDOW_EXPAND_STEP_BASIC = "internal/windows/plan/expand_step/basic";
const PLAN_WINDOW_COLLAPSE_SUBPLAN_BASIC = "internal/windows/plan/collapse_subplan/basic";
const PLAN_WINDOW_MARK_DONE_BASIC = "internal/windows/plan/mark_done/basic";
const PLAN_WINDOW_CLOSE_BASIC = "internal/windows/plan/close/basic";

const UPDATE_PLAN_KNOWLEDGE = `
plan_window.update_plan 修改 plan 的 title / description。

参数（至少给一个）：
- title: 可选，新 plan 标题
- description: 可选，新 plan 说明

示例：refine(form, args={ title: "重构 thinkable", description: "为 v2 做准备" })
`.trim();

const ADD_STEP_KNOWLEDGE = `
plan_window.add_step 在 steps 末尾追加一个新 step。

参数：
- text: 必填，步骤描述
- status: 可选，初始状态（默认 "pending"）；取值: pending / in-progress / done / blocked

返回值会包含新 step 的 id，便于后续 update_step / expand_step 引用。
`.trim();

const UPDATE_STEP_KNOWLEDGE = `
plan_window.update_step 修改某 step 的 text / status。

参数：
- step_id: 必填，目标 step id（add_step 创建时返回；或 renderXml 中可见）
- text: 可选，新文本
- status: 可选，新状态（pending / in-progress / done / blocked）

至少给一个修改字段；step_id 不存在会返回错误。
`.trim();

const EXPAND_STEP_KNOWLEDGE = `
plan_window.expand_step 把某 step 展开为 sub plan_window。

参数：
- step_id: 必填
- title: 可选，sub plan 的 title；缺省 = 父 step 的 text
- description: 可选，sub plan 的描述

行为：
- 创建一个新的 child plan_window，parentPlanWindowId = 当前 plan_window.id, parentStepId = step_id
- 父 step.subPlanWindowId 写回为 child 的 id
- 返回 child plan_window.id；LLM 可后续 exec(<child_id>, ...) 操作

如果该 step 已经 expanded（subPlanWindowId 非空），返回错误，请先 collapse_subplan。
`.trim();

const COLLAPSE_SUBPLAN_KNOWLEDGE = `
plan_window.collapse_subplan 反向操作：archive 某 step 关联的 sub plan_window，并清掉 step.subPlanWindowId。

参数：
- step_id: 必填

执行后：
- sub plan_window.status → "archived"
- step.subPlanWindowId 清空
- 不会 cascade 关闭 sub plan 的子树 plan（如有，留给后续手工 close）
`.trim();

const MARK_DONE_KNOWLEDGE = `
plan_window.mark_done 把 plan_window.status 切到 "done"。

不影响 steps 自身的 status；只是标记 plan 层"已完成"。完成后 plan_window 仍然存在于 context，
直到 LLM 显式 close。
`.trim();

const CLOSE_KNOWLEDGE = `
plan_window.close 关闭 plan_window；级联 close 所有 sub plan_window（onClose hook）。
关闭后 window 从 context 移除，不影响其它 thread（如已通过 share 借出，参见 sharing 规则）。
`.trim();

// ─────────────────────────── helpers ──────────────────────────────────────────

function generateStepId(): string {
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const VALID_STEP_STATUS = new Set(["pending", "in-progress", "done", "blocked"] as const);

function asStepStatus(v: unknown): PlanWindowStep["status"] | undefined {
  if (typeof v !== "string") return undefined;
  return (VALID_STEP_STATUS as Set<string>).has(v) ? (v as PlanWindowStep["status"]) : undefined;
}

/** 把 ctx.self 校验成 PlanWindow。
 *  P6.§3: manager 在 dispatch 阶段已保证 self.type === "plan"，本 helper 仅做类型 cast。 */
function requirePlanWindow(ctx: MethodExecutionContext): PlanWindow {
  return ctx.self as PlanWindow;
}

/** 通过 manager 持久化更新（避免被 toData() 复原）；fallback 直接 mutate。 */
function updatePlanWindow(ctx: MethodExecutionContext, next: PlanWindow): void {
  if (ctx.manager) {
    // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager 取 upsertWindow。
    (ctx.manager as WindowManager).upsertWindow(next, ctx.thread);
  } else {
    // fallback 路径：直接修改原 window 的字段（in-place）
    Object.assign(ctx.self as PlanWindow, next);
  }
}

// ─────────────────────────── commands ─────────────────────────────────────────

const updatePlanMethod: ObjectMethod = {
  paths: ["update_plan"],
  schema: {
    args: {
      title: { type: "string", description: "新 plan 标题" },
      description: { type: "string", description: "新 plan 说明" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [PLAN_WINDOW_UPDATE_PLAN_BASIC]: UPDATE_PLAN_KNOWLEDGE });
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
  paths: ["add_step"],
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
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [PLAN_WINDOW_ADD_STEP_BASIC]: ADD_STEP_KNOWLEDGE });
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
  paths: ["update_step"],
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
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [PLAN_WINDOW_UPDATE_STEP_BASIC]: UPDATE_STEP_KNOWLEDGE });
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
  paths: ["expand_step"],
  schema: {
    args: {
      step_id: { type: "string", required: true, description: "目标 step id" },
      title: { type: "string", description: "sub plan 的 title；缺省 = 父 step 的 text" },
      description: { type: "string", description: "sub plan 的描述" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [PLAN_WINDOW_EXPAND_STEP_BASIC]: EXPAND_STEP_KNOWLEDGE });
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
    type: "plan",
    parentWindowId: ROOT_WINDOW_ID,
    title: childTitle,
    status: "active",
    createdAt: Date.now(),
    description: childDescription,
    steps: [],
    parentPlanWindowId: w.id,
    parentStepId: stepId,
  };

  // 父 step 写回 subPlanWindowId
  const nextSteps = w.steps.slice();
  nextSteps[idx] = { ...cur, subPlanWindowId: childId };
  const nextParent: PlanWindow = { ...w, steps: nextSteps };

  // 落地：父更新 + 子插入
  updatePlanWindow(ctx, nextParent);
  if (ctx.manager) {
    // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager 取 insertTypedWindow。
    (ctx.manager as WindowManager).insertTypedWindow(child, ctx.thread);
  } else {
    ctx.thread.contextWindows = [...(ctx.thread.contextWindows ?? []), child];
  }
  return `expanded step ${stepId} into sub plan ${childId}`;
}

const collapseSubplanMethod: ObjectMethod = {
  paths: ["collapse_subplan"],
  schema: {
    args: {
      step_id: { type: "string", required: true, description: "目标 step id" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, {
      [PLAN_WINDOW_COLLAPSE_SUBPLAN_BASIC]: COLLAPSE_SUBPLAN_KNOWLEDGE,
    });
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

  // 清 step.subPlanWindowId
  const nextSteps = w.steps.slice();
  nextSteps[idx] = { ...cur, subPlanWindowId: undefined };
  const nextParent: PlanWindow = { ...w, steps: nextSteps };
  updatePlanWindow(ctx, nextParent);

  // sub plan 切到 archived（不删，保留历史可见）
  const all = ctx.thread.contextWindows ?? [];
  const childIdx = all.findIndex((c) => c.id === childId);
  if (childIdx >= 0) {
    // batch C narrowing(N1): contextWindows 元素契约层是 base；type==="plan" 守卫后
    // narrow 回 PlanWindow 以 spread 出含 steps 的完整 PlanWindow。
    const child = all[childIdx]!;
    if (child.type === "plan") {
      const archivedChild: PlanWindow = { ...(child as PlanWindow), status: "archived" };
      if (ctx.manager) {
        // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager。
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
  paths: ["mark_done"],
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [PLAN_WINDOW_MARK_DONE_BASIC]: MARK_DONE_KNOWLEDGE });
  },
  exec: (ctx) => executeMarkDone(ctx),
};

async function executeMarkDone(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  const next: PlanWindow = { ...w, status: "done" };
  updatePlanWindow(ctx, next);
  return undefined;
}

const closeMethod: ObjectMethod = {
  paths: ["close"],
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [PLAN_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE });
  },
  exec: () => undefined, // cascade 关闭由 onClose hook + WindowManager.close 自带级联完成
};

// ─────────────────────────── render ──────────────────────────────────────────
// plan_window 的 renderXml hook 已迁出到 ../readable.ts。

function compressPlanWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const w = ctx.window as PlanWindow;
  const total = w.steps.length;
  const done = w.steps.filter((s) => s.status === "done").length;
  const children: XmlNode[] = [];
  if (level === 1) {
    children.push(
      xmlElement("plan_summary", {
        status: w.status,
        step_count: String(total),
        done_ratio: `${done}/${total}`,
      }),
    );
  } else {
    children.push(
      xmlElement("plan_summary", {
        status: w.status,
      }),
    );
  }
  children.push(
    xmlElement("compressed", {
      level: String(level),
      hint: "exec(window_id, 'expand') to restore",
    }),
  );
  return children;
}

// ─────────────────────────── onClose ─────────────────────────────────────────

/**
 * close plan_window 时级联关闭所有 sub plan_window。
 *
 * 实际级联由 WindowManager.close 通过 parentWindowId 自动处理；但 plan_window 的 sub 不是
 * parentWindowId 关系（sub plan 挂在 ROOT_WINDOW_ID 下，通过 parentPlanWindowId 软链），
 * 所以在这里显式遍历 contextWindows 找 parentPlanWindowId === self.id 的 plan_window，
 * 把它们也 close 掉。
 */
function onClosePlanWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.type !== "plan") return;
  // sub plan_window 是通过 parentPlanWindowId 软链关联（不是 parentWindowId）;
  // 所以 WindowManager 的 cascade close 不会自动追到它们 —— 这里显式把它们切到 archived。
  //
  // 实现：直接 mutate thread.contextWindows + 同时同步原 window 对象（如果 mgr 持有同一引用）。
  // close 调用方一般在结束后 `thread.contextWindows = mgr.toData()` 覆盖,所以我们只能通过
  // mutate 已有 PlanWindow 对象 in-place（mgr 持有同一引用）来让 sub plan 的 status 在 mgr
  // 的 Map 里也反映出来。
  const all = ctx.thread.contextWindows ?? [];
  for (const c of all) {
    if (c.type === "plan" && (c as PlanWindow).parentPlanWindowId === w.id) {
      (c as PlanWindow).status = "archived";
    }
  }
}

// ─────────────────────────── basicKnowledge ───────────────────────────────────

const PLAN_BASIC_KNOWLEDGE = `
plan_window 是 thread 的行动计划窗口（first-class ContextWindow）。
由 root.plan command 创建/更新；支持 sub plan 嵌套 + 通过 do.share_windows 共享给子 thread。

在 plan_window 上可调命令（通过 exec(parent_window_id="<plan_window_id>", method="X", args=...) 调用）：
- update_plan: 更新 plan.title / description
- add_step: 追加 step（参数 text 必填；status 可选，默认 pending）
- update_step: 修改某 step 的 text / status（参数 step_id 必填）
- expand_step: 把 step 展开为 sub plan_window（创建 child + 写回 subPlanWindowId）
- collapse_subplan: 反向；archive sub plan_window + 清 subPlanWindowId
- mark_done: 标记 plan_window 自身完成（status → "done"）
- close: 关闭 plan_window（cascade 把所有 sub plan_window 切 archived）

renderXml: <plan_window>...<description?/><steps count><step id status sub_plan_window_id?/>...</steps></plan_window>
`.trim();

// ─────────────────────────── constructor (P6.§4-§5) ──────────────────────────

const PLAN_CONSTRUCTOR_BASIC = "internal/objects/plan/constructor/basic";
const PLAN_CONSTRUCTOR_INPUT = "internal/objects/plan/constructor/input";

const PLAN_CONSTRUCTOR_KNOWLEDGE = `
plan 用于把当前任务拆成可执行步骤，并以 plan_window 形式持久挂在 context。

调用形态:
- 简单文本: open(method="plan", title="制定计划", args={ plan: "<计划描述>" })
  → 创建一个 root plan_window（无 parentPlanWindowId），title 默认 "Plan"，description=<text>，steps=[]
- 完整指定: open(method="plan", args={ title: "...", description?: "...", steps?: [{ id?, text, status? }, ...] })
  → 完整创建 root plan_window

创建之后:
- 后续可通过 exec(<plan_window_id>, "add_step", args={ text: "..." }) 追加 step
- 也可通过 exec(<plan_window_id>, "expand_step", args={ step_id }) 把 step 展开为 sub plan
- 跨 thread 共享: do(task=..., share_windows=[<plan_window_id>]) 把 plan 借给子 thread
`.trim();

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

/**
 * P6.§4-§5 constructor —— 创建 root plan_window。
 *
 * 职责:
 *  - 校验 args (plan / title / description / steps 至少一项)
 *  - generateWindowId("plan")，build PlanWindow literal (无 parentPlanWindowId == root plan)
 *  - 返回 { ok: true, object } —— manager.submit's §2 分支调用 insertTypedWindow 挂载
 *
 * args 接受:
 *  - { plan: "<text>" } —— 简单文本，落入 description
 *  - { title?, description?, steps?: PlanWindowStep[] } —— 完整指定
 *
 * 注意: 与旧 root.plan 不同,不再 idempotent 更新已存在 root plan_window;
 * 每次调用都创建一个新的 plan_window。LLM 想改既有 plan 用 update_plan。
 */
const planConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["plan"],
  schema: {
    args: {
      plan: { type: "string", description: "简单文本（落入 description）；与 title/description/steps 二选一" },
      title: { type: "string", description: "plan 标题" },
      description: { type: "string", description: "plan 描述" },
      steps: { type: "array", description: "steps 数组 [{id?, text, status?}, ...]" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [PLAN_CONSTRUCTOR_BASIC]: PLAN_CONSTRUCTOR_KNOWLEDGE,
    };
    if (formStatus === "open" && !constructorHasAnyInput(args)) {
      entries[PLAN_CONSTRUCTOR_INPUT] =
        "plan 还缺以下参数: plan 文本 (或 title / description / steps 任一)。\n" +
        "请用 refine(form_id, args={ plan: \"<计划文本>\" }) 或 refine(form_id, args={ title: \"...\", description: \"...\", steps: [...] }) 补齐后 submit(form_id)。";
    }
    return buildGuidanceWindows(form, entries);
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
      type: "plan",
      parentWindowId: ROOT_WINDOW_ID,
      title: inputTitle ?? "Plan",
      status: "active",
      createdAt: Date.now(),
      description: inputDescription,
      steps: inputSteps ?? [],
    };
    return { ok: true, object: plan };
  },
};

// ─────────────────────────── register ────────────────────────────────────────

builtinRegistry.registerObjectType("plan", {
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
  onClose: onClosePlanWindow,
  readable,
  compressView: compressPlanWindow,
  basicKnowledge: PLAN_BASIC_KNOWLEDGE,
});
