/**
 * talk —— readable 维度（投影成 context window + window method）。
 *
 * talk 是会话窗的渲染来源：head（peer target / fork target_thread）+ transcript-or-handle
 * （creator 句柄 / 非 creator viewport + transcript）。thread / reflect_request self-view 经 class
 * 链复用本渲染（投影 class 由各自 readable 决定）。
 *
 * - readable：从 ctx.thread 的 inbox/outbox 按本窗形态过滤 transcript，按视角投影 class=talk。
 * - window method `set_transcript_window`：只调投影态 win.transcriptViewport，不碰 Data、不副作用。
 *
 * deferred（WAVE4-WALL-broken-tests.md）：旧 class 注册里的 compressView（折叠/快照渲染）+
 * consumedMessageIds（去重 hook）随旧 ObjectDefinition/registerWindowClass 契约删除；新
 * ReadableModule 契约不含这两槽位，本轮不接回（折叠 / 去重的新契约位置待 supervisor 裁决）。
 */
import type {
  ReadableContext,
  ReadableModule,
  WindowMethod,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { ThreadContext, ThreadMessage } from "@ooc/core/thinkable/context.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  mergeTranscriptViewport,
  hasAnyTranscriptViewportField,
} from "../../_shared/transcript-viewport.js";
import { renderTranscriptOrHandle } from "../../_shared/conversation-render.js";
import type { TalkData, TalkWin } from "../types.js";

/**
 * 会话窗的 transcript 过滤——两种形态寻址不同：
 * - fork 子窗：消息按 targetThreadId 双向匹配（父↔子），从 inbox + outbox 去重。
 * - peer 窗：outbox.windowId === 本窗 id（自己 say）/ inbox.replyToWindowId === 本窗 id（对端回信）。
 */
export function filterTalkMessages(
  objectId: string,
  self: TalkData,
  thread: ThreadContext,
): ThreadMessage[] {
  if (self.isForkWindow) {
    const target = self.targetThreadId;
    const all: ThreadMessage[] = [...(thread.inbox ?? []), ...(thread.outbox ?? [])];
    const seen = new Set<string>();
    const filtered = all.filter((m) => {
      if (seen.has(m.id)) return false;
      if (m.fromThreadId === target || m.toThreadId === target) {
        seen.add(m.id);
        return true;
      }
      return false;
    });
    filtered.sort((a, b) => a.createdAt - b.createdAt);
    return filtered;
  }
  const messages: ThreadMessage[] = [];
  for (const m of thread.outbox ?? []) {
    if (m.windowId === objectId) messages.push(m);
  }
  for (const m of thread.inbox ?? []) {
    if (m.replyToWindowId === objectId) messages.push(m);
  }
  messages.sort((a, b) => a.createdAt - b.createdAt);
  return messages;
}

/** transcript head：peer 渲 target / conversation_id；fork 渲 target_thread。 */
function renderHead(self: TalkData): XmlNode[] {
  return self.isForkWindow
    ? [xmlElement("target_thread", {}, [xmlText(self.targetThreadId ?? "")])]
    : [
        xmlElement("target", {}, [xmlText(self.target)]),
        xmlElement("conversation_id", {}, [xmlText(self.conversationId)]),
      ];
}

const setTranscriptWindowMethod: WindowMethod<TalkData, TalkWin> = {
  name: "set_transcript_window",
  description: "Adjust which portion of the transcript is rendered (tail N or fixed range).",
  schema: {
    args: {
      tail: { type: "number", required: false, description: "末 N 条（正整数，与 range_* 互斥）" },
      range_start: { type: "number", required: false, description: "区间起点" },
      range_end: { type: "number", required: false, description: "区间终点" },
    },
  },
  exec: (_ctx: ReadableContext, _self: TalkData, before: TalkWin, args: Record<string, unknown>) => {
    if (!hasAnyTranscriptViewportField(args)) {
      return before ?? {};
    }
    const merged = mergeTranscriptViewport(
      before?.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT,
      args,
    );
    if (!merged.ok) throw new Error(`[talk.set_transcript_window] ${merged.error}`);
    return { ...before, transcriptViewport: merged.viewport };
  },
};

const readable: ReadableModule<TalkData, TalkWin> = {
  readable: (ctx: ReadableContext, self: TalkData, win: TalkWin) => {
    const children: XmlNode[] = renderHead(self);
    const thread = ctx.thread;
    if (thread) {
      const messages = filterTalkMessages(ctx.object.id, self, thread);
      children.push(
        ...renderTranscriptOrHandle(
          { isCreatorWindow: self.isCreatorWindow, state: { transcriptViewport: win?.transcriptViewport } },
          messages,
        ),
      );
    }
    return { class: "talk", content: children };
  },
  window: [
    {
      class: "talk",
      object_methods: ["say", "close", "share"],
      window_methods: [setTranscriptWindowMethod],
    },
  ],
};

export default readable;
