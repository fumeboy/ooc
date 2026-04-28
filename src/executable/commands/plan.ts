import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const planCommand: CommandTableEntry = {
  paths: ["plan"],
  match: () => ["plan"],
  openable: true,
};

export function executePlanCommand(ctx: CommandExecutionContext): void {
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (!td) return;
  td.plan = ctx.args.text as string;
  td.events.push({ type: "set_plan", content: ctx.args.text as string, timestamp: Date.now() });
  ctx.tree.writeThreadData(ctx.threadId, td);
}
