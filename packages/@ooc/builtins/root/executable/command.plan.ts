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

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/command-types.js";
import { lookupConstructor } from "@ooc/core/extendable/_shared/registry.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 plan_window constructor 注册
import "@ooc/builtins/plan";

const KNOWLEDGE = `
plan 用于把当前任务拆成可执行步骤，并以 plan_window 形式持久挂在 context。

调用形态:
- 简单文本: open(command="plan", title="制定计划", args={ plan: "<计划描述>" })
  → 创建一个新的 plan_window，title 默认 "Plan"，description=<text>，steps=[]
- 完整指定: open(command="plan", title="...", args={ title: "...", description?: "...", steps?: [{ id?, text, status? }, ...] })
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

/** plan command 表项：当前只命中基础 plan 路径。 */
export const planCommand: CommandTableEntry = {
  paths: [PlanCommandPath.Plan],
  match: () => [PlanCommandPath.Plan],
  knowledge: (args): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = {
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

/**
 * P6.§4-§5 thin delegator —— 委托到 plan_window constructor。
 */
export async function executePlanCommand(
  ctx: CommandExecutionContext,
): Promise<MethodOutcome | string | undefined> {
  const ctor = lookupConstructor("plan");
  if (!ctor) return "[plan] plan_window constructor 未注册（registry 期望 kind=\"constructor\" 的 plan method）。";
  return await ctor.exec(ctx);
}
