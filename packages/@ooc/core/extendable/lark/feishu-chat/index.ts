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
 * - 创建群 / 加成员 / 撤回消息（走 raw `lark-cli api` 临时，不上升为 first-class command）
 * - 跨群转发（由 feishu_doc.attach_to_chat 等做引用，群聊 send 不直接搬内容）
 *
 * 鉴权：默认 send/reply 用 `--as bot`（supervisor 决策 §七.2），其它命令用 user。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../../../executable/windows/_shared/command-types.js";
import { builtinRegistry, type RenderContext } from "../../../executable/windows/_shared/registry.js";
import type { FeishuChatWindow, FeishuChatMessage } from "./types.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "../../../thinkable/context/xml.js";
import { larkExec } from "../cli.js";
import type { Intent } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import type { MethodExecWindow } from "../../../executable/windows/method_exec/types.js";

const FEISHU_CHAT_PROTOCOL_PATH = "internal/windows/feishu_chat/basic";
const FEISHU_CHAT_REFRESH_BASIC = "internal/windows/feishu_chat/refresh/basic";
const FEISHU_CHAT_SEARCH_BASIC = "internal/windows/feishu_chat/search/basic";
const FEISHU_CHAT_SEND_BASIC = "internal/windows/feishu_chat/send/basic";
const FEISHU_CHAT_SEND_DRY_RUN = "internal/windows/feishu_chat/send/dry_run_required";
const FEISHU_CHAT_REPLY_BASIC = "internal/windows/feishu_chat/reply/basic";
const FEISHU_CHAT_SUBSCRIBE_BASIC = "internal/windows/feishu_chat/subscribe/basic";
const FEISHU_CHAT_CLOSE_BASIC = "internal/windows/feishu_chat/close/basic";

const MAX_RENDER_BYTES = 8192;
const DEFAULT_TAIL = 30;
// lark-cli +chat-messages-list 的 --page-size 上限 50（见 lark-cli im +chat-messages-list --help）；
// 走分页才能拉更多，本期不做。
const MAX_TAIL = 50;

const PROTOCOL_KNOWLEDGE = `
feishu_chat_window 是 OOC 与飞书群聊 / 单聊之间的 ContextWindow。

每个 chat_id 对应一个 window 实例。窗口持有最近 buffer（messages 切片），
LLM 通过下列 command 操作；窗口本身不直接显示历史消息全文，过长会截断。

可用 command：
- refresh：拉最新 N 条（无副作用；改 mode=tail）
- search：本群关键字搜索（无副作用；切 mode=search）
- send：发新消息（**有副作用，强制 dry-run gate**）
- reply：引用回复某条消息（**有副作用，强制 dry-run gate**）
- subscribe：登记周期 refresh 意愿（仅写字段；poller 集成 TBD）
- close：释放本 window

身份约定（supervisor 决策）：
- send / reply 默认 \`--as bot\`，需要显式 args.as="user" 才切回个人身份。
- refresh / search / subscribe 默认 \`--as user\`（飞书搜索通常需要 user scope）。

数据返回：buffer 里每条消息含 message_id / sender / text / replyTo。
富类型（card / image / file）目前折叠为 [card] / [image] / [file] 占位。
`.trim();

const REFRESH_KNOWLEDGE = `
feishu_chat.refresh 拉取本群最近的消息到 window.buffer。

参数：
- count: 可选，期望条数，1..${MAX_TAIL}，缺省 ${DEFAULT_TAIL}
- since_message_id: 可选，从该 id **之后**增量拉（用于轮询订阅）

调用：open(parent_window_id="<feishu_chat_window_id>", command="refresh", args={ count: 50 })

副作用：仅本地 window 字段更新；不发飞书消息。
`.trim();

const SEARCH_KNOWLEDGE = `
feishu_chat.search 在本群范围内按关键字搜索消息，临时把 window 切到 mode=search。

参数：
- query: 必填，搜索关键字（飞书算子如 from: / has:link / time:YYYY-MM-DD 可用）
- limit: 可选，最多返回条数，1..${MAX_TAIL}，缺省 30

调用：open(parent_window_id="<feishu_chat_window_id>", command="search", args={ query: "OOC 灰度", limit: 20 })

切回最近消息：refresh（任意参数）。
`.trim();

