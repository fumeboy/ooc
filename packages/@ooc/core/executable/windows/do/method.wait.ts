import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";

async function executeDoWindowWait(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = ctx.self?.id;
  return undefined;
}

export const waitMethod: ObjectMethod = {
  description: "Put this thread into waiting until the peer thread writes back.",
  exec: (ctx) => executeDoWindowWait(ctx),
};
