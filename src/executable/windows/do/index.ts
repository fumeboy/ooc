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
import { archiveDoWindowChild } from "./helpers.js";
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
  if (transcriptMessages.length > 0) {
    children.push(
      xmlElement(
        "transcript",
        {},
        transcriptMessages.map((m) =>
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
  commands: {
    continue: continueCommand,
    wait: waitCommand,
    close: closeCommand,
    move: moveCommand,
  },
  onClose: onCloseDoWindow,
  renderXml: renderDoWindow,
});
