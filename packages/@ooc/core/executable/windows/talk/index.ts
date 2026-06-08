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

import { builtinRegistry, type OnCloseContext, type RenderContext } from "../_shared/registry.js";
import type { ObjectMethod } from "../_shared/command-types.js";
import type { Intent, MethodCallSchema } from "../../../thinkable/context/intent.js";
import { stat } from "node:fs/promises";
import { stoneDir } from "../../../persistable/index.js";
import { SUPER_ALIAS_TARGET } from "../_shared/super-constants.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ContextWindow,
} from "../_shared/types.js";
import type { MethodExecWindow } from "../method_exec/types.js";
import type { BaseContextWindow } from "@ooc/core/_shared";
import { sayCommand } from "./command.say.js";
import { waitCommand } from "./command.wait.js";
import { closeCommand } from "./command.close.js";
import { setTranscriptWindowCommandForTalk } from "./command.set-transcript-window.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  applyTranscriptViewport,
  type TranscriptViewport,
} from "../_shared/transcript-viewport.js";
import { xmlElement, xmlText, type XmlNode } from "../../../thinkable/context/xml.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { TalkWindow } from "./types.js";

/**
 * talk_window 的视图过滤（R3 #15）：
 * - outbox 上 windowId === self.id（self 在该 window say 时打的标记）
 * - inbox 上 replyToWindowId === self.id（对端回信的路由标记）
 *
 * spec § ThreadMessage 字段扩展。
 */
export function filterMessagesForTalkWindow(window: TalkWindow, thread: ThreadContext): ThreadMessage[] {
  const messages: ThreadMessage[] = [];
  for (const m of thread.outbox ?? []) {
    if (m.windowId === window.id) messages.push(m);
  }
  for (const m of thread.inbox ?? []) {
    if (m.replyToWindowId === window.id) messages.push(m);
  }
  messages.sort((a, b) => a.createdAt - b.createdAt);
  return messages;
}

/** talk_window 的 renderXml hook：target + transcript（按 windowId / replyToWindowId 过滤）。 */
function renderTalkWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as TalkWindow;
  const children: XmlNode[] = [
    xmlElement("target", {}, [xmlText(window.target)]),
    xmlElement("conversation_id", {}, [xmlText(window.conversationId)]),
  ];
  // 与 do_window 渲染对齐：creator talk_window 必须暴露 is_creator_window=true，
  // 否则 LLM 无法识别"哪条 talk 是创建本 thread 的对端通道"。
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  const messages = filterMessagesForTalkWindow(window, ctx.thread);
  // 展示状态从 window.state 读，向后兼容旧平铺字段。
  const viewport: TranscriptViewport =
    window.state?.transcriptViewport ?? window.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT;
  const { visible, earlierCount } = applyTranscriptViewport(messages, viewport);

  // 始终暴露 viewport 元数据节点（让 LLM 知道当前渲染窗口 + 是否有省略）
  const viewportAttrs: Record<string, string> = { total: String(messages.length) };
  if (typeof viewport.tail === "number") {
    viewportAttrs.tail = String(viewport.tail);
  } else if (
    typeof viewport.rangeStart === "number" &&
    typeof viewport.rangeEnd === "number"
  ) {
    viewportAttrs.range_start = String(viewport.rangeStart);
    viewportAttrs.range_end = String(viewport.rangeEnd);
  }
  if (earlierCount > 0) {
    viewportAttrs.earlier_omitted = String(earlierCount);
  }
  children.push(xmlElement("transcript_viewport", viewportAttrs));

  if (visible.length > 0) {
    children.push(
      xmlElement(
        "transcript",
        {},
        visible.map((m) =>
          xmlElement("message", { id: m.id, source: m.source }, [
            xmlElement("from_thread_id", {}, [xmlText(m.fromThreadId)]),
            xmlElement("to_thread_id", {}, [xmlText(m.toThreadId)]),
            xmlElement("content", {}, [xmlText(m.content)]),
          ]),
        ),
      ),
    );
  }
  return children;
}

