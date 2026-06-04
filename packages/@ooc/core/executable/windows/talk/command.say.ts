import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/command-types.js";
import type { Intent, MethodCallSchema } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../_shared/types.js";
import type { MethodExecWindow } from "../method_exec/types.js";
import type { TalkWindow } from "../_shared/types.js";
import { deliverTalkMessage } from "./delivery.js";

const TALK_WINDOW_SAY_BASIC = "internal/windows/talk/say/basic";
const TALK_WINDOW_SAY_INPUT = "internal/windows/talk/say/input";

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

function guidanceWindows(form: MethodExecWindow, entries: Record<string, string>): ContextWindow[] {
  const out: ContextWindow[] = [];
  for (const [path, text] of Object.entries(entries)) {
    const safe = path.replace(/[^a-zA-Z0-9_]/g, "_");
    out.push({
      id: "guidance_" + form.id + "_" + safe,
      type: "guidance",
      parentWindowId: form.id,
      boundFormId: form.id,
      title: path,
      status: "open",
      createdAt: 0,
      relevance: { score: 0.8, signalCount: 1 },
      provenance: {
        kind: "derived",
        reason: { mechanism: "form_bound", sourceId: form.command },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

async function executeTalkWindowSay(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk_window.say] 缺少 thread context。";
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "talk"，method 体不再 re-check。
  const window = ctx.self as TalkWindow;
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
    thread.waitingOn = window.id;
  }
  return undefined;
}

export const sayCommand: ObjectMethod = {
  paths: ["say", "say.wait"],
  schema: {
    args: {
      msg: { type: "string", required: true, description: "消息正文" },
      wait: { type: "boolean", required: false, default: false, description: "true 时父线程进入 waiting，等对端回复进 inbox 唤醒" },
    },
  } as MethodCallSchema,
  intent: (args): Intent[] => {
    const hit: Intent[] = [];
    if (args.wait === true) hit.push({ name: "say.wait" });
    return hit;
  },
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : form.accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [TALK_WINDOW_SAY_BASIC]: SAY_KNOWLEDGE };
    if (formStatus === "open" && (typeof args.msg !== "string" || args.msg.trim().length === 0)) {
      entries[TALK_WINDOW_SAY_INPUT] =
        "talk_window.say 需要 msg；用 refine(args={ msg: \"...\", wait: true|false })。";
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeTalkWindowSay(ctx),
};
