import { consola } from "consola";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const returnCommand: CommandTableEntry = {
  paths: ["return"],
  match: () => ["return"],
  openable: true,
};

export async function executeReturnCommand(ctx: CommandExecutionContext): Promise<void> {
  const summary = ctx.args.summary as string ?? "";
  await ctx.tree.returnThread(ctx.threadId, summary);
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (td) {
    td.actions.push({ type: "thread_return", content: summary, timestamp: Date.now() });
    ctx.tree.writeThreadData(ctx.threadId, td);
  }
  consola.info(`[Engine] return: ${summary.slice(0, 100)}`);
}
