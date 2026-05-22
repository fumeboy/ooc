import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import { appendInbox, findChild, makeMessage } from "./helpers.js";

const DO_WINDOW_CONTINUE_BASIC = "internal/windows/do/continue/basic";
const DO_WINDOW_CONTINUE_INPUT = "internal/windows/do/continue/input";

const CONTINUE_KNOWLEDGE = `
do_window.continue 用于向 do_window 关联的子线程追加消息。

参数：
- msg: 必填，要追加的消息
- wait: 可选，true 时父线程进入 waiting，等子线程回写消息再唤醒

示例：
open(parent_window_id="<do_window_id>", command="continue", title="追加任务", args={ msg: "再处理一批", wait: true })
`.trim();

async function executeDoWindowContinue(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  const window = ctx.parentWindow;
  if (!window || window.type !== "do") {
    return "[do_window.continue] 未挂载在 do_window 上，无法执行。";
  }
  const targetThreadId = window.targetThreadId;
  const target = findChild(thread, targetThreadId);
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
    thread.waitingOn = ctx.parentWindow?.id;
  }
  return undefined;
}

export const continueCommand: CommandTableEntry = {
  paths: ["continue", "continue.wait"],
  match: (args) => {
    const hit = ["continue"];
    if (args.wait === true) hit.push("continue.wait");
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [DO_WINDOW_CONTINUE_BASIC]: CONTINUE_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.msg !== "string" || args.msg.trim().length === 0) {
      entries[DO_WINDOW_CONTINUE_INPUT] = "do_window.continue 需要 msg；用 refine(args={ msg: \"...\", wait: true|false })。";
    }
    return entries;
  },
  exec: (ctx) => executeDoWindowContinue(ctx),
};
