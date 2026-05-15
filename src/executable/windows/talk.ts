/**
 * talk_window — 与另一个 flow object 的某条 thread 持续会话。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：
 * - 注册的 command：say / wait / close
 * - say：通过 talk-delivery 把消息派送到 target object 的 callee thread；同时记入本 thread.outbox
 * - wait：父线程进 status=waiting + inboxSnapshotAtWait 写入
 * - close：onClose 拒绝关闭 creator talk_window（与 caller 的恒在通道）；其他 talk_window 释放即可
 * - 视图：transcript 按 outbox.windowId === self.id || inbox.replyToWindowId === self.id 过滤
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "./command-types.js";
import { registerWindowType, type OnCloseContext } from "./registry.js";
import { deliverTalkMessage } from "./talk-delivery.js";

const TALK_WINDOW_SAY_BASIC = "internal/windows/talk/say/basic";
const TALK_WINDOW_SAY_INPUT = "internal/windows/talk/say/input";
const TALK_WINDOW_WAIT_BASIC = "internal/windows/talk/wait/basic";
const TALK_WINDOW_CLOSE_BASIC = "internal/windows/talk/close/basic";

const SAY_KNOWLEDGE = `
talk_window.say 用于向 talk 对端发送一条消息。

参数：
- msg: 必填，消息正文
- wait: 可选，true 时父线程进入 status="waiting"，等对端回复进 inbox 唤醒

行为：
- 消息追加到当前 thread.outbox（source=talk, windowId=本 window）
- 同时按 target 派送到对端 object 的 callee thread.inbox（首条消息会创建 callee thread）
- 对端 thread 自动进入 running，由 worker 调度

示例：
open(parent_window_id="<talk_window_id>", command="say", title="询问发布时间", args={ msg: "明天可以发布吗？", wait: true })
`.trim();

const WAIT_KNOWLEDGE = `
talk_window.wait：不发消息，仅把当前父线程切到 waiting，等对端下一条回复。

参数：无
`.trim();

const CLOSE_KNOWLEDGE = `
talk_window.close 等价于 close tool；明确表达"结束本对话主题"。

注意：creator talk_window（callee thread 自带的、指向 caller 的那一条）不可关闭，
关闭会被拒绝并写一条 inject 提示。其它 talk_window 关闭后不会通知对端。
`.trim();

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
  // close 副作用统一在 onClose hook，exec 体本身 no-op
  exec: () => undefined,
};

/** talk_window.say：通过 talk-delivery 派送消息到对端，并记入 caller.outbox。 */
export async function executeTalkWindowSay(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.say] 缺少 thread context。";
  const window = ctx.parentWindow;
  if (!window || window.type !== "talk") {
    return "[talk_window.say] 未挂载在 talk_window 上。";
  }
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

/** talk_window 的 onClose hook：creator talk_window 不可关闭。 */
function onCloseTalkWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.type !== "talk") return;
  if (w.isCreatorWindow) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] talk_window "${w.id}" 是初始 creator talk_window，与 caller 的恒在通道，不可关闭。`,
    });
    return false;
  }
  return true;
}

registerWindowType("talk", {
  commands: {
    say: sayCommand,
    wait: waitCommand,
    close: closeCommand,
  },
  onClose: onCloseTalkWindow,
});
