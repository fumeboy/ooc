import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import type { TalkWindow } from "../_shared/types.js";
import { deliverTalkMessage } from "./delivery.js";

const SAY_TIP = `talk_window.say 向对端发消息。
参数：msg（必填）、wait（可选，true 时本 thread 等待回复）。`;

async function executeTalkWindowSay(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.say] 缺少 thread context。";
  const window = ctx.self as TalkWindow;
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

export const sayMethod: ObjectMethod = {
  description: "Send a message to the peer on the other side of this talk_window (set wait=true to block until the peer replies).",
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
