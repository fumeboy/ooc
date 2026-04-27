import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const awaitCommand: CommandTableEntry = {
  paths: ["await"],
  match: () => ["await"],
  openable: true,
};

export async function executeAwaitCommand(ctx: CommandExecutionContext): Promise<void> {
  const threadIds = [ctx.args.thread_id as string];
  await ctx.tree.awaitThreads(ctx.threadId, threadIds);
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (td) {
    td.actions.push({ type: "inject", content: `[await] ${threadIds.join(", ")}`, timestamp: Date.now() });
    ctx.tree.writeThreadData(ctx.threadId, td);
  }
}
