/**
 * 会话窗渲染 helper —— transcript 过滤 + head 节点（从原 talk readable 抽出，保留在 core）。
 *
 * 会话载体已收口为唯一注册 class `_builtin/thread`（thread builtin）；talk / reflect_request 是
 * thread readable 按视角投影出的 window class。thread readable import 本 helper 完成会话 transcript
 * 渲染——逻辑与原 talk readable 一致，对三种投影 class 同款渲染。
 *
 * 这些实现物（filterTalkMessages / renderHead + delivery / fork + _shared transcript 渲染）保留在
 * core，供 thread builtin / delivery / fork / flows 复用。
 */
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { ThreadContext, ThreadMessage } from "@ooc/core/thinkable/context.js";
import type { TalkData } from "../types.js";

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
export function renderHead(self: TalkData): XmlNode[] {
  return self.isForkWindow
    ? [xmlElement("target_thread", {}, [xmlText(self.targetThreadId ?? "")])]
    : [
        xmlElement("target", {}, [xmlText(self.target)]),
        xmlElement("conversation_id", {}, [xmlText(self.conversationId)]),
      ];
}
