import { consola } from "consola";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const doCommand: CommandTableEntry = {
  paths: ["do", "do.fork", "do.continue", "do.wait"],
  match: (args) => {
    const hit: string[] = ["do"];
    const ctx = typeof args.context === "string" ? args.context : "";
    if (args.wait === true) hit.push("do.wait");
    if (ctx === "fork") hit.push("do.fork");
    if (ctx === "continue") hit.push("do.continue");
    return hit;
  },
  openable: true,
};

export async function executeDoCommand(ctx: CommandExecutionContext): Promise<void> {
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
        td.events.push({ type: "inject", content: `[错误] do(fork): 指定的 threadId=${parentId} 不存在`, timestamp: Date.now() });
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
      td.events.push({
        type: "create_thread",
        content: `[do.fork] ${subThreadName} → ${child}${targetThreadId ? ` (under ${targetThreadId})` : ""}`,
        timestamp: Date.now(),
        context: "fork",
      });
      td.events.push({ type: "inject", content: `[form.submit] do(fork) 成功，thread_id = ${child}`, timestamp: Date.now() });
      ctx.tree.writeThreadData(ctx.threadId, td);
    }
    ctx.scheduler.onThreadCreated(child, ctx.objectName);

    if (args.wait !== undefined && typeof args.wait !== "boolean") {
      const tdWarn = ctx.tree.readThreadData(ctx.threadId);
      if (tdWarn) {
        tdWarn.events.push({
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
        tdWait.events.push({ type: "inject", content: `[do.fork wait=true] 等待子线程 ${child} 完成`, timestamp: Date.now() });
        ctx.tree.writeThreadData(ctx.threadId, tdWait);
      }
      consola.info(`[Engine] do.fork wait=true: ${subThreadName} → ${child}，父线程等待`);
    } else {
      consola.info(`[Engine] do.fork: ${subThreadName} → ${child}`);
    }
    return;
  }

  if (!targetThreadId) {
    const td = ctx.tree.readThreadData(ctx.threadId);
    if (td) {
      td.events.push({ type: "inject", content: `[错误] do(context="continue") 必须同时指定 threadId 参数`, timestamp: Date.now() });
      ctx.tree.writeThreadData(ctx.threadId, td);
    }
    return;
  }
  ctx.tree.writeInbox(targetThreadId, { from: ctx.objectName, content: msgContent, source: "system" });
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (td) {
    td.events.push({
      type: "message_out",
      content: `[do.continue] → ${targetThreadId}: ${msgContent}`,
      timestamp: Date.now(),
      context: "continue",
    });
    ctx.tree.writeThreadData(ctx.threadId, td);
  }
  consola.info(`[Engine] do.continue: → ${targetThreadId}`);
}
