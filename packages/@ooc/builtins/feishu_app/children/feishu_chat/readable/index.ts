/**
 * feishu_chat —— readable 维度（投影成 context window）。
 *
 * 把 Data 投影成行式消息流 window —— chat 元信息 + buffer 渲染为 messages 文本块。
 * window 声明引用 executable 的 object_methods；本类无独立投影态切片（无 window method）。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import type { ReadonlySelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { Data, FeishuChatMessage } from "../types.js";

const MAX_RENDER_BYTES = 8192;

function renderFeishuChat(self: Data): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("chat_id", {}, [xmlText(self.chatId)]),
    xmlElement("chat_name", {}, [xmlText(self.chatName)]),
    xmlElement("mode", {}, [xmlText(self.mode)]),
  ];
  if (self.chatType) children.push(xmlElement("chat_type", {}, [xmlText(self.chatType)]));
  if (self.tailCount && self.mode === "tail") {
    children.push(xmlElement("tail_count", {}, [xmlText(String(self.tailCount))]));
  }
  if (self.searchQuery && self.mode === "search") {
    children.push(xmlElement("search_query", {}, [xmlText(self.searchQuery)]));
  }
  if (self.lastRefreshAtMs) {
    children.push(
      xmlElement("last_refresh", {}, [xmlText(new Date(self.lastRefreshAtMs).toISOString())]),
    );
  }
  if (self.subscribePollIntervalMs) {
    children.push(
      xmlElement("subscribe_interval_ms", {}, [xmlText(String(self.subscribePollIntervalMs))]),
    );
  }
  const body = self.buffer.length === 0
    ? "(buffer 为空，先 refresh)"
    : self.buffer.map(formatMessageLine).join("\n");
  children.push(xmlElement("messages", {}, [xmlText(truncateBytes(body, MAX_RENDER_BYTES))]));
  return children;
}

function formatMessageLine(m: FeishuChatMessage): string {
  const ts = new Date(m.createTimeMs).toISOString().slice(11, 19);
  const reply = m.replyToMessageId ? ` ↩${m.replyToMessageId.slice(-6)}` : "";
  const kind = m.senderKind ? `[${m.senderKind}]` : "";
  return `${ts} ${kind}${m.sender} (${m.messageId.slice(-8)})${reply}: ${m.text}`;
}

const readable: ReadableModule<Data> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>) => ({
    class: "feishu_chat",
    content: renderFeishuChat(self.data),
  }),
  window: [
    {
      class: "feishu_chat",
      object_methods: ["refresh", "search", "send", "reply", "subscribe", "close"],
      window_methods: [],
    },
  ],
};

export default readable;
