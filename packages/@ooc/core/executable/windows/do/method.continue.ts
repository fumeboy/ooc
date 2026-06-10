import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { MethodCallSchema } from "../../../thinkable/context/intent.js";
import type { DoWindow } from "../_shared/types.js";
import { notifyThreadActivated } from "../../../observable/index.js";
import { appendInbox, findThreadInScope, makeMessage } from "./helpers.js";

const CONTINUE_TIP = `do_window.continue 向对端线程追加消息（父→子或子→父）。
参数：msg（必填）、wait（可选，true 时本 thread 等待回复）。`;

async function executeDoWindowContinue(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  const window = ctx.self as DoWindow;
  const targetThreadId = window.targetThreadId;
  const target = findThreadInScope(thread, targetThreadId);
  if (!target) {
    return `[do_window.continue] 找不到目标线程 ${targetThreadId}。`;
  }

  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[do_window.continue] 缺少 msg。";

  const message = makeMessage(thread.id, targetThreadId, content);
  appendInbox(target, message);
  if (target.status === "done" || target.status === "failed") {
    target.status = "running";
  }
  thread.outbox = [...(thread.outbox ?? []), message];

  if (ctx.args.wait === true) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
    thread.waitingOn = ctx.self?.id;
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

export const continueMethod: ObjectMethod = {
  description: "Send another message to the thread on the other side of this do_window.",
  intents: ["continue.wait"],
  schema: {
    args: {
      msg: { type: "string", required: true, description: "要追加的消息" },
      wait: { type: "boolean", required: false, default: false, description: "true 时本 thread 进入 waiting，等对端回写消息再唤醒" },
    },
  } as MethodCallSchema,
  onFormChange(change, { args }) {
    const intents = args.wait === true ? [{ name: "continue.wait" }] : [{ name: "continue" }];
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    return {
      tip: hasMsg ? "Sending message..." : CONTINUE_TIP,
      intents,
      quick_exec_submit: hasMsg,
    };
  },
  exec: (ctx) => executeDoWindowContinue(ctx),
};
