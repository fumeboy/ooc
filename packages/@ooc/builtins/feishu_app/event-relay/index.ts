/**
 * feishu event-relay — OOC 反向通道：接收飞书 IM 事件，路由到 OOC session；
 * 同时把 OOC supervisor 回 user 的消息透传回飞书 chat。
 *
 * 设计要点：
 *
 * 1. **走 SDK 而非 lark-cli event consume** — @larksuiteoapi/node-sdk 提供 WSClient
 *    长连接，毫秒级延迟；凭证（appId / appSecret）由 .world.json 提供。
 *    反向发消息也走同一 SDK Client，免去 dry-run gate，
 *    交互场景下用户在飞书等回复，dry-run 二阶段确认会让体验断流。
 *
 * 2. **session 命名约定** — `lark-chat-{chat_id}-{startTs}`：
 *    chat_id 是飞书 oc_xxx；startTs 是创建时间，便于"24h idle 切新 session"逻辑。
 *
 * 3. **反向流路径** — supervisor 跑完一轮 → 调 talk_window.say 给 user →
 *    talk-delivery 把消息塞 user.root inbox → notifyThreadActivated 触发本模块的
 *    forwardToLark：读取 user.root 的 talk_window 拿最新 supervisor 消息 →
 *    SDK client.im.message.create 发飞书。
 *
 * 4. **session 路由策略**：
 *    - chat_id 在 ROUTING map 中，且 lastSeenAt < 24h → POST /api/flows/{sid}/continue
 *    - 否则 → POST /api/sessions（target=supervisor），并把新映射写 ROUTING
 *
 * 5. **生命周期** — startLarkEventRelay 在 buildServer 启动期调；返回 stop 函数；
 *    若 .world.json 没配 LarkAppId/Secret，relay 不启动（无害）。
 */

import * as lark from "@larksuiteoapi/node-sdk";
import type { ServerConfig } from "@ooc/core/app/server/bootstrap/config.js";
import type { ThreadActivationRef } from "@ooc/core/observable";
import { readWorldConfig } from "@ooc/core/persistable";
import { readThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";

/** session 命名前缀；前端 sidebar 看到这条前缀的 session 知道是 lark inbound 起的。 */
const LARK_SESSION_PREFIX = "lark-chat-";

/** 24h idle 后新建 session。 */
const SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * chat_id ↔ session 路由表。
 *
 * 内存级（worker 进程内单实例）：
 * - 进程重启会重新建映射，但 sessionId 命名带 startTs，重启后从 .ooc-world/flows/
 *   重建。
 * - 一个 chat_id 同时只活跃一个 session；超 24h idle 即在收到新消息时新建。
 */
interface RoutingEntry {
  sessionId: string;
  chatId: string;
  chatName?: string;
  startedAt: number;
  lastSeenAt: number;
  /** 反向回复用：user.root 的 talk_window 上已经送回飞书的最后一条 messageId（由 ts+from 复合 key 标识）。 */
  lastForwardedMessageKey?: string;
}

interface RelayState {
  config: ServerConfig;
  larkClient: lark.Client;
  wsClient: lark.WSClient;
  /** chat_id → routing entry。 */
  routing: Map<string, RoutingEntry>;
  /** ws / dispatcher 是否已连。 */
  started: boolean;
}

let state: RelayState | undefined;

/**
 * 启动入口；buildServer 期调用。
 *
 * 行为：
 * - 读 .world.json，缺凭证时 console.log 提示 + 返回 noop stop 函数（不阻断 server 启动）
 * - 已有凭证时创建 SDK Client + WSClient + Dispatcher，开始监听 im.message.receive_v1
 *
 * 失败时不抛错（避免阻断 OOC server 主流程）；以 console.warn 报错。
 */
export async function startLarkEventRelay(config: ServerConfig): Promise<() => Promise<void>> {
  const cfg = await readWorldConfig(config.baseDir);
  if (!cfg.larkAppId || !cfg.larkAppSecret) {
    console.log(
      "[lark-event-relay] LarkAppId / LarkAppSecret 未配置（.world.json），relay 不启动",
    );
    return async () => {};
  }

  const larkClient = new lark.Client({
    appId: cfg.larkAppId,
    appSecret: cfg.larkAppSecret,
    appType: lark.AppType.SelfBuild,
    domain: deriveLarkDomain(cfg.larkTenantHost),
    loggerLevel: lark.LoggerLevel.warn,
  });

  const wsClient = new lark.WSClient({
    appId: cfg.larkAppId,
    appSecret: cfg.larkAppSecret,
    domain: deriveLarkDomain(cfg.larkTenantHost),
    loggerLevel: lark.LoggerLevel.warn,
  });

  const dispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (event) => {
      try {
        await handleP2MessageReceive(event);
      } catch (err) {
        console.warn(
          `[lark-event-relay] handle event failed: ${(err as Error).message}`,
        );
      }
      return { code: 0 };
    },
  });

  state = {
    config,
    larkClient,
    wsClient,
    routing: new Map(),
    started: false,
  };

  // wsClient.start 是阻塞调用；fire-and-forget 让 buildServer 同步返回。
  void wsClient
    .start({ eventDispatcher: dispatcher })
    .then(() => {
      state && (state.started = true);
      console.log("[lark-event-relay] WS connected; listening im.message.receive_v1");
    })
    .catch((err) => {
      console.warn(`[lark-event-relay] WS start failed: ${(err as Error).message}`);
    });

  return async () => {
    try {
      // SDK 没有暴露明确的 close 接口；进程退出时 socket 会随之关闭。
      console.log("[lark-event-relay] stopping (process exit will close WS)");
    } catch {
      /* ignore */
    }
    state = undefined;
  };
}

