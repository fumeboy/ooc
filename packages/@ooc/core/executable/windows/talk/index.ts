/**
 * talk_window — 与另一个 flow object 的某条 thread 持续会话。
 *
 * collaborable cross-object talk：
 * - 注册的 method：say / wait / close
 * - say：通过 talk-delivery 把消息派送到 target object 的 callee thread；同时记入本 thread.outbox
 * - wait：父线程进 status=waiting + inboxSnapshotAtWait 写入
 * - close：onClose 拒绝关闭 creator talk_window（与 caller 的恒在通道）；其他 talk_window 释放即可
 * - 视图：transcript 按 outbox.windowId === self.id || inbox.replyToWindowId === self.id 过滤
 */

import { builtinRegistry, type OnCloseContext, type RenderContext } from "../_shared/registry.js";
import type { ObjectMethod } from "../_shared/method-types.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import { stat } from "node:fs/promises";
import { stoneDir, resolveStoneIdentityRef } from "../../../persistable/index.js";
import { SUPER_ALIAS_TARGET } from "@ooc/core/_shared/types/constants.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ContextWindow,
} from "../_shared/types.js";
import { sayMethod } from "./method.say.js";
import { waitMethod } from "./method.wait.js";
import { closeMethod } from "./method.close.js";
import { setTranscriptWindowCommandForTalk } from "./method.set-transcript-window.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  applyTranscriptViewport,
  type TranscriptViewport,
} from "../_shared/transcript-viewport.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { TalkWindow } from "./types.js";

/**
 * talk_window 的视图过滤（R3 #15）：
 * - outbox 上 windowId === self.id（self 在该 window say 时打的标记）
 * - inbox 上 replyToWindowId === self.id（对端回信的路由标记）
 *
 * ThreadMessage 字段扩展。
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

/** talk_window 的 readable hook：target + transcript（按 windowId / replyToWindowId 过滤）。 */
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
 * 通过 registerExecutable 注入；只要 thread.contextWindows 里出现至少一个 talk_window，
 * 全局基础知识合成阶段就会把这段文本作为一个 protocol KnowledgeWindow 注入到 context，
 * 让 LLM 在还没 open 任何 say/wait form 时就知道 talk_window 的命令面与典型用法。
 */
const TALK_RECENT_COUNT = 2;
const TALK_MESSAGE_TRUNCATE = 200;

/**
 * talk_window 的 compressView hook。
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
  if (ctx.window.class !== "talk") return;
  // 窄化：ctx.window 契约层是 base ContextWindow；type==="talk" 守卫后 narrow 回 TalkWindow 读 isCreatorWindow。
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

// ─────────────────────────── constructor ──────────────────────────

const TALK_CONSTRUCTOR_TIP = `talk 开启一个对外的持续会话 talk_window（同一 target 复用同一 talk_window）。
参数：target（必填，目标 objectId，"user" 也是）、title（必填，会话主题）。`;

function deriveTalkTitle(raw: string, max = 60): string {
  const trimmed = raw.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

/**
 * constructor —— 创建 talk_window。
 *
 * 行为:
 *  - 校验 target / title 必填
 *  - 校验 target 对应的 stone object 存在（除 super alias）
 *  - generateWindowId("talk") + build TalkWindow（conversationId = id）
 *  - 返回 { ok: true, object: talkWindow }
 *
 * 不在此处发消息（首条消息走 talk_window.say）。
 */
export const talkConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Open a persistent talk_window to another flow object (or user).",
  intents: ["talk"],
  permission: () => "allow",
  schema: {
    args: {
      target: { type: "string", required: true, description: '目标 flow object 的 objectId（"user" 也是一个 flow object）' },
      title: { type: "string", required: true, description: "本会话的简短主题" },
    },
  } as MethodCallSchema,
  onFormChange(change, { args }) {
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const ready = Boolean(target && title);
    return {
      tip: ready ? `Opening talk to ${target}...` : TALK_CONSTRUCTOR_TIP,
      intents: [{ name: "talk" }],
      quick_exec_submit: ready,
    };
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[talk] 缺少 thread context。" };
    const target = typeof ctx.args.target === "string" ? ctx.args.target.trim() : "";
    if (!target) return { ok: false, error: "[talk] 缺少 target 参数。" };
    const title = typeof ctx.args.title === "string" ? deriveTalkTitle(ctx.args.title) : "";
    if (!title) return { ok: false, error: "[talk] 缺少 title 参数。" };

    if (target !== SUPER_ALIAS_TARGET && thread.persistence?.baseDir) {
      // session-aware 解析：business session 内的 target 可能是本 session 新建对象
      // （落 flows/<sid>/objects/<target>，未合 main）。经 resolveStoneIdentityRef(read)
      // 路由——已建 worktree 读 worktree 完整副本（含 main 继承 + 本 session 新建），
      // super / 无 session / 未建 worktree 透传 main canonical（行为不变）。
      const stoneRef = await resolveStoneIdentityRef(
        {
          baseDir: thread.persistence.baseDir,
          sessionId: thread.persistence.sessionId,
          objectId: target,
        },
        "read",
      );
      const dir = stoneDir(stoneRef);
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
          error: `[talk] target \`${target}\` 不存在(本 session worktree 与 main canonical 均未找到该对象目录)。请检查 target 拼写是否正确;若是新对象,先 create_object 再 open talk_window。`,
        };
      }
    }

    const id = generateWindowId("talk");
    const talkWindow: TalkWindow = {
      id,
      class: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title,
      status: "open",
      createdAt: Date.now(),
      target,
      conversationId: id,
      state: { transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT } },
    };
    return { ok: true, window: talkWindow };
  },
};

builtinRegistry.registerExecutable("talk", {
  methods: {
    say: sayMethod,
    wait: waitMethod,
    close: closeMethod,
    talk: talkConstructor,
  },
  // talk_window 是 Object 内置特性 —— 不写独立 dir，状态 inline 进所属 thread 的 context.json。
  isBuiltinFeature: true,
});
builtinRegistry.registerReadable("talk", {
  windowMethods: {
    set_transcript_window: setTranscriptWindowCommandForTalk,
  },
  onClose: onCloseTalkWindow,
  readable: renderTalkWindow,
  compressView: compressTalkWindow,
  // G4: registry 派发的去重 hook —— 复用 filterMessagesForTalkWindow，让 renderer
  // 无需直接 import 本模块即可拿到 talk_window transcript 消费的消息 id。
  consumedMessageIds: (ctx) =>
    filterMessagesForTalkWindow(ctx.window as TalkWindow, ctx.thread),
});
