/**
 * talk-delivery — 跨对象 talk 消息派送的统一入口。
 *
 * collaborable § cross-object talk（spec 2026-05-15）；OOC-4 L5c window-free 重构：
 *
 * 核心是 window-free 的 `deliverMessage({thread, target, conversationId?, targetThreadId?,
 * content, source})`。`deliverTalkMessage(caller:{thread,talkWindow},...)` 是过渡期 adapter，
 * 从 talk_window 读出 target/targetThreadId/conversationId 后委托 deliverMessage（行为不变）。
 *
 * 一次"派送"做以下几件事：
 *
 * 1. 解析 caller 与 target：caller = thread；target = 参数 target（objectId）。
 *    **target="super" 自指别名**（spec 2026-05-18 super-flow-channel）：翻译为
 *    `(calleeObjectId = caller.objectId, calleeSessionId = "super")`——派送到自己的 super 分身。
 *
 * 2. 解析或创建 callee thread：
 *    - 若 targetThreadId 已给（来自 talk_window 或 talks.json 路由）→ readThread 拿到 callee
 *    - 否则 → createFlowObject(callee) 兜底，新建一条 thread；callee 携带
 *      creatorObjectId=caller object，initContextWindows 据此注入 creator window（L5c 前仍为
 *      talk_window；L5c 后由 talks.json 路由取代）
 *
 * 3. 写消息：caller.outbox + callee.inbox 各追加一条共享同一 id / conversationId 的 ThreadMessage。
 *
 * 4. callee 状态：waiting/done/failed → running。
 *
 * 5. 写路由：caller.talks.json[target] + callee.talks.json[caller] 各回填 targetThreadId +
 *    conversationId（持久会话路由，独立于 transient inbox）。
 *
 * 6. 持久化 caller / callee thread.json + notifyThreadActivated。
 */

import { readThread, writeThread, createFlowObject, createFlowSession, sessionMetadataFile, setTalkRoute } from "../../../persistable/index.js";
import type { FlowObjectRef } from "../../../persistable/common.js";
import { stat } from "node:fs/promises";
import { notifyThreadActivated } from "../../../observable/index.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import { initContextWindows } from "../_shared/init.js";
import { isSuperSessionId, SUPER_SESSION_ID } from "../_shared/super-constants.js";
import { creatorWindowIdOf, type TalkWindow } from "../_shared/types.js";

/** window-free 派送入参（OOC-4 L5c）。 */
export interface DeliverMessageInput {
  /** caller thread（持有 persistence ref）。 */
  thread: ThreadContext;
  /** 目标 flow object id（"user" / "super" 也合法）。 */
  target: string;
  /** 会话配对键；缺省时由派送生成（首条消息）。caller/callee 双向共享。 */
  conversationId?: string;
  /** 已知的对端 thread id（来自 talks.json 路由 / talk_window）；缺省时按需创建 callee。 */
  targetThreadId?: string;
  /** 消息正文。 */
  content: string;
  /** 消息来源：talk = LLM 通过 root.talk/say 发；user = 控制面代用户发。 */
  source: "talk" | "user";
  /**
   * （legacy / 过渡期）caller 侧 talk_window id；给出时写到 caller.outbox 消息的 windowId，
   * 让 L5c 前的 talk_window transcript（filterMessagesForTalkWindow 按 windowId 过滤）继续工作。
   * window-free caller（root.talk）不传，消息归属改用 conversationId/peerObjectId。
   */
  callerWindowId?: string;
}

/** legacy adapter 入参（从 talk_window 读路由）。 */
export interface TalkDeliveryInput {
  caller: { thread: ThreadContext; talkWindow: TalkWindow };
  content: string;
  source: "talk" | "user";
}

export interface TalkDeliveryResult {
  calleeObjectId: string;
  calleeThreadId: string;
  /** 本次写入到 caller.outbox 的消息 id（也作为 callee.inbox 的对应消息 id）。 */
  messageId: string;
  /** 本次会话配对键（caller/callee 双向共享）。 */
  conversationId: string;
}

