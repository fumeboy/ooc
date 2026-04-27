import { consola } from "consola";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const thinkCommand: CommandTableEntry = {
  paths: ["think", "think.fork", "think.continue", "think.wait"],
  match: (args) => {
    const hit: string[] = ["think"];
    const ctx = typeof args.context === "string" ? args.context : "";
    if (args.wait === true) hit.push("think.wait");
    if (ctx === "fork") hit.push("think.fork");
    if (ctx === "continue") hit.push("think.continue");
    return hit;
  },
  openable: true,
};

export async function executeThinkCommand(ctx: CommandExecutionContext): Promise<void> {
  const args = ctx.args;
  const ctxMode = (args.context as string | undefined) === "continue" ? "continue" : "fork";
  const targetThreadId = args.threadId as string | undefined;
  const msgContent = (args.msg as string | undefined) ?? "";

  if (ctxMode === "fork") {
    const subThreadName = (args.title as string | undefined) ?? (msgContent.slice(0, 40) || "thread");
    const parentId = targetThreadId ?? ctx.threadId;
    const parentNode = ctx.tree.getNode(parentId);
    if (!parentNode) {
      const td = ctx.tree.readThreadData(ctx.threadId);
      if (td) {
        td.actions.push({ type: "inject", content: `[错误] think(fork): 指定的 threadId=${parentId} 不存在`, timestamp: Date.now() });
        ctx.tree.writeThreadData(ctx.threadId, td);
      }
      return;
    }

    const child = await ctx.tree.createSubThread(parentId, subThreadName, {
      description: msgContent || (args.description as string | undefined),
      traits: args.traits as string[],
    });
    if (!child) return;
    await ctx.tree.setNodeStatus(child, "running");
    if (msgContent) ctx.tree.writeInbox(child, { from: ctx.objectName, content: msgContent, source: "system" });
    const td = ctx.tree.readThreadData(ctx.threadId);
    if (td) {
      td.actions.push({
        type: "create_thread",
        content: `[think.fork] ${subThreadName} → ${child}${targetThreadId ? ` (under ${targetThreadId})` : ""}`,
        timestamp: Date.now(),
        context: "fork",
      });
      td.actions.push({ type: "inject", content: `[form.submit] think(fork) 成功，thread_id = ${child}`, timestamp: Date.now() });
      ctx.tree.writeThreadData(ctx.threadId, td);
    }
    ctx.scheduler.onThreadCreated(child, ctx.objectName);

    if (args.wait !== undefined && typeof args.wait !== "boolean") {
      const tdWarn = ctx.tree.readThreadData(ctx.threadId);
      if (tdWarn) {
        tdWarn.actions.push({
          type: "inject",
          content: `[警告] 参数 wait 不是 boolean（收到 ${typeof args.wait} 值 "${String(args.wait)}"），将忽略此参数。请使用布尔值 true/false。`,
          timestamp: Date.now(),
        });
        ctx.tree.writeThreadData(ctx.threadId, tdWarn);
      }
    }
    if (args.wait === true) {
      await ctx.tree.awaitThreads(ctx.threadId, [child]);
      await ctx.tree.checkAndWake(ctx.threadId);
      const tdWait = ctx.tree.readThreadData(ctx.threadId);
      if (tdWait) {
        tdWait.actions.push({ type: "inject", content: `[think.fork wait=true] 等待子线程 ${child} 完成`, timestamp: Date.now() });
        ctx.tree.writeThreadData(ctx.threadId, tdWait);
      }
      consola.info(`[Engine] think.fork wait=true: ${subThreadName} → ${child}，父线程等待`);
    } else {
      consola.info(`[Engine] think.fork: ${subThreadName} → ${child}`);
    }
    return;
  }

  if (!targetThreadId) {
    const td = ctx.tree.readThreadData(ctx.threadId);
    if (td) {
      td.actions.push({ type: "inject", content: `[错误] think(context="continue") 必须同时指定 threadId 参数`, timestamp: Date.now() });
      ctx.tree.writeThreadData(ctx.threadId, td);
    }
    return;
  }
  ctx.tree.writeInbox(targetThreadId, { from: ctx.objectName, content: msgContent, source: "system" });
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (td) {
    td.actions.push({
      type: "message_out",
      content: `[think.continue] → ${targetThreadId}: ${msgContent}`,
      timestamp: Date.now(),
      context: "continue",
    });
    ctx.tree.writeThreadData(ctx.threadId, td);
  }
  consola.info(`[Engine] think.continue: → ${targetThreadId}`);
}