/**
 * talk_window 的 type-level basicKnowledge。
 *
 * 通过 registerObjectType 注入；只要 thread.contextWindows 里出现至少一个 talk_window，
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

## 关系记录（relation）

你对每个 peer 的长期认知请写到 \`pools/<self>/knowledge/relations/<peer>.md\`
（普通 markdown，一个 peer 一份）。每当 thread 里存在指向某 peer 的 talk_window 时，
系统会自动在 context 注入两条 knowledge:
- \`stones/<peer>/readable.md\` —— peer 公开自述
- \`pools/<self>/knowledge/relations/<peer>.md\` —— 你对该 peer 的认知

如果你**还没**对该 peer 写过 relation，第二条会显示一段占位提示，告诉你按上述
路径写入。形成新认知后通过 \`open(command="write_file", path="pools/<self>/knowledge/relations/<peer>.md", content="...")\`
（或 \`open(command="open_file") + edit\` 增量更新）即可。下次再与该 peer 对话时，
文件会自动作为 knowledge 出现在你的 context。
`.trim();

const TALK_RECENT_COUNT = 2;
const TALK_MESSAGE_TRUNCATE = 200;

/**
 * talk_window 的 compressView hook（design §4.1）。
 *
 * - Level 1 (folded):  peer + total_messages + 最近 2 条消息(各截断到 200 字)
 * - Level 2 (snapshot): peer + total_messages
 *
 * peer 取 window.target(目标 flow object id;"user" 也算合法 peer)。
 */
function compressTalkWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const window = ctx.window as TalkWindow;
  const messages = filterMessagesForTalkWindow(window, ctx.thread);
  const children: XmlNode[] = [
    xmlElement("peer", {}, [xmlText(window.target)]),
    xmlElement("total_messages", {}, [xmlText(String(messages.length))]),
  ];
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  if (level === 1 && messages.length > 0) {
    const recent = messages.slice(-TALK_RECENT_COUNT);
    children.push(
      xmlElement(
        "recent_messages",
        { count: String(recent.length) },
        recent.map((m) =>
          xmlElement(
            "message",
            { id: m.id, source: m.source },
            [
              xmlElement("from_thread_id", {}, [xmlText(m.fromThreadId)]),
              xmlElement("to_thread_id", {}, [xmlText(m.toThreadId)]),
              xmlElement("content", {}, [
                xmlText(m.content.slice(0, TALK_MESSAGE_TRUNCATE)),
              ]),
            ],
          ),
        ),
      ),
    );
  }
  children.push(
    xmlElement("compressed", {
      level: String(level),
      hint: "exec(window_id, 'expand') to restore",
    }),
  );
  return children;
}

/** talk_window 的 onClose hook：creator talk_window 不可关闭。 */
function onCloseTalkWindow(ctx: OnCloseContext): boolean | void {
  if (ctx.window.type !== "talk") return;
  // batch C narrowing(N1): ctx.window 契约层是 base ContextWindow；type==="talk" 守卫后 narrow 回 TalkWindow 读 isCreatorWindow。
  const w = ctx.window as TalkWindow;
  if (w.isCreatorWindow) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] talk_window "${w.id}" 是初始 creator talk_window，与 caller 的恒在通道，不可关闭。`,
      source: "executable/windows/talk#onCloseTalkWindow",
      errorCode: "creator_talk_window_close_rejected",
    });
    return false;
  }
  return true;
}

// ─────────────────────────── constructor (P6.§4-§5) ──────────────────────────

const TALK_CONSTRUCTOR_BASIC = "internal/objects/talk/constructor/basic";
const TALK_CONSTRUCTOR_INPUT = "internal/objects/talk/constructor/input";

const TALK_CONSTRUCTOR_KNOWLEDGE = `
talk 用于开启一个对外的会话窗口（talk_window），与另一个 flow object 持续会话。

参数：
- target: 必填，目标 flow object 的 objectId（"user" 也是一个 flow object）
- title: 必填，本会话的简短主题（同一 caller 多窗口区分用）

submit 后副作用：
- 在 thread.contextWindows 下挂一个 type=talk 的 window（初始 targetThreadId 为空）
- 首次发消息：open(parent_window_id="<talk_window_id>", command="say", args={ msg: "...", wait: true|false })
  - 若 callee thread 尚未存在，系统会在 flows/{sid}/objects/{target}/threads/ 下创建一条
  - 同时把消息追加到 callee.inbox + caller.outbox，callee 自动进入 running 等待 worker 调度
- 等待回复：open(parent_window_id="<talk_window_id>", command="wait", args={})
- 关闭窗口：close(window_id="<talk_window_id>", reason="...")

**重要：talk_window 是持续会话窗口，应该复用。**
- 同一个 target 在同一个 thread 内只需要一个 talk_window；后续消息全部从同一个 talk_window 的 say 走
- 不要每发一条消息就 close，再下一轮 open 一个新的——这会丢失 conversation 关联，并产生大量噪声 window
- 仅当与该对象的对话真正结束、明确不再需要回复时才 close

