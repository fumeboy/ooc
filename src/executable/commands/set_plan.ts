import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const setPlanCommand: CommandTableEntry = {
  paths: ["set_plan"],
  match: () => ["set_plan"],
  openable: true,
};

export function executeSetPlanCommand(ctx: CommandExecutionContext): void {
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (!td) return;
  td.plan = ctx.args.text as string;
  td.actions.push({ type: "set_plan", content: ctx.args.text as string, timestamp: Date.now() });
  ctx.tree.writeThreadData(ctx.threadId, td);
}