const SEND_KNOWLEDGE = `
feishu_chat.send 在本群发一条新消息。**强制 dry-run gate**（supervisor 决策）：

第一次 submit（默认 args.confirm 不设或为 false）：
- 只走 lark-cli --dry-run 预览，**不真的发**
- 把预览结果作为 result 写回 form

第二次 submit（必须 args.confirm=true）：
- 真正下发。
- 默认 \`--as bot\`；如需个人身份，显式 args.as="user"（注意权限风险）。

参数：
- text: 必填，纯文本（飞书 markdown 子集；@ 用 <at user_id="..."> ... </at>，详见 feishu_message_grammar 知识）
- as: 可选，"bot" | "user"，缺省 bot
- confirm: 必须 true 才真发；首次 submit 通常省略以触发 dry-run 预览
- msg_type: 可选，缺省 "text"；如需富文本卡片走 raw API，本 command 暂不直接支持

调用流程：
1. open(parent_window_id="<feishu_chat_window_id>", command="send", args={ text: "..." })
2. submit(form_id) → 看 dry_run 预览
3. refine(form_id, { confirm: true }) → submit(form_id) → 真发
`.trim();

const SEND_DRY_RUN_KNOWLEDGE = `
当前 send form 还未走过 dry-run 预览，或 args.confirm !== true。
若已经看过 dry-run 预览且确认要发，请 refine(form_id, args={ confirm: true }) 后再 submit。
`.trim();

const REPLY_KNOWLEDGE = `
feishu_chat.reply 引用某条消息回复。dry-run gate 同 send。

参数：
- reply_to: 必填，被回复的 message_id（om_xxx，可从 buffer 拷贝）
- text: 必填，回复正文
- as: 可选，缺省 bot
- confirm: 必须 true 才真发；首次 submit 触发 dry-run 预览
`.trim();

const SUBSCRIBE_KNOWLEDGE = `
feishu_chat.subscribe 把本 window 标记为"希望被 poller 周期 refresh"。

参数：
- interval_ms: 期望 refresh 间隔，>=10000；0 表示取消订阅

当前阶段：仅写字段（window.subscribePollIntervalMs），poller 集成尚未接通；
该窗口只有在 LLM 显式 refresh 时才会拉新消息。订阅意愿仍然写盘以备 future poller 拉起。
`.trim();

const CLOSE_KNOWLEDGE = `
feishu_chat.close 释放 window；不影响飞书一侧的消息或会话。
`.trim();

// ─────────────────────────── guidance helper ────────────────────────────

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

// ─────────────────────────── command 实现 ────────────────────────────

const refreshCommand: ObjectMethod = {
  paths: ["refresh"],
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return guidanceWindows(form, { [FEISHU_CHAT_REFRESH_BASIC]: REFRESH_KNOWLEDGE });
  },
  exec: (ctx) => executeRefresh(ctx),
};

const searchCommand: ObjectMethod = {
  paths: ["search"],
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return guidanceWindows(form, { [FEISHU_CHAT_SEARCH_BASIC]: SEARCH_KNOWLEDGE });
  },
  exec: (ctx) => executeSearch(ctx),
};

const sendCommand: ObjectMethod = {
  paths: ["send"],
  intent: (args) => (args.confirm === true ? [{ name: "send.confirmed" }] : []),
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : (form as any).accumulatedArgs ?? {};
    const entries: Record<string, string> = { [FEISHU_CHAT_SEND_BASIC]: SEND_KNOWLEDGE };
    if (form.status === "open" && args.confirm !== true) {
      entries[FEISHU_CHAT_SEND_DRY_RUN] = SEND_DRY_RUN_KNOWLEDGE;
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeSend(ctx),
};

const replyCommand: ObjectMethod = {
  paths: ["reply"],
  intent: (args) => (args.confirm === true ? [{ name: "reply.confirmed" }] : []),
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : (form as any).accumulatedArgs ?? {};
    const entries: Record<string, string> = { [FEISHU_CHAT_REPLY_BASIC]: REPLY_KNOWLEDGE };
    if (form.status === "open" && args.confirm !== true) {
      entries[FEISHU_CHAT_SEND_DRY_RUN] = SEND_DRY_RUN_KNOWLEDGE;
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeReply(ctx),
};

const subscribeCommand: ObjectMethod = {
  paths: ["subscribe"],
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return guidanceWindows(form, { [FEISHU_CHAT_SUBSCRIBE_BASIC]: SUBSCRIBE_KNOWLEDGE });
  },
  exec: (ctx) => executeSubscribe(ctx),
};

const closeCommand: ObjectMethod = {
  paths: ["close"],
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return guidanceWindows(form, { [FEISHU_CHAT_CLOSE_BASIC]: CLOSE_KNOWLEDGE });
  },
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

builtinRegistry.registerObjectType("feishu_chat", {
  methods: {
    refresh: refreshCommand,
    search: searchCommand,
    send: sendCommand,
    reply: replyCommand,
    subscribe: subscribeCommand,
    close: closeCommand,
  },
  renderXml: renderFeishuChat,
  basicKnowledge: PROTOCOL_KNOWLEDGE,
});
