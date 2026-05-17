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

/**
 * talk_window 的 type-level basicKnowledge。
 *
 * 通过 registerWindowType 注入；只要 thread.contextWindows 里出现至少一个 talk_window，
 * 全局基础知识合成阶段就会把这段文本作为一个 protocol KnowledgeWindow 注入到 context，
 * 让 LLM 在还没 open 任何 say/wait form 时就知道 talk_window 的命令面与典型用法。
 */
const TALK_WINDOW_BASIC_KNOWLEDGE = `
talk_window 是与一个对端 flow object 的持续会话窗口。它注册的 command 不在 root 上，
要通过 open(parent_window_id="<talk_window_id>", command="...", args={...}) 调用：

| command | 作用 | 典型用法 |
|---------|------|----------|
| say     | 发一条消息给对端，并可选地把本线程切到 waiting | open(parent_window_id="<talk_window_id>", command="say", args={ msg: "...", wait: true|false }) |
| wait    | 不发消息、仅切到 waiting 等下一条 inbox        | open(parent_window_id="<talk_window_id>", command="wait") |
| close   | 结束本对话主题                                  | close(window_id="<talk_window_id>", reason="...") |

**关键提醒**：
- talk_window **不接受** root 级别的 \`talk\` command；那是用来"创建新 talk_window"的，不是发消息
- 想发消息只用 \`say\`；想等回信用 \`wait\`；想结束对话用 \`close\`
- 同一个对端复用同一个 talk_window，不要每发一条消息就 close 再重开
- creator talk_window（isCreatorWindow=true）= 创建本 thread 的对端给你的回信通道；
  收到 inbox 消息后回复就走它的 \`say\`，不要 open 新的 talk
`.trim();

const SAY_KNOWLEDGE = `
talk_window.say 用于向 talk 对端发送一条消息。

参数：
- msg: 必填，消息正文
- wait: 可选，true 时父线程进入 status="waiting"，等对端回复进 inbox 唤醒

行为：
- 消息追加到当前 thread.outbox（source=talk, windowId=本 window）
- 同时按 target 派送到对端 object 的 callee thread.inbox（首条消息会创建 callee thread）
- 对端 thread 自动进入 running，由 worker 调度

推荐用法（一步到位，args 给齐时 open 立即提交 form）：
  open(parent_window_id="<talk_window_id>", command="say", title="询问发布时间",
       args={ msg: "明天可以发布吗？", wait: true })

如果选择分步（先 open 不带 args，再 refine，再 submit）：
  1) open(parent_window_id="<talk_window_id>", command="say", title="...")
     → 返回 form_id，比如 f_abc123
  2) refine(form_id="f_abc123", args={ msg: "Hi! How can I help?", wait: false })
     —— **必须带 args 字段且非空**；空 refine 会被拒绝
  3) submit(form_id="f_abc123")

注意：refine 不带 args 等价于啥都没填；submit 时 say 会因为缺少 msg 而失败。要么在 open
时一步给齐，要么 refine 时把要累积的键值对显式列出来。
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
    // say 完顺手 wait —— 等的就是这个 talk_window 上的回信；spec 2026-05-17 § 5
    thread.waitingOn = window.id;
  }
  return undefined;
}

/** talk_window.wait：仅置 waiting；不发消息。 */
export async function executeTalkWindowWait(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.wait] 缺少 thread context。";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = ctx.parentWindow?.id;
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
  basicKnowledge: TALK_WINDOW_BASIC_KNOWLEDGE,
});
