/**
 * plan_window — 行动计划窗口 module。
 *
 * 见 docs/2026-05-26-remove-issue-add-subplan-design.md §3 /
 * meta/object.doc.ts:executable.children.context_window.children.plan_window
 *
 * 职责（与 file/talk/do 同协议）：
 * - types: PlanWindow / PlanWindowStep（已在 types.ts）
 * - methods: update_plan / add_step / update_step / expand_step / collapse_subplan / mark_done / close
 * - renderXml: live 完整渲染（title / description / steps 列表）
 * - compressView: level 1 / level 2 折叠态
 * - onClose: cascade close 所有 sub plan_window
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import {
  registerWindowType,
  type OnCloseContext,
  type RenderContext,
} from "../_shared/registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ContextWindow,
} from "../_shared/types.js";
import type { PlanWindow, PlanWindowStep } from "./types.js";
import {
  xmlElement,
  xmlText,
  type XmlNode,
} from "../../../thinkable/context/xml.js";

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

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function generateStepId(): string {
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const VALID_STEP_STATUS = new Set(["pending", "in-progress", "done", "blocked"] as const);

function asStepStatus(v: unknown): PlanWindowStep["status"] | undefined {
  if (typeof v !== "string") return undefined;
  return (VALID_STEP_STATUS as Set<string>).has(v) ? (v as PlanWindowStep["status"]) : undefined;
}

/** 把 ctx.parentWindow 校验成 PlanWindow；失败返回错误字符串。 */
function requirePlanWindow(ctx: MethodExecutionContext): PlanWindow | string {
  const w = ctx.parentWindow;
  if (!w || w.type !== "plan") {
    return "[plan_window] 未挂载在 plan_window 上。";
  }
  return w;
}

/** 通过 manager 持久化更新（避免被 toData() 复原）；fallback 直接 mutate。 */
function updatePlanWindow(ctx: MethodExecutionContext, next: PlanWindow): void {
  if (ctx.manager) {
    ctx.manager.upsertWindow(next);
  } else {
    // fallback 路径：直接修改原 window 的字段（in-place）
    Object.assign(ctx.parentWindow as PlanWindow, next);
  }
}

// ─────────────────────────── methods ─────────────────────────────────────────

const updatePlanCommand: MethodEntry = {
  paths: ["update_plan"],
  match: () => ["update_plan"],
  knowledge: (): MethodKnowledgeEntries => ({ [PLAN_WINDOW_UPDATE_PLAN_BASIC]: UPDATE_PLAN_KNOWLEDGE }),
  exec: (ctx) => executeUpdatePlan(ctx),
};