/** SDK domain：根据 .world.json 的 LarkTenantHost 派生（lark.com → Lark / 其余 → Feishu）。 */
function deriveLarkDomain(host: string): lark.Domain {
  if (host.includes("lark.com")) return lark.Domain.Lark;
  return lark.Domain.Feishu;
}

/**
 * 收到飞书消息（P2P 私信 / 群聊 @ 机器人）的核心 handler。
 *
 * 步骤：
 * 1. 解析 chat_id / message_id / text / sender_id
 * 2. 查 routing：找到且未超时 → continueSession；否则 seedSession
 * 3. 失败回信通过 SDK 直接发回飞书提示用户
 */
async function handleP2MessageReceive(event: unknown): Promise<void> {
  if (!state) return;
  const parsed = parseEvent(event);
  if (!parsed) {
    console.warn("[lark-event-relay] unrecognized event shape; skip");
    return;
  }

  const { chatId, messageId, text, senderId } = parsed;

  // visibility-first：立刻给用户消息加 👀 reaction，告诉用户"机器人已读，正在思考"。
  // GLM 单轮可能 30-60s，没有这个信号用户分不清"丢消息"和"处理中"。fire-and-forget，
  // 失败不阻断主流程。
  void ackReceived(messageId).catch(() => {/* 静默 */});

  const now = Date.now();
  let entry = state.routing.get(chatId);
  if (entry && now - entry.lastSeenAt > SESSION_IDLE_TIMEOUT_MS) {
    console.log(
      `[lark-event-relay] chat=${chatId} idle > 24h, will start new session`,
    );
    entry = undefined;
  }

  if (entry) {
    entry.lastSeenAt = now;
    await continueSession(entry.sessionId, text, chatId);
    return;
  }

  const sessionId = `${LARK_SESSION_PREFIX}${chatId}-${now.toString(36)}`;
  const newEntry: RoutingEntry = { sessionId, chatId, startedAt: now, lastSeenAt: now };
  state.routing.set(chatId, newEntry);
  await seedSession(sessionId, chatId, text, senderId);
}

/**
 * 收到消息时立刻给原消息加 👀 reaction，作为"机器人已读 / 正在思考"的轻量信号。
 *
 * 只发一次；失败时打 warn 但不阻断（典型失败原因：bot 缺 im:message.reaction
 * scope；用户拿不到 reaction 但消息处理仍正常进行）。
 */
async function ackReceived(messageId: string): Promise<void> {
  if (!state) return;
  try {
    const resp = await state.larkClient.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: "OK" } },
    });
    if (resp && resp.code !== 0) {
      console.warn(
        `[lark-event-relay] ack reaction (msg=${messageId}) failed: ${resp.msg ?? "?"} (${resp.code})`,
      );
    }
  } catch (err) {
    console.warn(
      `[lark-event-relay] ack reaction (msg=${messageId}) threw: ${(err as Error).message}`,
    );
  }
}

