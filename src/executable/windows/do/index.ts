/**
 * do_window — fork 子线程后在父线程下产生的对话窗口。
 *
 * spec § do_window：
 * - targetThreadId：fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
 * - 注册的 command：continue / wait / close
 * - close 语义：B=ii archive — 把 child thread 标记为 archived；window 释放
 * - 特殊子类：初始 creator do_window（由 windows/_shared/init.ts 创建），不可被 LLM close
 */

import { registerWindowType, type OnCloseContext, type RenderContext } from "../_shared/registry.js";
import { continueCommand } from "./command.continue.js";
import { waitCommand } from "./command.wait.js";
import { closeCommand } from "./command.close.js";
import { moveCommand } from "./command.move.js";
import { setTranscriptWindowCommandForDo } from "./command.set-transcript-window.js";
import { archiveDoWindowChild } from "./helpers.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  applyTranscriptViewport,
  type TranscriptViewport,
} from "../_shared/transcript-viewport.js";
import { xmlElement, xmlText, type XmlNode } from "../../../thinkable/context/xml.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { DoWindow } from "./types.js";

/**
 * do_window 的视图过滤：选出与该 window targetThreadId 相关的消息（父 ↔ 子双向）。
 *
 * 全部从 thread.inbox + thread.outbox 拉取，去重后按 createdAt 升序。
 */
export function filterMessagesForDoWindow(window: DoWindow, thread: ThreadContext): ThreadMessage[] {
  const target = window.targetThreadId;
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

/** do_window 的 renderXml hook：target_thread + creator 标记 + transcript。 */
function renderDoWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as DoWindow;
  const children: XmlNode[] = [
    xmlElement("target_thread", {}, [xmlText(window.targetThreadId)]),
  ];
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  const transcriptMessages = filterMessagesForDoWindow(window, ctx.thread);
  const viewport: TranscriptViewport =
    window.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT;
  const { visible, earlierCount } = applyTranscriptViewport(
    transcriptMessages,
    viewport,
  );

  const viewportAttrs: Record<string, string> = {
    total: String(transcriptMessages.length),
  };
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
          xmlElement(
            "message",
            { id: m.id, source: m.source },
            [
              xmlElement("from_thread_id", {}, [xmlText(m.fromThreadId)]),
              xmlElement("to_thread_id", {}, [xmlText(m.toThreadId)]),
              xmlElement("content", {}, [xmlText(m.content)]),
            ],
          ),
        ),
      ),
    );
  }
  return children;
}

const DO_TRANSCRIPT_TRUNCATE = 200;

/**
 * do_window 的 compressView hook（design §4.1）。
 *
 * - Level 1 (folded):  target_thread + status + 最近 1 条 transcript 消息(截断到 200 字)
 *   + total_messages 总数
 * - Level 2 (snapshot): target_thread + status + total_messages
 *
 * 设计表格里写 "child status",但 do_window 自身已经有 status 字段(running / archived)——
 * window 外壳已暴露 status;这里把它再以 child_status 子节点显式出来,避免 LLM 漏看。
 */
function compressDoWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const window = ctx.window as DoWindow;
  const transcript = filterMessagesForDoWindow(window, ctx.thread);
  const children: XmlNode[] = [
    xmlElement("target_thread", {}, [xmlText(window.targetThreadId)]),
    xmlElement("child_status", {}, [xmlText(window.status)]),
    xmlElement("total_messages", {}, [xmlText(String(transcript.length))]),
  ];
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  if (level === 1 && transcript.length > 0) {
    const last = transcript[transcript.length - 1]!;
    const content = last.content.slice(0, DO_TRANSCRIPT_TRUNCATE);
    children.push(
      xmlElement(
        "last_message",
        { id: last.id, source: last.source },
        [
          xmlElement("from_thread_id", {}, [xmlText(last.fromThreadId)]),
          xmlElement("to_thread_id", {}, [xmlText(last.toThreadId)]),
          xmlElement("content", {}, [xmlText(content)]),
        ],
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

function onCloseDoWindow(ctx: OnCloseContext): boolean | void {
  const window = ctx.window;
  if (window.type !== "do") return;
  if (window.isCreatorWindow) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] window ${window.id} 是初始 creator do_window，不可关闭（spec § 初始 creator 对话 window）。`,
    });
    return false;
  }
  archiveDoWindowChild(ctx.thread, window);
}

registerWindowType("do", {
  methods: {
    continue: continueCommand,
    wait: waitCommand,
    close: closeCommand,
    move: moveCommand,
    set_transcript_window: setTranscriptWindowCommandForDo,
  },
  onClose: onCloseDoWindow,
  renderXml: renderDoWindow,
  compressView: compressDoWindow,
});