async function executeUpdatePlan(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  if (typeof w === "string") return w;
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

const addStepCommand: MethodEntry = {
  paths: ["add_step"],
  match: () => ["add_step"],
  knowledge: (): MethodKnowledgeEntries => ({ [PLAN_WINDOW_ADD_STEP_BASIC]: ADD_STEP_KNOWLEDGE }),
  exec: (ctx) => executeAddStep(ctx),
};

async function executeAddStep(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  if (typeof w === "string") return w;
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

const updateStepCommand: MethodEntry = {
  paths: ["update_step"],
  match: () => ["update_step"],
  knowledge: (): MethodKnowledgeEntries => ({ [PLAN_WINDOW_UPDATE_STEP_BASIC]: UPDATE_STEP_KNOWLEDGE }),
  exec: (ctx) => executeUpdateStep(ctx),
};

async function executeUpdateStep(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  if (typeof w === "string") return w;
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

const expandStepCommand: MethodEntry = {
  paths: ["expand_step"],
  match: () => ["expand_step"],
  knowledge: (): MethodKnowledgeEntries => ({ [PLAN_WINDOW_EXPAND_STEP_BASIC]: EXPAND_STEP_KNOWLEDGE }),
  exec: (ctx) => executeExpandStep(ctx),
};

async function executeExpandStep(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  if (typeof w === "string") return w;
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
    ctx.manager.insertTypedWindow(child);
  } else {
    ctx.thread.contextWindows = [...(ctx.thread.contextWindows ?? []), child];
  }
  return `expanded step ${stepId} into sub plan ${childId}`;
}

const collapseSubplanCommand: MethodEntry = {
  paths: ["collapse_subplan"],
  match: () => ["collapse_subplan"],
  knowledge: (): MethodKnowledgeEntries => ({
    [PLAN_WINDOW_COLLAPSE_SUBPLAN_BASIC]: COLLAPSE_SUBPLAN_KNOWLEDGE,
  }),
  exec: (ctx) => executeCollapseSubplan(ctx),
};

async function executeCollapseSubplan(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  if (typeof w === "string") return w;
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
    const child = all[childIdx]!;
    if (child.type === "plan") {
      const archivedChild: PlanWindow = { ...child, status: "archived" };
      if (ctx.manager) {
        ctx.manager.upsertWindow(archivedChild);
      } else {
        const nextAll = all.slice();
        nextAll[childIdx] = archivedChild;
        ctx.thread.contextWindows = nextAll;
      }
    }
  }
  return `collapsed sub plan ${childId} from step ${stepId}`;
}

const markDoneCommand: MethodEntry = {
  paths: ["mark_done"],
  match: () => ["mark_done"],
  knowledge: (): MethodKnowledgeEntries => ({ [PLAN_WINDOW_MARK_DONE_BASIC]: MARK_DONE_KNOWLEDGE }),
  exec: (ctx) => executeMarkDone(ctx),
};

async function executeMarkDone(ctx: MethodExecutionContext): Promise<string | undefined> {
  const w = requirePlanWindow(ctx);
  if (typeof w === "string") return w;
  const next: PlanWindow = { ...w, status: "done" };
  updatePlanWindow(ctx, next);
  return undefined;
}

const closeCommand: MethodEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): MethodKnowledgeEntries => ({ [PLAN_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: () => undefined, // cascade 关闭由 onClose hook + WindowManager.close 自带级联完成
};

// ─────────────────────────── render ──────────────────────────────────────────

function renderPlanWindow(ctx: RenderContext): XmlNode[] {
  const w = ctx.window as PlanWindow;
  const children: XmlNode[] = [];
  if (w.description !== undefined) {
    children.push(xmlElement("description", {}, [xmlText(w.description)]));
  }
  const stepNodes: XmlNode[] = w.steps.map((s) => {
    const attrs: Record<string, string> = { id: s.id, status: s.status };
    if (s.subPlanWindowId) attrs.sub_plan_window_id = s.subPlanWindowId;
    return xmlElement("step", attrs, [xmlText(s.text)]);
  });
  children.push(
    xmlElement(
      "steps",
      { count: String(w.steps.length) },
      stepNodes,
    ),
  );
  if (w.parentPlanWindowId) {
    children.push(
      xmlElement("parent_plan", {
        plan_window_id: w.parentPlanWindowId,
        step_id: w.parentStepId ?? "",
      }),
    );
  }
  return children;
}

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
由 root.plan method 创建/更新；支持 sub plan 嵌套 + 通过 do.share_windows 共享给子 thread。

在 plan_window 上可调 method（通过 exec(parent_window_id="<plan_window_id>", method="X", args=...) 调用）：
- update_plan: 更新 plan.title / description
- add_step: 追加 step（参数 text 必填；status 可选，默认 pending）
- update_step: 修改某 step 的 text / status（参数 step_id 必填）
- expand_step: 把 step 展开为 sub plan_window（创建 child + 写回 subPlanWindowId）
- collapse_subplan: 反向；archive sub plan_window + 清 subPlanWindowId
- mark_done: 标记 plan_window 自身完成（status → "done"）
- close: 关闭 plan_window（cascade 把所有 sub plan_window 切 archived）

renderXml: <plan_window>...<description?/><steps count><step id status sub_plan_window_id?/>...</steps></plan_window>
`.trim();

// ─────────────────────────── register ────────────────────────────────────────

registerWindowType("plan", {
  methods: {
    update_plan: updatePlanCommand,
    add_step: addStepCommand,
    update_step: updateStepCommand,
    expand_step: expandStepCommand,
    collapse_subplan: collapseSubplanCommand,
    mark_done: markDoneCommand,
    close: closeCommand,
  },
  onClose: onClosePlanWindow,
  renderXml: renderPlanWindow,
  compressView: compressPlanWindow,
  basicKnowledge: PLAN_BASIC_KNOWLEDGE,
});
