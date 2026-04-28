import { consola } from "consola";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export enum ReturnCommandPath {
  /** return 指令：结束当前线程并写入总结。 */
  Return = "return",
}

export const returnCommand: CommandTableEntry = {
  paths: [ReturnCommandPath.Return],
  match: () => [ReturnCommandPath.Return],
  openable: true,
};

export async function executeReturnCommand(ctx: CommandExecutionContext): Promise<void> {
  const summary = ctx.args.summary as string ?? "";
  await ctx.tree.returnThread(ctx.threadId, summary);
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (td) {
    td.events.push({ type: "thread_return", content: summary, timestamp: Date.now() });
    ctx.tree.writeThreadData(ctx.threadId, td);
  }
  consola.info(`[Engine] return: ${summary.slice(0, 100)}`);
}
