import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";

const DO_WINDOW_WAIT_BASIC = "internal/windows/do/wait/basic";
const WAIT_KNOWLEDGE = `
do_window.wait：不向子线程发消息，仅把当前父线程切到 waiting 直到子线程回写。

参数：无
`.trim();

async function executeDoWindowWait(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = ctx.parentWindow?.id;
  return undefined;
}

export const waitCommand: MethodEntry = {
  paths: ["wait"],
  match: () => ["wait"],
  knowledge: (): MethodKnowledgeEntries => ({ [DO_WINDOW_WAIT_BASIC]: WAIT_KNOWLEDGE }),
  exec: (ctx) => executeDoWindowWait(ctx),
};