/** 生成稳定的消息 id；caller / callee 双方记录同一个 id 便于跨 thread 关联。 */
function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 生成会话配对键（caller/callee 双向共享）。 */
function generateConversationId(callerObjectId: string, target: string): string {
  return `conv_${callerObjectId}_${target}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 生成新 callee thread 的 id。 */
function generateCalleeThreadId(callerObjectId: string): string {
  return `t_${callerObjectId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 截断标题。 */
function deriveCalleeThreadTitle(content: string, max = 60): string {
  const trimmed = content.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

/** 对象级 FlowObjectRef（用于 talks.json 路由写）。 */
function objectRef(baseDir: string, sessionId: string, objectId: string, stonesBranch?: string): FlowObjectRef {
  return { baseDir, sessionId, objectId, stonesBranch };
}

/**
 * window-free 跨对象派送核心（OOC-4 L5c）。
 *
 * caller 不需持有 talk_window；target/targetThreadId/conversationId 由参数（来自 talks.json
 * 路由或调用方）给出。其余 5 件事（解析/创建 callee、双写消息、翻 callee 状态、写双向路由、
 * 持久化 + notify）与旧 deliverTalkMessage 等价。
 */
export async function deliverMessage(input: DeliverMessageInput): Promise<TalkDeliveryResult> {
  const { thread: callerThread, target: rawTarget, content, source } = input;
  if (!callerThread.persistence) {
    throw new Error("caller thread has no persistence ref");
  }
  if (!rawTarget) throw new Error("deliverMessage target is empty");

  const callerRef = callerThread.persistence;
  const stonesBranch = callerRef.stonesBranch;
  const isSuperAlias = isSuperSessionId(rawTarget);
  const calleeObjectId = isSuperAlias ? callerRef.objectId : rawTarget;
  const calleeSessionId = isSuperAlias ? SUPER_SESSION_ID : callerRef.sessionId;

  // 会话配对键：参数给则用，否则生成（首条消息）
  const conversationId = input.conversationId ?? generateConversationId(callerRef.objectId, rawTarget);

  // 1) 解析 callee thread；首条消息时创建
  let calleeThreadId = input.targetThreadId;
  let calleeThread: ThreadContext | undefined;

  if (calleeThreadId) {
    calleeThread = await readThread(
      { baseDir: callerRef.baseDir, sessionId: calleeSessionId, objectId: calleeObjectId },
      calleeThreadId,
    );
  }

  if (!calleeThread) {
    if (isSuperAlias && !(await pathExists(sessionMetadataFile(callerRef.baseDir, SUPER_SESSION_ID)))) {
      await createFlowSession(callerRef.baseDir, SUPER_SESSION_ID, "OOC self-reflection");
    }

    await createFlowObject({
      baseDir: callerRef.baseDir,
      sessionId: calleeSessionId,
      objectId: calleeObjectId,
    });

    calleeThreadId = generateCalleeThreadId(callerRef.objectId);
    calleeThread = {
      id: calleeThreadId,
      status: "running",
      events: [],
      contextWindows: [],
      creatorThreadId: callerThread.id,
      creatorObjectId: callerRef.objectId,
      // C5（2026-05-25）：cross-session 派送时记录 caller 的 sessionId
      creatorSessionId: callerRef.sessionId,
      persistence: {
        baseDir: callerRef.baseDir,
        sessionId: calleeSessionId,
        objectId: calleeObjectId,
        threadId: calleeThreadId,
      },
    };
    initContextWindows(calleeThread, {
      creatorThreadId: callerThread.id,
      initialTaskTitle: deriveCalleeThreadTitle(content),
    });
  }

  // legacy 回填：若 caller 仍持有对应 talk_window，把 targetThreadId 写回它（在
  // writeThread(callerThread) 之前），让 talk_window 持久化路由 + listThreads talkPeers
  // 提取与旧行为一致。window-free caller（root.talk）不传 callerWindowId，跳过。
  if (input.callerWindowId) {
    const cw = (callerThread.contextWindows ?? []).find(
      (w): w is TalkWindow => w.type === "talk" && w.id === input.callerWindowId,
    );
    if (cw && !cw.targetThreadId) cw.targetThreadId = calleeThread.id;
  }

  // 2) 构造消息：双方共享同一个 message id + conversationId
  const messageId = generateMessageId();
  const calleeReplyToWindowId = resolveCalleeReplyToWindowId(calleeThread, callerThread.id, callerRef.objectId);
  const createdAt = Date.now();

  const callerMessage: ThreadMessage = {
    id: messageId,
    fromThreadId: callerThread.id,
    toThreadId: calleeThread.id,
    fromObjectId: callerRef.objectId,
    content,
    createdAt,
    source,
    conversationId,
    peerObjectId: rawTarget,
    // legacy talk_window transcript 过滤靠 windowId；window-free caller 不传则缺省。
    ...(input.callerWindowId ? { windowId: input.callerWindowId } : {}),
  };
  const calleeMessage: ThreadMessage = {
    ...callerMessage,
    // callee 视角下,该消息的对端是 caller（用于自视 talk 切片按 peer 分组）。
    peerObjectId: callerRef.objectId,
    // legacy（L5c 前 talk_window transcript 仍读 replyToWindowId）：保留路由标记。
    replyToWindowId: calleeReplyToWindowId,
  };

  callerThread.outbox = [...(callerThread.outbox ?? []), callerMessage];
  calleeThread.inbox = [...(calleeThread.inbox ?? []), calleeMessage];
  calleeThread.events = [
    ...calleeThread.events,
    { category: "context_change", kind: "inbox_message_arrived", msgId: messageId },
  ];

  // 3) callee 状态：waiting/done/failed → running；inboxSnapshotAtWait / waitingOn 清空
  if (calleeThread.status !== "running" && calleeThread.status !== "paused") {
    calleeThread.status = "running";
    calleeThread.inboxSnapshotAtWait = undefined;
    calleeThread.waitingOn = undefined;
  }

  // 4) 持久化双方 thread.json
  await writeThread(callerThread);
  await writeThread(calleeThread);

  // 5) 写双向 talks.json 路由（持久会话路由，独立于 transient inbox）：
  //    - caller.talks.json[target]   → 指向 callee thread
  //    - callee.talks.json[caller]   → 指向 caller thread（callee 回信时按它路由回 caller）
  //    super alias 下 caller 与 callee 都是同一 object（不同 session），路由 key 仍用 rawTarget /
  //    callerRef.objectId 区分语义。
  await setTalkRoute(
    objectRef(callerRef.baseDir, callerRef.sessionId, callerRef.objectId, stonesBranch),
    rawTarget,
    { targetThreadId: calleeThread.id, conversationId },
  );
  await setTalkRoute(
    objectRef(callerRef.baseDir, calleeSessionId, calleeObjectId, stonesBranch),
    callerRef.objectId,
    { targetThreadId: callerThread.id, conversationId },
  );

  // 6) 状态翻转 → 通知 runtime。
  notifyThreadActivated({
    sessionId: calleeSessionId,
    objectId: calleeObjectId,
    threadId: calleeThread.id,
  });

  return {
    calleeObjectId,
    calleeThreadId: calleeThread.id,
    messageId,
    conversationId,
  };
}

/**
 * Legacy adapter：从 caller 的 talk_window 读出路由后委托 window-free deliverMessage。
 *
 * 过渡期保留（service.ts user 入口 / 残留 caller）；行为与旧实现等价。
 * 派送后把 callee thread id 回填到 talk_window.targetThreadId（保持旧语义）。
 */
export async function deliverTalkMessage(input: TalkDeliveryInput): Promise<TalkDeliveryResult> {
  const { caller, content, source } = input;
  const callerWindow = caller.talkWindow;
  const rawTarget = callerWindow.target;
  if (!rawTarget) throw new Error("talk_window.target is empty");

  const result = await deliverMessage({
    thread: caller.thread,
    target: rawTarget,
    conversationId: callerWindow.conversationId,
    targetThreadId: callerWindow.targetThreadId,
    content,
    source,
    callerWindowId: callerWindow.id,
  });

  // 回填 caller talk_window.targetThreadId，让下次 say 直接命中已有 thread。
  callerWindow.targetThreadId = result.calleeThreadId;
  return result;
}

/**
 * 在 callee 的 contextWindows 里找出"这条入站消息归属的 talk_window id"。
 *
 * legacy：window-free 派送下消息归属改用 conversationId/peerObjectId；本函数仅在
 * callee 仍持有 talk_window 时（L5c 前 / 过渡期）给 replyToWindowId 一个合理值。
 * callee 无任何 talk_window 时回退到 creator window 派生 id（无害占位）。
 */
function resolveCalleeReplyToWindowId(
  calleeThread: ThreadContext,
  callerThreadId: string,
  callerObjectId: string,
): string {
  const windows = (calleeThread.contextWindows ?? []).filter(
    (w): w is TalkWindow => w.type === "talk",
  );
  const byThreadId = windows.find((w) => w.targetThreadId === callerThreadId);
  if (byThreadId) return byThreadId.id;
  const byObjectId = windows.find((w) => w.target === callerObjectId);
  if (byObjectId) return byObjectId.id;
  return creatorWindowIdOf(calleeThread.id);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
