import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";

async function executeTalkWindowWait(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.wait] 缺少 thread context。";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = ctx.self?.id;
  return undefined;
}

export const waitMethod: ObjectMethod = {
  description: "Put this thread into waiting until the peer sends the next message.",
  exec: (ctx) => executeTalkWindowWait(ctx),
};
