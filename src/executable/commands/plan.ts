import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export enum PlanCommandPath {
  /** plan 指令：记录当前线程的执行计划文本。 */
  Plan = "plan",
}

export const planCommand: CommandTableEntry = {
  paths: [PlanCommandPath.Plan],
  match: () => [PlanCommandPath.Plan],
  openable: true,
};

export function executePlanCommand(ctx: CommandExecutionContext): void {
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (!td) return;
  td.plan = ctx.args.text as string;
  td.events.push({ type: "set_plan", content: ctx.args.text as string, timestamp: Date.now() });
  ctx.tree.writeThreadData(ctx.threadId, td);
}
