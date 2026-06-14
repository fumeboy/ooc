import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import type { TalkWindow } from "../_shared/types.js";
import { deliverTalkMessage } from "./delivery.js";
import { notifyThreadActivated } from "../../../observable/index.js";
import { appendInbox, findThreadInScope, makeMessage } from "./fork.js";

const SAY_TIP = `talk_window.say 向对端发消息（peer 会话或 fork 子线程双向通道）。
参数：msg（必填）、wait（可选，true 时本 thread 等待回复）。`;

/**
 * fork 子线程窗的 say —— 内存树寻址派送（旧 do_window.continue）。
 *
 * 同 session 同 job、不付磁盘 IO：经 findThreadInScope 在内存 childThreads/_parentThreadRef
 * 树里定位对端（父→子 或 子→父），直接写其 inbox + 自己 outbox。
 */
async function sayToForkWindow(ctx: MethodExecutionContext, window: TalkWindow): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  const targetThreadId = window.targetThreadId;
  if (!targetThreadId) return "[talk_window.say] fork 子线程窗缺少 targetThreadId。";
  const target = findThreadInScope(thread, targetThreadId);
  if (!target) {
    return `[talk_window.say] 找不到目标线程 ${targetThreadId}。`;
  }

  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[talk_window.say] 缺少 msg。";

  const message = makeMessage(thread.id, targetThreadId, content);
  appendInbox(target, message);
  if (target.status === "done" || target.status === "failed") {
    target.status = "running";
  }
  thread.outbox = [...(thread.outbox ?? []), message];

  if (ctx.args.wait === true) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
    thread.waitingOn = window.id;
  }

  if (target.persistence) {
    notifyThreadActivated({
      sessionId: target.persistence.sessionId,
      objectId: target.persistence.objectId,
      threadId: target.id,
    });
  }
  return undefined;
}

/** peer 会话窗的 say —— talk-delivery 磁盘派送（跨对象）。 */
async function sayToPeerWindow(ctx: MethodExecutionContext, window: TalkWindow): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.say] 缺少 thread context。";
  if (!thread.persistence) {
    return "[talk_window.say] 当前 thread 无 persistence ref，无法跨对象派送。";
  }
  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[talk_window.say] 缺少 msg。";

  try {
    await deliverTalkMessage({
      caller: { thread, talkWindow: window },
      content,
      source: "talk",
    });
  } catch (err) {
    return `[talk_window.say] 派送失败：${(err as Error).message}`;
  }

  if (ctx.args.wait === true) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
    thread.waitingOn = window.id;
  }
  return undefined;
}

async function executeTalkWindowSay(ctx: MethodExecutionContext): Promise<string | undefined> {
  const window = ctx.self as TalkWindow;
  // fork 子线程窗（同对象父子通道）走内存树派送；peer 会话窗走磁盘 talk-delivery。
  return window.isForkWindow
    ? sayToForkWindow(ctx, window)
    : sayToPeerWindow(ctx, window);
}

export const sayMethod: ObjectMethod = {
  description: "Send a message to the other side of this talk_window — peer object, or the forked child/parent thread (set wait=true to block until they reply).",
  intents: ["say.wait"],
  schema: {
    args: {
      msg: { type: "string", required: true, description: "消息正文" },
      wait: { type: "boolean", required: false, default: false, description: "true 时等待回复" },
    },
  } as MethodCallSchema,
  onFormChange(change, { args }) {
    const intents = args.wait === true ? [{ name: "say.wait" }] : [{ name: "say" }];
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    return {
      tip: hasMsg ? "Sending message..." : SAY_TIP,
      intents,
      quick_exec_submit: hasMsg,
    };
  },
  exec: (ctx) => executeTalkWindowSay(ctx),
};
