/**
 * root.plan method — 在当前 thread 上创建 / 更新 root plan_window。
 *
 * 2026-05-26 升级（B 段 design / docs/2026-05-26-remove-issue-add-subplan-design.md §3）:
 * - 旧：覆盖式写 thread.plan: string 字段（已彻底废弃，patches.thread_plan_deprecated）
 * - 新：在 thread.contextWindows 创建 / 更新一个 root plan_window（无 parentPlanWindowId 的 plan_window）
 *
 * 调用形态：
 * - exec(method="plan", args={ plan: "<text>" }) → 兼容旧调用：把 plan 文本写入 description
 * - exec(method="plan", args={ title, description?, steps?: PlanWindowStep[] }) → 完整指定
 *
 * 幂等性：
 * - thread 已有 root plan_window（parentPlanWindowId 为空的 plan_window）→ 直接 update（不创建新的）
 * - 没有 → 创建一个新的 root plan_window
 *
 * 返回值: 新 / 已有 root plan_window 的 id，便于 LLM 后续 exec(<id>, ...) 操作。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ContextWindow,
  type PlanWindow,
  type PlanWindowStep,
} from "../_shared/types.js";

const KNOWLEDGE = `
plan 用于把当前任务拆成可执行步骤，并以 plan_window 形式持久挂在 context。

调用形态:
- 简单文本: open(method="plan", title="制定计划", args={ plan: "<计划描述>" })
  → 创建/更新一个 root plan_window，title 默认 "Plan"，description=<text>，steps=[]
- 完整指定: open(method="plan", title="...", args={ title: "...", description?: "...", steps?: [{ id?, text, status? }, ...] })
  → 完整创建/更新 root plan_window

幂等性: 当前 thread 若已存在 root plan_window（无 parentPlanWindowId 的 plan_window），
本 method 会就地 update；否则会新建一个。返回值是该 plan_window.id。

创建之后:
- 后续可通过 exec(<plan_window_id>, "add_step", args={ text: "..." }) 追加 step
- 也可通过 exec(<plan_window_id>, "expand_step", args={ step_id }) 把 step 展开为 sub plan
- 跨 thread 共享: do(task=..., share_windows=[<plan_window_id>]) 把 plan 借给子 thread

旧的 thread.plan: string 字段已废弃；不要再读写。
`.trim();

const PLAN_BASIC_PATH = "internal/executable/plan/basic";
const PLAN_INPUT_PATH = "internal/executable/plan/input";

/** plan method 的可匹配路径集合。 */
export enum PlanCommandPath {
  Plan = "plan",
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function hasAnyInput(args: Record<string, unknown>): boolean {
  return (
    (isString(args.plan) && args.plan.trim().length > 0) ||
    isString(args.title) ||
    isString(args.description) ||
    Array.isArray(args.steps)
  );
}

/** plan method 表项：当前只命中基础 plan 路径。 */
export const planCommand: MethodEntry = {
  paths: [PlanCommandPath.Plan],
  match: () => [PlanCommandPath.Plan],
  knowledge: (args): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = {
      [PLAN_BASIC_PATH]: KNOWLEDGE,
    };
    if (!hasAnyInput(args)) {
      entries[PLAN_INPUT_PATH] =
        "plan 还缺以下参数: plan 文本 (或 title / description / steps 任一)。\n" +
        "请用 refine(form_id, args={ plan: \"<计划文本>\" }) 或 refine(form_id, args={ title: \"...\", description: \"...\", steps: [...] }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executePlanCommand(ctx),
};

function generateStepId(): string {
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const VALID_STEP_STATUS = new Set(["pending", "in-progress", "done", "blocked"]);

function normalizeStepsInput(input: unknown): PlanWindowStep[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: PlanWindowStep[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const text = isString(obj.text) ? obj.text : "";
    if (!text) continue;
    const status = isString(obj.status) && VALID_STEP_STATUS.has(obj.status)
      ? (obj.status as PlanWindowStep["status"])
      : "pending";
    const id = isString(obj.id) && obj.id.length > 0 ? obj.id : generateStepId();
    out.push({ id, text, status });
  }
  return out;
}

/** 找当前 thread 上现有的 root plan_window（无 parentPlanWindowId）。 */
function findRootPlanWindow(windows: ContextWindow[]): PlanWindow | undefined {
  for (const w of windows) {
    if (w.type === "plan" && !w.parentPlanWindowId) return w;
  }
  return undefined;
}

/**
 * 执行 plan method:
 * - 已存在 root plan_window → 就地更新（title / description / steps 任给）
 * - 否则新建 root plan_window
 *
 * 返回 outcome.result = plan_window.id，便于 LLM 后续操作。
 */
export async function executePlanCommand(
  ctx: MethodExecutionContext,
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const thread = ctx.thread;
  if (!thread) return { ok: false, error: "[plan] 缺少 thread context。" };

  const args = ctx.args;
  if (!hasAnyInput(args)) {
    return {
      ok: false,
      error: "[plan] 需要 args.plan (简单文本) 或 args.title / args.description / args.steps 之一。",
    };
  }

  // 兼容旧调用: args.plan 是字符串 → 当 description
  const legacyPlanText = isString(args.plan) ? args.plan : undefined;
  const inputTitle = isString(args.title) ? args.title : undefined;
  const inputDescription = isString(args.description) ? args.description : legacyPlanText;
  const inputSteps = normalizeStepsInput(args.steps);

  const all = thread.contextWindows ?? [];
  const existing = findRootPlanWindow(all);

  if (existing) {
    // update 模式：只覆盖给出的字段
    const next: PlanWindow = {
      ...existing,
      title: inputTitle !== undefined ? inputTitle : existing.title,
      description:
        inputDescription !== undefined ? inputDescription : existing.description,
      steps: inputSteps !== undefined ? inputSteps : existing.steps,
    };
    if (ctx.manager) {
      ctx.manager.upsertWindow(next);
    } else {
      const idx = all.findIndex((w) => w.id === existing.id);
      if (idx >= 0) {
        const nextAll = all.slice();
        nextAll[idx] = next;
        thread.contextWindows = nextAll;
      }
    }
    return { ok: true, result: existing.id };
  }

  // create 模式
  const id = generateWindowId("plan");
  const plan: PlanWindow = {
    id,
    type: "plan",
    parentWindowId: ROOT_WINDOW_ID,
    title: inputTitle ?? "Plan",
    status: "active",
    createdAt: Date.now(),
    description: inputDescription,
    steps: inputSteps ?? [],
  };
  if (ctx.manager) {
    ctx.manager.insertTypedWindow(plan);
  } else {
    thread.contextWindows = [...all, plan];
  }
  return { ok: true, result: id };
}