interface ParsedMessage {
  chatId: string;
  messageId: string;
  text: string;
  senderId: string;
}

/**
 * 把 SDK 投递的事件 payload 归一化。SDK EventDispatcher 已经解包了 OAPI envelope，
 * handler 拿到的就是内层 event 对象（含 schema / event_id / message / sender 等顶层字段，
 * 不再有外层 `event` 嵌套）。
 *
 * 关键字段：
 * - message.chat_id / message.message_id / message.content (JSON string `{"text":"..."}`)
 * - sender.sender_id.open_id
 *
 * 富类型 / 卡片 / 图片消息：本期只支持纯文本；非 text 类型记录后跳过。
 */
function parseEvent(event: unknown): ParsedMessage | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  const message = e.message as Record<string, unknown> | undefined;
  const sender = e.sender as Record<string, unknown> | undefined;
  if (!message) return null;

  const chatId = typeof message.chat_id === "string" ? message.chat_id : "";
  const messageId = typeof message.message_id === "string" ? message.message_id : "";
  const msgType = typeof message.message_type === "string" ? message.message_type : "";
  if (!chatId || !messageId) return null;

  let text = "";
  if (msgType === "text") {
    const raw = typeof message.content === "string" ? message.content : "";
    try {
      const parsed = JSON.parse(raw) as { text?: string };
      text = parsed?.text ?? "";
    } catch {
      text = raw;
    }
  } else {
    // 非纯文本（image / file / interactive / 等）—— 本期占位，告知 supervisor 类型即可。
    text = `[飞书 ${msgType} 消息，本期暂不解析内容；message_id=${messageId}]`;
  }

  const senderId =
    (sender?.sender_id as Record<string, unknown> | undefined)?.open_id as string | undefined;

  return { chatId, messageId, text, senderId: senderId ?? "unknown" };
}

/** 起新 session（target=supervisor），initial message 含飞书来源 hint。 */
async function seedSession(
  sessionId: string,
  chatId: string,
  text: string,
  senderId: string,
): Promise<void> {
  if (!state) return;
  // 给 supervisor 一个清晰 hint，让它知道这条消息来自飞书 + 怎么回。
  const initialMessage = [
    `[来自飞书 chat_id=${chatId}, sender=${senderId}]`,
    `用户消息：${text}`,
    ``,
    `回复说明：你在 OOC user.root 的 talk_window.say 给 user 的内容会自动转发到飞书 chat=${chatId}。`,
    `你不需要主动调 feishu_chat 命令；只用普通的 talk_window.say 回 user 即可。`,
  ].join("\n");

  const r = await fetch(`http://127.0.0.1:${state.config.port}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      title: `[飞书] ${chatId.slice(-8)}`,
      targetObjectId: "supervisor",
      initialMessage,
    }),
  });
  if (!r.ok) {
    const errBody = await r.text();
    console.warn(
      `[lark-event-relay] seedSession failed (${r.status}): ${errBody.slice(0, 200)}`,
    );
    return;
  }
  console.log(`[lark-event-relay] seedSession ${sessionId} for chat=${chatId}`);
}

/** 已有 session：调 /continue 追加 user message。 */
async function continueSession(
  sessionId: string,
  text: string,
  chatId: string,
): Promise<void> {
  if (!state) return;
  const r = await fetch(
    `http://127.0.0.1:${state.config.port}/api/flows/${encodeURIComponent(sessionId)}/continue`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  if (!r.ok) {
    const errBody = await r.text();
    console.warn(
      `[lark-event-relay] continueSession ${sessionId} failed (${r.status}): ${errBody.slice(0, 200)}`,
    );
    return;
  }
  console.log(`[lark-event-relay] continueSession ${sessionId} (chat=${chatId})`);
}

/**
 * buildServer 的 setThreadActivationNotifier 钩调本函数：当 lark-chat-* session 的
 * **任一 user thread** 被激活（说明 supervisor 调 talk_window.say 把消息塞进了
 * user 的 inbox），尝试把新消息透传到飞书。
 *
 * 注意：talk-delivery 在 cross-object 场景下会为每次 caller→callee 创建 callee 侧
 * 新 thread（如 t_supervisor_xxx），消息送达那个 thread 的 inbox 而非 user.root。
 * 因此本函数监听 user 名下任意 thread，不限 root。
 *
 * 由 src/app/server/index.ts 在 setThreadActivationNotifier 注册时显式调用，
 * 与原 jobManager.createRunThreadJob 并列。
 */
