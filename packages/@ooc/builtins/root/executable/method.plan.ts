/**
 * root.plan command — 委托到 plan_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.plan 的构造逻辑（findRootPlanWindow update / create new）已迁到
 * packages/@ooc/builtins/plan/executable/index.ts 的 kind="constructor" plan method。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("plan") 委托。
 *
 * 注意：constructor 不再做 update 幂等（每次调用都新建一个 plan_window）。
 * LLM 可通过 exec(<plan_window_id>, "update_plan", ...) 在已有 plan 上 in-place 更新。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { isString, emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 plan_window constructor 注册
import "@ooc/builtins/plan";

const KNOWLEDGE = `
plan 用于把当前任务拆成可执行步骤，并以 plan_window 形式持久挂在 context。

调用形态:
- 简单文本: open(method="plan", title="制定计划", args={ plan: "<计划描述>" })
  → 创建一个新的 plan_window，title 默认 "Plan"，description=<text>，steps=[]
- 完整指定: open(method="plan", title="...", args={ title: "...", description?: "...", steps?: [{ id?, text, status? }, ...] })
  → 完整创建一个新的 plan_window

每次 plan command 都会创建一个新 plan_window；如果想在已有 plan 上更新，请直接
exec(<plan_window_id>, "update_plan", args={...})。

创建之后:
- 后续可通过 exec(<plan_window_id>, "add_step", args={ text: "..." }) 追加 step
- 也可通过 exec(<plan_window_id>, "expand_step", args={ step_id }) 把 step 展开为 sub plan
- 跨 thread 共享: do(task=..., share_windows=[<plan_window_id>]) 把 plan 借给子 thread

旧的 thread.plan: string 字段已废弃；不要再读写。
`.trim();

const PLAN_BASIC_PATH = "internal/executable/plan/basic";
const PLAN_INPUT_PATH = "internal/executable/plan/input";

/** plan command 的可匹配路径集合。 */
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


/** plan command 表项：当前只命中基础 plan 路径。 */
export const planMethod: ObjectMethod = {
  paths: [PlanMethodPath.Plan],
  schema: {
    args: {
      plan: { type: "string", required: false, description: "计划文本（快捷方式）" },
      title: { type: "string", required: false, description: "plan 标题" },
      description: { type: "string", required: false, description: "plan 描述" },
      steps: { type: "array", required: false, description: "步骤列表 [{ id?, text, status? }]" },
    },
  } as MethodCallSchema,
  intent: emptyIntent,
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 在契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs（runtime 保证此 form 即 method_exec form）。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const entries: Record<string, string> = {
      [PLAN_BASIC_PATH]: KNOWLEDGE,
    };
    if (!hasAnyInput(args)) {
      entries[PLAN_INPUT_PATH] =
        "plan 还缺以下参数: plan 文本 (或 title / description / steps 任一)。\n" +
        "请用 refine(form_id, args={ plan: \"<计划文本>\" }) 或 refine(form_id, args={ title: \"...\", description: \"...\", steps: [...] }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executePlanMethod(ctx),
};

/** P6.§4-§5 thin delegator —— 委托到 plan_window constructor。 */
export const executePlanMethod = makeRootDelegator({
  method: "plan",
  constructorKind: "plan",
  objectLabel: "plan_window",
});
