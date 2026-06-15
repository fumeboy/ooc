/**
 * feishu_chat —— 把飞书群聊 / 单聊作为 OOC object（context window）引入。
 *
 * Wave 4 对象模型：一处 `export const Class: OocClass<Data>` 装配 construct + executable
 * （chat object methods）+ readable（投影成 window）。object method 签名 `(ctx, self, args)`，
 * 直接读写 self（业务 Data）。注册经 lark barrel side-effect import →
 * `builtinRegistry.register("feishu_chat", Class)`。
 *
 * object methods：
 * - refresh：拉最近 N 条 / 增量拉（无副作用，改 buffer）
 * - search：本群关键字搜索（临时切 mode=search）
 * - send：发新消息（**强制 dry-run gate**：args.confirm !== true 只 dry-run 预览）
 * - reply：引用回复（同 dry-run gate）
 * - subscribe：登记周期 refresh 意愿（仅写字段，poller TBD）
 * - close：释放对象
 *
 * 鉴权：send/reply 默认 `--as bot`（supervisor 决策），其它 user。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "../../../executable/contract.js";
import type { OocClass } from "../../../runtime/ooc-class.js";
import type { ReadableContext, ReadableModule } from "../../../readable/contract.js";
import { builtinRegistry } from "../../../runtime/object-registry.js";
import type { Data, FeishuChatMessage } from "./types.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { larkExec } from "../cli.js";

const MAX_RENDER_BYTES = 8192;
const DEFAULT_TAIL = 30;
const MAX_TAIL = 50;

// ─────────────────────────── object methods ────────────────────────────

const refreshMethod: ObjectMethod<Data> = {
  name: "refresh",
  description: "Refresh this chat window by fetching recent messages.",
  schema: {
    args: {
      count: { type: "number", description: "拉取条数 1..50，默认 30" },
      since_message_id: { type: "string", description: "增量拉的起点 message_id" },
    },
  },
  exec: (_ctx, self, args) => executeRefresh(self, args),
};

const searchMethod: ObjectMethod<Data> = {
  name: "search",
  description: "Search messages in this chat by keyword.",
  schema: {
    args: {
      query: { type: "string", required: true, description: "搜索关键字" },
      limit: { type: "number", description: "最多返回条数" },
    },
  },
  exec: (_ctx, self, args) => executeSearch(self, args),
};

const sendMethod: ObjectMethod<Data> = {
  name: "send",
  description: "Send a new message to this chat (dry-run first; confirm=true to actually send).",
  schema: {
    args: {
      text: { type: "string", required: true, description: "消息正文" },
      as: { type: "string", enum: ["bot", "user"], description: "发送身份，默认 bot" },
      confirm: { type: "boolean", description: "true 才真发；首次 submit 走 dry-run" },
    },
  },
  exec: (_ctx, self, args) => executeSend(self, args),
};

const replyMethod: ObjectMethod<Data> = {
  name: "reply",
  description: "Reply to a specific message in this chat (dry-run first; confirm=true to actually send).",
  schema: {
    args: {
      reply_to: { type: "string", required: true, description: "被回复的 message_id" },
      text: { type: "string", required: true, description: "回复正文" },
      as: { type: "string", enum: ["bot", "user"] },
      confirm: { type: "boolean" },
    },
  },
  exec: (_ctx, self, args) => executeReply(self, args),
};

const subscribeMethod: ObjectMethod<Data> = {
  name: "subscribe",
  description: "Subscribe this window to periodic refresh (poller TBD).",
  schema: {
    args: {
      interval_ms: { type: "number", required: true, description: "refresh 间隔毫秒；0 取消订阅" },
    },
  },
  exec: (_ctx, self, args) => executeSubscribe(self, args),
};

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description: "Close this feishu chat window.",
  exec: () => undefined,
};

// ─────────────────────────── helpers ────────────────────────────

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function clampCount(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), MAX_TAIL);
}

/** 把 lark-cli IM messages list 的 JSON 结构归一化到 FeishuChatMessage[]。 */
function normalizeMessages(raw: unknown): FeishuChatMessage[] {
  const arr = extractItemsArray(raw);
  return arr.map((it) => normalizeOne(it)).filter((m): m is FeishuChatMessage => m !== null);
}

function extractItemsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.items)) return r.items;
    if (r.data && typeof r.data === "object") {
      const d = r.data as Record<string, unknown>;
      if (Array.isArray(d.items)) return d.items;
    }
  }
  return [];
}