允许同时打开多个 talk_window 来并行维护**不同 target / 不同主题**（不是为了重复同一对话）。
`.trim();

function guidanceWindows(form: BaseContextWindow, entries: Record<string, string>): ContextWindow[] {
  // batch C narrowing(N3): form 契约层是 base ContextWindow；只读 base id + 具体 form 的 command，narrow 一次。
  const sourceId = (form as MethodExecWindow).command;
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
        reason: { mechanism: "form_bound", sourceId },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

function deriveTalkTitle(raw: string, max = 60): string {
  const trimmed = raw.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

/**
 * P6.§4-§5 constructor —— 创建 talk_window。
 *
 * 行为:
 *  - 校验 target / title 必填
 *  - 校验 target 对应的 stone object 存在（除 super alias）
 *  - generateWindowId("talk") + build TalkWindow（conversationId = id）
 *  - 返回 { ok: true, object: talkWindow }
 *
 * 不在此处发消息（首条消息走 talk_window.say）。
 */
const talkConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["talk"],
  permission: () => "allow",
  schema: {
    args: {
      target: { type: "string", required: true, description: '目标 flow object 的 objectId（"user" 也是一个 flow object）' },
      title: { type: "string", required: true, description: "本会话的简短主题（同一 caller 多窗口区分用）" },
    },
  } as MethodCallSchema,
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [TALK_CONSTRUCTOR_BASIC]: TALK_CONSTRUCTOR_KNOWLEDGE,
    };
    if (formStatus === "open") {
      const target = typeof args.target === "string" ? args.target.trim() : "";
      const title = typeof args.title === "string" ? args.title.trim() : "";
      if (!target || !title) {
        const missing: string[] = [];
        if (!target) missing.push("target");
        if (!title) missing.push("title");
        entries[TALK_CONSTRUCTOR_INPUT] =
          `talk 还缺以下参数: ${missing.join(", ")}。\n` +
          "请用 refine(form_id, args={ target: \"<objectId>\", title: \"<会话主题>\" }) 补齐后 submit(form_id)。\n" +
          "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
      }
    }
    return guidanceWindows(form, entries);
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[talk] 缺少 thread context。" };
    const target = typeof ctx.args.target === "string" ? ctx.args.target.trim() : "";
    if (!target) return { ok: false, error: "[talk] 缺少 target 参数。" };
    const title = typeof ctx.args.title === "string" ? deriveTalkTitle(ctx.args.title) : "";
    if (!title) return { ok: false, error: "[talk] 缺少 title 参数。" };

    if (target !== SUPER_ALIAS_TARGET && thread.persistence?.baseDir) {
      const dir = stoneDir({ baseDir: thread.persistence.baseDir, objectId: target });
      let exists = false;
      try {
        const info = await stat(dir);
        exists = info.isDirectory();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (!exists) {
        return {
          ok: false,
          error: `[talk] target \`${target}\` 不存在(stones/${target}/ 目录未找到)。请检查 target 拼写是否正确;若是新对象,先创建 stone object 再 open talk_window。`,
        };
      }
    }

    const id = generateWindowId("talk");
    const talkWindow: TalkWindow = {
      id,
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title,
      status: "open",
      createdAt: Date.now(),
      target,
      conversationId: id,
      state: { transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT } },
    };
    return { ok: true, object: talkWindow };
  },
};

builtinRegistry.registerObjectType("talk", {
  methods: {
    say: sayCommand,
    wait: waitCommand,
    close: closeCommand,
    talk: talkConstructor,
  },
  windowMethods: {
    set_transcript_window: setTranscriptWindowCommandForTalk,
  },
  onClose: onCloseTalkWindow,
  renderXml: renderTalkWindow,
  compressView: compressTalkWindow,
  basicKnowledge: TALK_WINDOW_BASIC_KNOWLEDGE,
  // G4: registry 派发的去重 hook —— 复用 filterMessagesForTalkWindow，让 renderer
  // 无需直接 import 本模块即可拿到 talk_window transcript 消费的消息 id。
  consumedMessageIds: (ctx) =>
    filterMessagesForTalkWindow(ctx.window as TalkWindow, ctx.thread),
  // P6.§6: talk_window 是 Object 内置特性 —— 不写独立 dir，状态 inline 进所属 thread 的 context.json。
  isBuiltinFeature: true,
});
