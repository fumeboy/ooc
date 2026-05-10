import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

/** plan command 暴露给 LLM 的知识说明。 */
export const KNOWLEDGE = `
plan 用于把一个目标拆成可执行步骤，并输出后续行动计划。

参数说明：
- plan: 必填

调用示例：
open(type="command", command="plan", description="先把迁移工作拆解")
refine(form_id, { plan: "完成 executable command 迁移" })
submit(form_id)
`;

/** plan command 的可匹配路径集合。 */
export enum PlanCommandPath {
  /** 基础 plan 指令：制定计划。 */
  Plan = "plan",
}

/** plan command 表项：当前只命中基础 plan 路径。 */
export const planCommand: CommandTableEntry = {
  paths: [
    PlanCommandPath.Plan,
  ],
  match: (_args) => {
    return [PlanCommandPath.Plan];
  },
  // 暂不实现具体执行逻辑
};

/** 执行 plan command：把提交的计划文本覆盖到当前线程上下文。 */
export async function executePlanCommand(ctx: CommandExecutionContext): Promise<string | undefined> {
  if (!ctx.thread) return undefined;

  // 兼容三种 LLM 实际写法：
  // 1) {plan: "..."}        — 文档示例形态
  // 2) {goal, steps, ...}   — LLM 自然结构化产物
  // 3) 纯 JSON 字符串       — 个别模型直接序列化
  const planArg = ctx.args.plan;
  if (typeof planArg === "string" && planArg.trim() !== "") {
    ctx.thread.plan = planArg;
  } else {
    ctx.thread.plan = JSON.stringify(ctx.args, null, 2);
  }
  return undefined;
}
