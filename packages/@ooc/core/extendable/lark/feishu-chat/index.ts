/**
 * feishu_chat window — 把飞书群聊 / 单聊作为 ContextWindow 引入 OOC。
 *
 * 注册命令：
 * - refresh：拉最近 N 条 / 增量拉（无副作用）
 * - search：本群关键字搜索（无副作用，临时切 mode=search）
 * - send：发新消息（**强制 dry-run gate**：args.confirm !== true 时只走 lark-cli --dry-run 预览）
 * - reply：引用某条消息回复（同 dry-run gate）
 * - subscribe：登记希望被 poller 周期 refresh（当前仅写字段，poller 由 future work 接入）
 * - close：释放 window
 *
 * 不在本类型职责内：
 * - 创建群 / 加成员 / 撤回消息（走 raw `lark-cli api` 临时，不上升为 first-class method）
 * - 跨群转发（由 feishu_doc.attach_to_chat 等做引用，群聊 send 不直接搬内容）
 *
 * 鉴权：默认 send/reply 用 `--as bot`（supervisor 决策 §七.2），其它命令用 user。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../../../executable/windows/_shared/method-types.js";
import { builtinRegistry, type RenderContext } from "../../../executable/windows/_shared/registry.js";
import type { FeishuChatWindow, FeishuChatMessage } from "./types.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "../../../thinkable/context/xml.js";
import { larkExec } from "../cli.js";

const MAX_RENDER_BYTES = 8192;
const DEFAULT_TAIL = 30;

const MAX_TAIL = 50;

const REFRESH_TIP = `feishu_chat.refresh 拉取本群最近消息到 window.buffer。
参数：count（可选 1..50，默认 30）、since_message_id（可选，增量拉）。`;

const SEARCH_TIP = `feishu_chat.search 在本群按关键字搜索消息，切 mode=search。
参数：query（必填）、limit（可选）。refresh 切回最近消息。`;

const SEND_TIP = `feishu_chat.send 发新消息（dry-run gate）。
首次 submit 只 --dry-run 预览；refine({confirm: true}) 后 submit 才真发。
参数：text（必填）、as（可选 "bot"|"user"，默认 bot）、confirm（true 才真发）。`;

const REPLY_TIP = `feishu_chat.reply 引用回复（dry-run gate 同 send）。
参数：reply_to（必填 message_id）、text（必填）、as、confirm。`;

const SUBSCRIBE_TIP = `feishu_chat.subscribe 标记周期 refresh 意愿。
参数：interval_ms（>=10000；0 取消订阅）。`;

const refreshMethod: ObjectMethod = {
  description: "Refresh this chat window by fetching recent messages.",
  intents: ["refresh"],
  onFormChange() {
    return { tip: REFRESH_TIP, intents: [{ name: "refresh" }], quick_exec_submit: true };
  },
  exec: (ctx) => executeRefresh(ctx),
};

const searchMethod: ObjectMethod = {
  description: "Search messages in this chat by keyword.",
  intents: ["search"],
  schema: {
    args: {
      query: { type: "string", required: true, description: "搜索关键字" },
      limit: { type: "number", description: "最多返回条数" },
    },
  },
  onFormChange(change, { args }) {
    const hasQuery = typeof args.query === "string" && args.query.length > 0;
    return {
      tip: hasQuery ? `Searching for ${args.query}...` : SEARCH_TIP,
      intents: [{ name: "search" }],
      quick_exec_submit: hasQuery,
    };
  },
  exec: (ctx) => executeSearch(ctx),
};

const sendMethod: ObjectMethod = {
  description: "Send a new message to this chat (dry-run first; confirm=true to actually send).",
  intents: ["send.confirmed"],
  schema: {
    args: {
      text: { type: "string", required: true, description: "消息正文" },
      as: { type: "string", enum: ["bot", "user"], description: "发送身份，默认 bot" },
      confirm: { type: "boolean", description: "true 才真发；首次 submit 走 dry-run" },
    },
  },
  onFormChange(change, { args }) {
    const intents = args.confirm === true ? [{ name: "send.confirmed" }] : [{ name: "send" }];
    const hasText = typeof args.text === "string" && args.text.length > 0;
    let tip = SEND_TIP;
    if (hasText && args.confirm !== true) {
      tip = "已提供 text；submit 将 dry-run 预览。确认后 refine({confirm: true}) 再 submit 才真发。";
    }
    return { tip, intents, quick_exec_submit: hasText };
  },
  exec: (ctx) => executeSend(ctx),
};

const replyMethod: ObjectMethod = {
  description: "Reply to a specific message in this chat (dry-run first; confirm=true to actually send).",
  intents: ["reply.confirmed"],
  schema: {
    args: {
      reply_to: { type: "string", required: true, description: "被回复的 message_id" },
      text: { type: "string", required: true, description: "回复正文" },
      as: { type: "string", enum: ["bot", "user"] },
      confirm: { type: "boolean" },
    },
  },
  onFormChange(change, { args }) {
    const intents = args.confirm === true ? [{ name: "reply.confirmed" }] : [{ name: "reply" }];
    const hasText = typeof args.text === "string" && args.text.length > 0;
    const hasReplyTo = typeof args.reply_to === "string" && args.reply_to.length > 0;
    let tip = REPLY_TIP;
    if (hasText && hasReplyTo && args.confirm !== true) {
      tip = "已提供 reply_to+text；submit 将 dry-run 预览。refine({confirm: true}) 后再 submit 才真发。";
    }
    return { tip, intents, quick_exec_submit: hasText && hasReplyTo };
  },
  exec: (ctx) => executeReply(ctx),
};

const subscribeMethod: ObjectMethod = {
  description: "Subscribe this window to periodic refresh (poller TBD).",
  intents: ["subscribe"],
  schema: {
    args: {
      interval_ms: { type: "number", required: true, description: "refresh 间隔毫秒；0 取消订阅" },
    },
  },
  onFormChange(change, { args }) {
    const hasInterval = typeof args.interval_ms === "number";
    return {
      tip: hasInterval ? `Subscribing with interval ${args.interval_ms}ms...` : SUBSCRIBE_TIP,
      intents: [{ name: "subscribe" }],
      quick_exec_submit: hasInterval,
    };
  },
  exec: (ctx) => executeSubscribe(ctx),
};

const closeMethod: ObjectMethod = {
  description: "Close this feishu chat window.",
  exec: () => undefined,
};

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
  // lark-cli `--format json` 输出形态尚未在本机验证，先走宽容解析：
  // 兼容 { items: [...] } / { data: { items: [...] } } / 数组。
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
  // 飞书 text 消息的 body.content 通常是 JSON `{"text": "..."}`；尝试解析。
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

async function executeRefresh(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_chat"。
  const window = ctx.self as FeishuChatWindow;
  const count = clampCount(ctx.args.count, DEFAULT_TAIL);
  const sinceId = asString(ctx.args.since_message_id);

  // +chat-messages-list 用 --page-size（与 +chat-list 一致）；--page-limit 是别的子命令的写法。
  // 上限 50（cli 强制），更多需要走分页。
  const args = ["im", "+chat-messages-list", "--chat-id", window.chatId, "--page-size", String(count)];
  if (sinceId) args.push("--start-message-id", sinceId);

  const r = await larkExec(args, { as: "user", pageAll: false });
  if (!r.ok) {
    return `[feishu_chat.refresh] ${r.error}`;
  }

  const messages = normalizeMessages(r.data);
  // 拼装 next buffer：增量模式 append；全量模式直接覆盖。
  const next: FeishuChatWindow = {
    ...window,
    mode: "tail",
    tailCount: count,
    buffer: sinceId ? mergeAppend(window.buffer, messages) : messages,
    lastRefreshAtMs: Date.now(),
    cursor: extractCursor(r.data) ?? window.cursor,
  };
  Object.assign(window, next);
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

async function executeSearch(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_chat"。
  const window = ctx.self as FeishuChatWindow;
  const query = asString(ctx.args.query);
  if (!query) return "[feishu_chat.search] 缺少 query。";
  const limit = clampCount(ctx.args.limit, 30);

  // 走原生 +messages-search（user identity only），把 chat 限定为本群。
  // page-limit 上限 40（cli 默认/上限），单次足够覆盖典型 search 场景。
  const r = await larkExec(
    [
      "im",
      "+messages-search",
      "--query",
      query,
      "--chat-id",
      window.chatId,
      "--page-limit",
      String(Math.min(Math.max(Math.ceil(limit / 20), 1), 40)),
    ],
    { as: "user" },
  );
  if (!r.ok) {
    return `[feishu_chat.search] ${r.error}`;
  }
  const hits = normalizeMessages(r.data).slice(0, limit);

  const next: FeishuChatWindow = {
    ...window,
    mode: "search",
    searchQuery: query,
    buffer: hits,
    lastRefreshAtMs: Date.now(),
  };
  Object.assign(window, next);
  return `搜索 "${query}" 命中 ${hits.length} 条。`;
}

async function executeSend(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_chat"。
  const window = ctx.self as FeishuChatWindow;
  const text = asString(ctx.args.text);
  if (!text) return "[feishu_chat.send] 缺少 text。";
  const as = (ctx.args.as === "user" ? "user" : "bot") as "bot" | "user";
  const confirm = ctx.args.confirm === true;

  const cliArgs = [
    "im",
    "+messages-send",
    "--chat-id",
    window.chatId,
    "--text",
    text,
  ];

  // 强制 dry-run gate（supervisor 决策）：未确认时只走 --dry-run。
  if (!confirm) {
    const dry = await larkExec(cliArgs, { as, dryRun: true });
    if (!dry.ok) {
      return `[feishu_chat.send dry-run] ${dry.error}`;
    }
    return `dry-run 预览成功；如要真发，refine(args={ confirm: true }) 后再 submit。\nas=${as}, chat=${window.chatId}, text 长度=${text.length}\n预览返回：${truncate(dry.raw, 512)}`;
  }

  const real = await larkExec([...cliArgs, "--yes"], { as });
  if (!real.ok) {
    return `[feishu_chat.send] ${real.error}`;
  }
  return `已发送（as=${as}, chat=${window.chatId}）。`;
}

async function executeReply(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_chat"。
  const window = ctx.self as FeishuChatWindow;
  const replyTo = asString(ctx.args.reply_to);
  const text = asString(ctx.args.text);
  if (!replyTo) return "[feishu_chat.reply] 缺少 reply_to（被回复消息的 message_id）。";
  if (!text) return "[feishu_chat.reply] 缺少 text。";
  const as = (ctx.args.as === "user" ? "user" : "bot") as "bot" | "user";
  const confirm = ctx.args.confirm === true;

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

function executeSubscribe(ctx: MethodExecutionContext): string | undefined {
  // P6.§3: manager 已保证 self.type === "feishu_chat"。
  const window = ctx.self as FeishuChatWindow;
  const interval = Number(ctx.args.interval_ms);
  if (!Number.isFinite(interval) || interval < 0) {
    return "[feishu_chat.subscribe] interval_ms 必须为 >=0 的数字（0 表示取消订阅）。";
  }
  if (interval > 0 && interval < 10_000) {
    return "[feishu_chat.subscribe] interval_ms 不得 < 10000（10s 下限避免配额风暴）。";
  }
  const next: FeishuChatWindow = {
    ...window,
    subscribePollIntervalMs: interval > 0 ? interval : undefined,
  };
  Object.assign(window, next);
  return interval > 0
    ? `已登记订阅意愿（interval=${interval}ms）；poller 集成 TBD，当前仍需显式 refresh。`
    : "已取消订阅意愿。";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `…(${text.length - max} more bytes)`;
}

// ─────────────────────────── render ────────────────────────────

function renderFeishuChat(ctx: RenderContext): XmlNode[] {
  const w = ctx.window as FeishuChatWindow;
  const children: XmlNode[] = [
    xmlElement("chat_id", {}, [xmlText(w.chatId)]),
    xmlElement("chat_name", {}, [xmlText(w.chatName)]),
    xmlElement("mode", {}, [xmlText(w.mode)]),
  ];
  if (w.chatType) children.push(xmlElement("chat_type", {}, [xmlText(w.chatType)]));
  if (w.tailCount && w.mode === "tail") {
    children.push(xmlElement("tail_count", {}, [xmlText(String(w.tailCount))]));
  }
  if (w.searchQuery && w.mode === "search") {
    children.push(xmlElement("search_query", {}, [xmlText(w.searchQuery)]));
  }
  if (w.lastRefreshAtMs) {
    children.push(
      xmlElement("last_refresh", {}, [xmlText(new Date(w.lastRefreshAtMs).toISOString())]),
    );
  }
  if (w.subscribePollIntervalMs) {
    children.push(
      xmlElement("subscribe_interval_ms", {}, [xmlText(String(w.subscribePollIntervalMs))]),
    );
  }
  const body = w.buffer.length === 0
    ? "(buffer 为空，先 refresh)"
    : w.buffer.map(formatMessageLine).join("\n");
  children.push(xmlElement("messages", {}, [xmlText(truncateBytes(body, MAX_RENDER_BYTES))]));
  return children;
}

function formatMessageLine(m: FeishuChatMessage): string {
  const ts = new Date(m.createTimeMs).toISOString().slice(11, 19);
  const reply = m.replyToMessageId ? ` ↩${m.replyToMessageId.slice(-6)}` : "";
  const kind = m.senderKind ? `[${m.senderKind}]` : "";
  return `${ts} ${kind}${m.sender} (${m.messageId.slice(-8)})${reply}: ${m.text}`;
}

builtinRegistry.registerExecutable("feishu_chat", {
  methods: {
    refresh: refreshMethod,
    search: searchMethod,
    send: sendMethod,
    reply: replyMethod,
    subscribe: subscribeMethod,
    close: closeMethod,
  },
});
builtinRegistry.registerReadable("feishu_chat", {
  readable: renderFeishuChat,
});
