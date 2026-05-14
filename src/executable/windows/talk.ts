/**
 * talk_window — 与外部 target（当前阶段仅 user）的会话窗口。
 *
 * spec § talk_window：
 * - target=user，conversationId=windowId
 * - 注册的 command：say / wait / close
 * - say：写 thread.outbox（source="talk", windowId=本 window）
 * - wait：父线程进 status=waiting + inboxSnapshotAtWait 写入
 * - close：仅释放 window；user 端无对应运行实体
 * - 视图过滤（在 render 层）：outbox.windowId === self.id || inbox.replyToWindowId === self.id
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../commands/types.js";
import type { ThreadContext, ThreadMessage } from "../../thinkable/context.js";
import { registerWindowType, type OnCloseContext } from "./registry.js";

const TALK_WINDOW_SAY_BASIC = "internal/windows/talk/say/basic";
const TALK_WINDOW_SAY_INPUT = "internal/windows/talk/say/input";
const TALK_WINDOW_WAIT_BASIC = "internal/windows/talk/wait/basic";
const TALK_WINDOW_CLOSE_BASIC = "internal/windows/talk/close/basic";

const SAY_KNOWLEDGE = `
talk_window.say 用于向 talk 对端发送一条消息。

参数：
- msg: 必填，消息正文
- wait: 可选，true 时父线程进入 status="waiting"，等对端回复进 inbox 唤醒

示例：
open(parent_window_id="<talk_window_id>", command="say", title="询问发布时间", args={ msg: "明天可以发布吗？", wait: true })
`.trim();

const WAIT_KNOWLEDGE = `
talk_window.wait：不发消息，仅把当前父线程切到 waiting，等对端下一条回复。

参数：无
`.trim();

const CLOSE_KNOWLEDGE = `
talk_window.close 等价于 close tool；明确表达"结束本对话主题"。

不会通知对端；user 端无对应运行实体。
`.trim();

function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeTalkMessage(
  fromThreadId: string,
  toThreadId: string,
  content: string,
  windowId: string,
): ThreadMessage {
  return {
    id: generateMessageId(),
    fromThreadId,
    toThreadId,
    content,
    createdAt: Date.now(),
    source: "talk",
    windowId,
  };
}

const sayCommand: CommandTableEntry = {
  paths: ["say", "say.wait"],
  match: (args) => {
    const hit = ["say"];
    if (args.wait === true) hit.push("say.wait");
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [TALK_WINDOW_SAY_BASIC]: SAY_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.msg !== "string" || args.msg.trim().length === 0) {
      entries[TALK_WINDOW_SAY_INPUT] =
        "talk_window.say 需要 msg；用 refine(args={ msg: \"...\", wait: true|false })。";
    }
    return entries;
  },
  exec: (ctx) => executeTalkWindowSay(ctx),
};

const waitCommand: CommandTableEntry = {
  paths: ["wait"],
  match: () => ["wait"],
  knowledge: (): CommandKnowledgeEntries => ({ [TALK_WINDOW_WAIT_BASIC]: WAIT_KNOWLEDGE }),
  exec: (ctx) => executeTalkWindowWait(ctx),
};

const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [TALK_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  // close 副作用统一在 onClose hook（释放 window）；exec 体本身 no-op
  exec: () => undefined,
};

/** talk_window.say：写 thread.outbox 一条 source="talk" 消息。 */
export async function executeTalkWindowSay(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.say] 缺少 thread context。";
  const window = ctx.parentWindow;
  if (!window || window.type !== "talk") {
    return "[talk_window.say] 未挂载在 talk_window 上。";
  }
  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[talk_window.say] 缺少 msg。";

  // user 没有 thread id；用约定值 "user" 作为 toThreadId
  const message = makeTalkMessage(thread.id, "user", content, window.id);
  thread.outbox = [...(thread.outbox ?? []), message];

  if (ctx.args.wait === true) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  }
  return undefined;
}

/** talk_window.wait：仅置 waiting；不发消息。 */
export async function executeTalkWindowWait(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.wait] 缺少 thread context。";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  return undefined;
}

/** talk_window 的 onClose hook：仅释放 window；不影响 user 端。 */
function onCloseTalkWindow(_ctx: OnCloseContext): boolean | void {
  return true;
}

void function ensureThreadType(_thread: ThreadContext): void {
  /* 仅为类型导入，避免 "ThreadContext is declared but never used"。 */
};

registerWindowType("talk", {
  commands: {
    say: sayCommand,
    wait: waitCommand,
    close: closeCommand,
  },
  onClose: onCloseTalkWindow,
});
