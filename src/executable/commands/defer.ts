import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export enum DeferCommandPath {
  /** defer 指令：注册后续 command 触发时的提醒内容。 */
  Defer = "defer",
}

export const deferCommand: CommandTableEntry = {
  paths: [DeferCommandPath.Defer],
  match: () => [DeferCommandPath.Defer],
  openable: true,
};

export function executeDeferCommand(ctx: CommandExecutionContext): void {
  const onCommand = ctx.args.on_command as string;
  const content = ctx.args.content as string;
  if (!onCommand || !content) return;
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (!td) return;
  if (!td.hooks) td.hooks = [];
  td.hooks.push({
    event: `on:${onCommand}`,
    traitName: "",
    content,
    once: (ctx.args.once as boolean) ?? true,
  });
  td.events.push({ type: "inject", content: `[defer] 已注册 on:${onCommand} 提醒`, timestamp: Date.now() });
  ctx.tree.writeThreadData(ctx.threadId, td);
}
