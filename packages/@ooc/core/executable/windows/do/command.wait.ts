import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";

const DO_WINDOW_WAIT_BASIC = "internal/windows/do/wait/basic";
const WAIT_KNOWLEDGE = `
do_window.wait：不向子线程发消息，仅把当前父线程切到 waiting 直到子线程回写。

参数：无
`.trim();

async function executeDoWindowWait(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = ctx.self?.id;
  return undefined;
}

export const waitCommand: CommandTableEntry = {
  paths: ["wait"],
  match: () => ["wait"],
  knowledge: (): CommandKnowledgeEntries => ({ [DO_WINDOW_WAIT_BASIC]: WAIT_KNOWLEDGE }),
  exec: (ctx) => executeDoWindowWait(ctx),
};
