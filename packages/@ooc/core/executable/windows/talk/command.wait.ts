import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";

const TALK_WINDOW_WAIT_BASIC = "internal/windows/talk/wait/basic";
const WAIT_KNOWLEDGE = `
talk_window.wait：不发消息，仅把当前父线程切到 waiting，等对端下一条回复。

参数：无
`.trim();

async function executeTalkWindowWait(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.wait] 缺少 thread context。";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = ctx.parentWindow?.id;
  return undefined;
}

export const waitCommand: CommandTableEntry = {
  paths: ["wait"],
  match: () => ["wait"],
  knowledge: (): CommandKnowledgeEntries => ({ [TALK_WINDOW_WAIT_BASIC]: WAIT_KNOWLEDGE }),
  exec: (ctx) => executeTalkWindowWait(ctx),
};
