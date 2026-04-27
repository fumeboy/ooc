import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const awaitAllCommand: CommandTableEntry = {
  paths: ["await_all"],
  match: () => ["await_all"],
  openable: true,
};

export async function executeAwaitAllCommand(ctx: CommandExecutionContext): Promise<void> {
  const threadIds = (ctx.args.thread_ids as string[]) ?? [];
  await ctx.tree.awaitThreads(ctx.threadId, threadIds);
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (td) {
    td.actions.push({ type: "inject", content: `[await_all] ${threadIds.join(", ")}`, timestamp: Date.now() });
    ctx.tree.writeThreadData(ctx.threadId, td);
  }
}