function normalizeOne(it: unknown): FeishuChatMessage | null {
  if (!it || typeof it !== "object") return null;
  const m = it as Record<string, unknown>;
  const messageId = asString(m.message_id) ?? asString(m.id);
  if (!messageId) return null;
  const sender = pickSender(m);
  const createTimeMs = pickCreateMs(m);
  const text = pickText(m);
  const replyToMessageId = asString(m.parent_id) ?? asString(m.reply_to_id);
  return {
    messageId,
    sender,
    senderKind: pickSenderKind(m),
    createTimeMs,
    text,
    replyToMessageId,
  };
}

function pickSender(m: Record<string, unknown>): string {
  const s = m.sender as Record<string, unknown> | undefined;
  if (s) {
    return (
      asString(s.open_id) ?? asString(s.id) ?? asString(s.sender_id) ?? asString(s.name) ?? "unknown"
    );
  }
  return asString(m.from) ?? "unknown";
}

function pickSenderKind(m: Record<string, unknown>): "user" | "bot" | "system" | undefined {
  const s = m.sender as Record<string, unknown> | undefined;
  const t = asString(s?.sender_type) ?? asString(m.sender_type);
  if (!t) return undefined;
  if (/bot/i.test(t)) return "bot";
  if (/system/i.test(t)) return "system";
  return "user";
}

function pickCreateMs(m: Record<string, unknown>): number {
  const v = m.create_time ?? m.createTime ?? m.timestamp;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v; // 飞书常返秒级
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  }
  return Date.now();
}

function pickText(m: Record<string, unknown>): string {
  const body = m.body as Record<string, unknown> | undefined;
  const content = asString(body?.content) ?? asString(m.content);
  if (!content) {
    const msgType = asString(m.msg_type);
    if (msgType && msgType !== "text") return `[${msgType}]`;
    return "";
  }
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") {
      const t = asString((parsed as Record<string, unknown>).text);
      if (t) return t;
    }
  } catch {
    /* 非 JSON 文本，直接返回原值 */
  }
  return content;
}

async function executeRefresh(self: Data, args: Record<string, unknown>): Promise<string | undefined> {
  const count = clampCount(args.count, DEFAULT_TAIL);
  const sinceId = asString(args.since_message_id);

  const cliArgs = ["im", "+chat-messages-list", "--chat-id", self.chatId, "--page-size", String(count)];
  if (sinceId) cliArgs.push("--start-message-id", sinceId);

  const r = await larkExec(cliArgs, { as: "user", pageAll: false });
  if (!r.ok) return `[feishu_chat.refresh] ${r.error}`;

  const messages = normalizeMessages(r.data);
  self.mode = "tail";
  self.tailCount = count;
  self.buffer = sinceId ? mergeAppend(self.buffer, messages) : messages;
  self.lastRefreshAtMs = Date.now();
  self.cursor = extractCursor(r.data) ?? self.cursor;
  return `已刷新 ${messages.length} 条消息（mode=tail, count=${count}）。`;
}

function mergeAppend(prev: FeishuChatMessage[], add: FeishuChatMessage[]): FeishuChatMessage[] {
  const seen = new Set(prev.map((m) => m.messageId));
  const merged = [...prev];
  for (const m of add) {
    if (!seen.has(m.messageId)) merged.push(m);
  }
  return merged.slice(-MAX_TAIL);
}

function extractCursor(raw: unknown): string | undefined {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (asString(r.page_token)) return asString(r.page_token);
    if (r.data && typeof r.data === "object") {
      return asString((r.data as Record<string, unknown>).page_token);
    }
  }
  return undefined;
}

async function executeSearch(self: Data, args: Record<string, unknown>): Promise<string | undefined> {
  const query = asString(args.query);
  if (!query) return "[feishu_chat.search] 缺少 query。";
  const limit = clampCount(args.limit, 30);

  const r = await larkExec(
    [
      "im",
      "+messages-search",
      "--query",
      query,
      "--chat-id",
      self.chatId,
      "--page-limit",
      String(Math.min(Math.max(Math.ceil(limit / 20), 1), 40)),
    ],
    { as: "user" },
  );
  if (!r.ok) return `[feishu_chat.search] ${r.error}`;
  const hits = normalizeMessages(r.data).slice(0, limit);

  self.mode = "search";
  self.searchQuery = query;
  self.buffer = hits;
  self.lastRefreshAtMs = Date.now();
  return `搜索 "${query}" 命中 ${hits.length} 条。`;
}

