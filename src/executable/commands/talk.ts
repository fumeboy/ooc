import { consola } from "consola";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export enum TalkCommandPath {
  /** 基础 talk 指令：向目标对象发送消息。 */
  Talk = "talk",
  /** fork 模式：在指定线程下创建新的子线程进行对话。 */
  Fork = "talk.fork",
  /** continue 模式：继续已有远端线程进行对话。 */
  Continue = "talk.continue",
  /** new 模式：显式发起新的 talk 线程。 */
  New = "talk.new",
  /** wait 模式：等待目标对象同步回复。 */
  Wait = "talk.wait",
  /** 关系更新请求：通知对方处理关系信息变更。 */
  RelationUpdate = "talk.relation_update",
  /** 结构化问题表单：随 talk 消息携带可交互表单。 */
  QuestionForm = "talk.question_form",
  /** continue 模式下的关系更新请求。 */
  ContinueRelationUpdate = "talk.continue.relation_update",
  /** continue 模式下的结构化问题表单。 */
  ContinueQuestionForm = "talk.continue.question_form",
}

export const talkCommand: CommandTableEntry = {
  paths: [
    TalkCommandPath.Talk,
    TalkCommandPath.Fork,
    TalkCommandPath.Continue,
    TalkCommandPath.New,
    TalkCommandPath.Wait,
    TalkCommandPath.RelationUpdate,
    TalkCommandPath.QuestionForm,
    TalkCommandPath.ContinueRelationUpdate,
    TalkCommandPath.ContinueQuestionForm,
  ],
  match: (args) => {
    const hit: string[] = [TalkCommandPath.Talk];
    const ctx = typeof args.context === "string" ? args.context : "";
    const type = typeof args.type === "string" ? args.type : "";
    if (args.wait === true) hit.push(TalkCommandPath.Wait);
    if (ctx === "fork") hit.push(TalkCommandPath.Fork);
    if (ctx === "continue") hit.push(TalkCommandPath.Continue);
    if (ctx === "new") hit.push(TalkCommandPath.New);
    if (type === "relation_update") {
      hit.push(TalkCommandPath.RelationUpdate);
      if (ctx === "continue") hit.push(TalkCommandPath.ContinueRelationUpdate);
    }
    if (type === "question_form") {
      hit.push(TalkCommandPath.QuestionForm);
      if (ctx === "continue") hit.push(TalkCommandPath.ContinueQuestionForm);
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
      td.events.push({ type: "inject", content: `[错误] talk(context="continue") 必须同时指定 threadId 参数`, timestamp: Date.now() });
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
    td.events.push({
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
      tdWarn.events.push({
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
  if (isWaitMode && !isTalkSyncToUser) {
    await ctx.tree.setNodeStatus(ctx.threadId, "waiting", "talk_sync");
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
      td2.events.push({ type: "inject", content: `[talk → ${args.target}] remote_thread_id = ${remoteThreadId}`, timestamp: Date.now() });
      ctx.tree.writeThreadData(ctx.threadId, td2);
    }
  } catch (e) {
    ctx.tree.writeInbox(ctx.threadId, { from: "system", content: `[talk 失败] ${(e as Error).message}`, source: "system" });
  }
}
