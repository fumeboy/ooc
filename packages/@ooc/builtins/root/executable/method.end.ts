import type { MethodExecutionContext, ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import type { ContextWindow, DoWindow, TalkWindow } from "@ooc/core/extendable/_shared/types.js";
import { continueMethod } from "@ooc/core/executable/windows/do/method.continue.js";
import { sayMethod } from "@ooc/core/executable/windows/talk/method.say.js";
import { notifyThreadActivated } from "@ooc/core/observable/index.js";

export enum EndMethodPath {
  End = "end",
}

/** end has no required args; fires directly without a form. */
export const endMethod: ObjectMethod = {
  description: "End the current thread (mark done); optional reason/summary/result to report back to parent.",
  exec: (ctx) => executeEndMethod(ctx),
};

function findCreatorWindow(ctx: MethodExecutionContext): DoWindow | TalkWindow | undefined {
  const list = (ctx.thread?.contextWindows ?? []) as ContextWindow[];
  for (const w of list) {
    if ((w.type === "do" || w.type === "talk") && w.isCreatorWindow === true) {
      return w;
    }
  }
  return undefined;
}

async function autoReplyAndArchiveDo(
  ctx: MethodExecutionContext,
  creator: DoWindow,
  result: string,
): Promise<void> {
  const thread = ctx.thread!;
  const continueCtx: MethodExecutionContext = {
    thread,
    self: creator,
    manager: ctx.manager,
    args: { msg: result },
  };
  const outcome = await continueMethod.exec(continueCtx);
  if (typeof outcome === "string" && outcome.length > 0) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[end.result] 自动 reply 到 creator do_window 失败：${outcome}`,
    });
    return;
  }
  const list = thread.contextWindows as ContextWindow[];
  const idx = list.findIndex((w: ContextWindow) => w.id === creator.id);
  if (idx >= 0) {
    const target = list[idx]!;
    if (target.type === "do") {
      list[idx] = { ...target, status: "archived" };
    }
  }
}

async function autoReplyTalk(
  ctx: MethodExecutionContext,
  creator: TalkWindow,
  result: string,
): Promise<void> {
  const thread = ctx.thread!;
  const sayCtx: MethodExecutionContext = {
    thread,
    self: creator,
    manager: ctx.manager,
    args: { msg: result },
  };
  const outcome = await sayMethod.exec(sayCtx);
  if (typeof outcome === "string" && outcome.length > 0) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[end.result] 自动 reply 到 creator talk_window 失败：${outcome}`,
    });
  }
}

export async function executeEndMethod(ctx: MethodExecutionContext): Promise<string | undefined> {
  if (!ctx.thread) return undefined;

  const reason = typeof ctx.args.reason === "string" ? ctx.args.reason : undefined;
  const summary = typeof ctx.args.summary === "string" ? ctx.args.summary : undefined;
  const result = typeof ctx.args.result === "string" && ctx.args.result.length > 0
    ? ctx.args.result
    : undefined;

  if (result !== undefined) {
    const creator = findCreatorWindow(ctx);
    if (!creator) {
      console.warn(
        `[end.result] thread ${ctx.thread.id} 无 creator window（self-driven root？），result 被忽略：${result.slice(0, 100)}${result.length > 100 ? "..." : ""}`,
      );
      ctx.thread.events.push({
        category: "context_change",
        kind: "inject",
        text: "[end.result] 当前 thread 无 creator window（self-driven root），result 参数被忽略；仅 endSummary 仍会记录。",
      });
    } else if (creator.type === "do") {
      await autoReplyAndArchiveDo(ctx, creator, result);
    } else {
      await autoReplyTalk(ctx, creator, result);
    }
  }

  ctx.thread.endReason = reason;
  ctx.thread.endSummary = summary;
  ctx.thread.status = "done";

  const persistence = ctx.thread.persistence;
  if (persistence) {
    const creator = findCreatorWindow(ctx);
    if (creator) {
      const callerObjectId =
        creator.type === "do" ? persistence.objectId : creator.target;
      const callerThreadId =
        creator.type === "do" ? (creator as DoWindow).targetThreadId : (creator as TalkWindow).targetThreadId;
      const callerSessionId = ctx.thread.creatorSessionId ?? persistence.sessionId;
      if (callerObjectId && callerThreadId && callerObjectId !== "user") {
        notifyThreadActivated({
          sessionId: callerSessionId,
          objectId: callerObjectId,
          threadId: callerThreadId,
        });
      }
    }
  }
  return undefined;
}
