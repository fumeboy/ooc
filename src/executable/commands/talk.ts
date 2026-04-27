import { consola } from "consola";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const talkCommand: CommandTableEntry = {
  paths: [
    "talk", "talk.fork", "talk.continue", "talk.new", "talk.wait",
    "talk.relation_update", "talk.question_form",
    "talk.continue.relation_update", "talk.continue.question_form",
  ],
  match: (args) => {
    const hit: string[] = ["talk"];
    const ctx = typeof args.context === "string" ? args.context : "";
    const type = typeof args.type === "string" ? args.type : "";
    if (args.wait === true) hit.push("talk.wait");
    if (ctx === "fork") hit.push("talk.fork");
    if (ctx === "continue") hit.push("talk.continue");
    if (ctx === "new") hit.push("talk.new");
    if (type === "relation_update") {
      hit.push("talk.relation_update");
      if (ctx === "continue") hit.push("talk.continue.relation_update");
    }
    if (type === "question_form") {
      hit.push("talk.question_form");
      if (ctx === "continue") hit.push("talk.continue.question_form");
    }
    return hit;
  },
  openable: true,
};

export async function executeTalkCommand(ctx: CommandExecutionContext): Promise<void> {
  if (!ctx.onTalk) return;
  const args = ctx.args;
  const target = (args.target as string)?.toLowerCase();
  if (!target || target === ctx.objectName.toLowerCase()) return;

  const ctxMode = (args.context as string | undefined) === "continue" ? "continue" : "fork";
  const remoteThreadIdArg = args.threadId as string | undefined;
  const msgContent = (args.msg as string | undefined) ?? (args.message as string | undefined) ?? "";
  if (ctxMode === "continue" && !remoteThreadIdArg) {
    const td = ctx.tree.readThreadData(ctx.threadId);
    if (td) {
      td.actions.push({ type: "inject", content: `[错误] talk(context="continue") 必须同时指定 threadId 参数`, timestamp: Date.now() });
      ctx.tree.writeThreadData(ctx.threadId, td);
    }
    return;
  }

  const forkUnderThreadId = ctxMode === "fork" ? remoteThreadIdArg : undefined;
  const continueThreadId = ctxMode === "continue" ? remoteThreadIdArg : undefined;
  const messageId = ctx.genMessageOutId();
  const formPayload = ctx.extractTalkForm(args.form);
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (td) {
    const modeLabel = ` [${ctxMode}${remoteThreadIdArg ? `:${remoteThreadIdArg}` : ""}]`;
    const formLabel = formPayload ? ` [form: ${formPayload.formId}]` : "";
    td.actions.push({
      id: messageId,
      type: "message_out",
      content: `[talk] → ${args.target}: ${msgContent}${modeLabel}${formLabel}`,
      timestamp: Date.now(),
      context: ctxMode,
      ...(formPayload ? { form: formPayload } : {}),
    });
    ctx.tree.writeThreadData(ctx.threadId, td);
  }

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

  const isWaitMode = args.wait === true;
  const isTalkSyncToUser = isWaitMode && target === "user";
  if (isTalkSyncToUser) {
    consola.warn(`[Engine] ${ctx.objectName} 尝试 talk(wait=true, target="user")——user 不参与 ThinkLoop，不会回复。已降级为普通 talk（不阻塞）。`);
  }
  const explicitlyMarked = Array.isArray(args.mark) && args.mark.length > 0;
  const talkType = typeof args.type === "string" ? args.type : undefined;
  const messageKind = ctxMode === "continue" && talkType === "relation_update"
    ? "relation_update_request"
    : undefined;
  try {
    const { reply, remoteThreadId } = await ctx.onTalk(
      args.target as string,
      msgContent,
      ctx.objectName,
      ctx.threadId,
      ctx.sessionId,
      continueThreadId,
      messageId,
      forkUnderThreadId,
      messageKind,
    );
    if (!explicitlyMarked) {
      const tdAck = ctx.tree.readThreadData(ctx.threadId);
      const autoAckId = ctx.getAutoAckMessageId(tdAck, args.target as string);
      if (autoAckId) ctx.tree.markInbox(ctx.threadId, autoAckId, "ack", "已回复");
    }
    if (reply) {
      ctx.tree.writeInbox(ctx.threadId, { from: args.target as string, content: `${reply}\n[remote_thread_id: ${remoteThreadId}]`, source: "talk" });
    }
    const td2 = ctx.tree.readThreadData(ctx.threadId);
    if (td2) {
      td2.actions.push({ type: "inject", content: `[talk → ${args.target}] remote_thread_id = ${remoteThreadId}`, timestamp: Date.now() });
      ctx.tree.writeThreadData(ctx.threadId, td2);
    }
  } catch (e) {
    ctx.tree.writeInbox(ctx.threadId, { from: "system", content: `[talk 失败] ${(e as Error).message}`, source: "system" });
  }
  if (isWaitMode && !isTalkSyncToUser) ctx.tree.setNodeStatus(ctx.threadId, "waiting", "talk_sync");
}