export function maybeForwardToLark(ref: ThreadActivationRef): void {
  if (!state) return;
  // 调试：打印所有进来的 ref，确认 notifier 是否真到达
  console.log(`[lark-event-relay] notifier called: ${ref.sessionId}/${ref.objectId}/${ref.threadId}`);
  // 仅处理 lark-chat-* session 的 user 任一 thread 激活
  if (!ref.sessionId.startsWith(LARK_SESSION_PREFIX)) return;
  if (ref.objectId !== "user") return;

  console.log(`[lark-event-relay] notifier matched lark+user: ${ref.sessionId}/${ref.threadId}`);
  // 异步处理，不阻塞 notifier
  void doForwardToLark(ref).catch((err) => {
    console.warn(
      `[lark-event-relay] forward to lark failed: ${(err as Error).message}`,
    );
  });
}

/**
 * 读 user thread 的 inbox，找 supervisor → user 的未转发消息，SDK 发回飞书。
 *
 * 用 message.id 作为去重 key（msg_xxx，OOC 内部全局唯一）；同一 chat_id 共享
 * lastForwardedMessageKey（在 routing entry 上累积），所以 user 多个 thread 的
 * inbox 都被同一去重链覆盖。
 */
async function doForwardToLark(ref: ThreadActivationRef): Promise<void> {
  if (!state) return;

  const chatId = chatIdFromSessionId(ref.sessionId);
  if (!chatId) return;
  const entry = state.routing.get(chatId);
  if (!entry) return;

  // inbox 是 per-message 目录存储（inbox-store），不在 thread.json 里——必须走
  // readThread 才能拿到 merge 后的 thread.inbox；直读 thread.json 永远是 undefined。
  let thread;
  try {
    thread = await readThread(
      { baseDir: state.config.baseDir, sessionId: ref.sessionId, objectId: ref.objectId },
      ref.threadId,
    );
  } catch (err) {
    console.warn(
      `[lark-event-relay] readThread ${ref.sessionId}/${ref.objectId}/${ref.threadId} failed: ${(err as Error).message}`,
    );
    return;
  }
  if (!thread) return; // thread 文件可能短时间不存在（race），下次激活会重试

  const newMessages: { id: string; text: string }[] = [];
  for (const m of thread.inbox ?? []) {
    if (m.fromObjectId !== "supervisor") continue;
    const id = typeof m.id === "string" ? m.id : "";
    const content = typeof m.content === "string" ? m.content : "";
    if (!id || !content) continue;
    if (entry.lastForwardedMessageKey && id <= entry.lastForwardedMessageKey) continue;
    newMessages.push({ id, text: content });
  }

  if (newMessages.length === 0) return;
  newMessages.sort((a, b) => a.id.localeCompare(b.id));

  for (const msg of newMessages) {
    await sendToLark(chatId, msg.text);
    entry.lastForwardedMessageKey = msg.id;
    console.log(
      `[lark-event-relay] forwarded msg=${msg.id} to chat=${chatId} (${msg.text.length} chars)`,
    );
  }
}

function chatIdFromSessionId(sessionId: string): string | null {
  if (!sessionId.startsWith(LARK_SESSION_PREFIX)) return null;
  const rest = sessionId.slice(LARK_SESSION_PREFIX.length);
  // 形如 oc_xxx-{startTs}；最后一个 "-" 之前是 chat_id
  const lastDash = rest.lastIndexOf("-");
  if (lastDash <= 0) return null;
  return rest.slice(0, lastDash);
}

/** SDK 发文本消息到飞书 chat。bot 凭证。 */
async function sendToLark(chatId: string, text: string): Promise<void> {
  if (!state) return;
  try {
    const resp = await state.larkClient.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    if (!resp || resp.code !== 0) {
      console.warn(
        `[lark-event-relay] send to chat=${chatId} failed: ${resp?.msg ?? "unknown"} (${resp?.code})`,
      );
    }
  } catch (err) {
    console.warn(
      `[lark-event-relay] send to chat=${chatId} threw: ${(err as Error).message}`,
    );
  }
}