async function executeSend(self: Data, args: Record<string, unknown>): Promise<string | undefined> {
  const text = asString(args.text);
  if (!text) return "[feishu_chat.send] 缺少 text。";
  const as = (args.as === "user" ? "user" : "bot") as "bot" | "user";
  const confirm = args.confirm === true;

  const cliArgs = ["im", "+messages-send", "--chat-id", self.chatId, "--text", text];

  if (!confirm) {
    const dry = await larkExec(cliArgs, { as, dryRun: true });
    if (!dry.ok) return `[feishu_chat.send dry-run] ${dry.error}`;
    return `dry-run 预览成功；如要真发，refine(args={ confirm: true }) 后再 submit。\nas=${as}, chat=${self.chatId}, text 长度=${text.length}\n预览返回：${truncate(dry.raw, 512)}`;
  }

  const real = await larkExec([...cliArgs, "--yes"], { as });
  if (!real.ok) return `[feishu_chat.send] ${real.error}`;
  return `已发送（as=${as}, chat=${self.chatId}）。`;
}

async function executeReply(self: Data, args: Record<string, unknown>): Promise<string | undefined> {
  const replyTo = asString(args.reply_to);
  const text = asString(args.text);
  if (!replyTo) return "[feishu_chat.reply] 缺少 reply_to（被回复消息的 message_id）。";
  if (!text) return "[feishu_chat.reply] 缺少 text。";
  const as = (args.as === "user" ? "user" : "bot") as "bot" | "user";
  const confirm = args.confirm === true;

  const cliArgs = ["im", "+messages-reply", "--message-id", replyTo, "--text", text];

  if (!confirm) {
    const dry = await larkExec(cliArgs, { as, dryRun: true });
    if (!dry.ok) return `[feishu_chat.reply dry-run] ${dry.error}`;
    return `dry-run 预览成功；如要真发，refine(args={ confirm: true }) 后再 submit。\nreply_to=${replyTo}, as=${as}\n预览返回：${truncate(dry.raw, 512)}`;
  }

  const real = await larkExec([...cliArgs, "--yes"], { as });
  if (!real.ok) return `[feishu_chat.reply] ${real.error}`;
  return `已回复（as=${as}, reply_to=${replyTo}）。`;
}

function executeSubscribe(self: Data, args: Record<string, unknown>): string | undefined {
  const interval = Number(args.interval_ms);
  if (!Number.isFinite(interval) || interval < 0) {
    return "[feishu_chat.subscribe] interval_ms 必须为 >=0 的数字（0 表示取消订阅）。";
  }
  if (interval > 0 && interval < 10_000) {
    return "[feishu_chat.subscribe] interval_ms 不得 < 10000（10s 下限避免配额风暴）。";
  }
  self.subscribePollIntervalMs = interval > 0 ? interval : undefined;
  return interval > 0
    ? `已登记订阅意愿（interval=${interval}ms）；poller 集成 TBD，当前仍需显式 refresh。`
    : "已取消订阅意愿。";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `…(${text.length - max} more bytes)`;
}

// ─────────────────────────── readable 投影 ────────────────────────────

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

const executable: ExecutableModule<Data> = {
  methods: [refreshMethod, searchMethod, sendMethod, replyMethod, subscribeMethod, closeMethod],
};

const readable: ReadableModule<Data> = {
  readable: (_ctx: ReadableContext, self: Data) => ({
    class: "feishu_chat",
    content: renderFeishuChat(self),
  }),
  window: [
    {
      class: "feishu_chat",
      object_methods: ["refresh", "search", "send", "reply", "subscribe", "close"],
      window_methods: [],
    },
  ],
};

// ─────────────────────────── Class 装配 + 注册 ────────────────────────────

export const Class: OocClass<Data> = {
  construct: {
    description: "Open a Feishu chat (group / p2p) as a context window object.",
    schema: {
      args: {
        chat_id: { type: "string", required: true, description: "飞书 chat_id（oc_xxx）" },
        chat_name: { type: "string", description: "群名 / 单聊对端名" },
        chat_type: { type: "string", enum: ["group", "p2p", "topic"] },
        tail_count: { type: "number", description: "初始 tail 条数，默认 30" },
      },
    },
    exec: (_ctx, args: Record<string, unknown>): Data => {
      const chatId = typeof args.chat_id === "string" ? args.chat_id : "";
      const chatName =
        typeof args.chat_name === "string" && args.chat_name ? args.chat_name : chatId.slice(-8);
      const chatType =
        args.chat_type === "group" || args.chat_type === "p2p" || args.chat_type === "topic"
          ? (args.chat_type as "group" | "p2p" | "topic")
          : undefined;
      return {
        chatId,
        chatName,
        chatType,
        mode: "tail",
        tailCount: clampCount(args.tail_count, DEFAULT_TAIL),
        buffer: [],
      };
    },
  },
  executable,
  readable,
};

// feishu_chat 是窗类型（parentClass:null）；经 side-effect import 注册进 builtinRegistry。
builtinRegistry.register("feishu_chat", Class, { parentClass: null });

export type { Data } from "./types.js";
