/**
 * talk-delivery — 跨对象 talk 消息派送的统一入口。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：
 *
 * 一次"派送"做以下 5 件事：
 *
 * 1. 解析 caller 与 target：caller = ctx.thread + ctx.talkWindow；target = talkWindow.target
 *    （objectId）。两者必须都带 persistence ref，且共享同一个 sessionId（跨 session talk
 *    不在本期）。
 *
 * 2. 解析或创建 callee thread：
 *    - 若 talkWindow.targetThreadId 已设置 → readThread 拿到 callee
 *    - 否则 → createFlowObject(callee) 兜底（已存在则 no-op），新建一条 thread，
 *      thread id 由派送时生成；callee 通过 initContextWindows({creatorKind:"talk"})
 *      自带一个指向 caller 的 creator talk_window
 *    - callee 创建好后 talkWindow.targetThreadId 回填，让下次 say 直接命中已有 thread
 *
 * 3. 写消息：
 *    - caller.outbox 追加一条 source（talk|user）的 ThreadMessage（windowId=caller talk_window.id）
 *    - callee.inbox 追加同一条消息（replyToWindowId=callee creator talk_window.id），
 *      并 push inbox_message_arrived 事件让 LLM 看到
 *
 * 4. callee 状态：若 callee 处于 waiting/done/failed → 翻回 running，等 worker 调度
 *
 * 5. 持久化：caller / callee 双写 thread.json
 *
 * 不在本模块负责：调度（由 worker 自然轮询）、UI 通知（控制面自己决定何时 refresh）。
 */

import { readThread, writeThread, createFlowObject } from "../../persistable/index.js";
import type { ThreadContext, ThreadMessage } from "../../thinkable/context.js";
import { initContextWindows } from "./init.js";
import { creatorWindowIdOf, type TalkWindow } from "./types.js";

export interface TalkDeliveryInput {
  caller: { thread: ThreadContext; talkWindow: TalkWindow };
  content: string;
  /** 消息来源：talk = LLM 通过 talk_window.say 发；user = 控制面代用户发。 */
  source: "talk" | "user";
}

export interface TalkDeliveryResult {
  calleeObjectId: string;
  calleeThreadId: string;
  /** 本次写入到 caller.outbox 的消息 id（也作为 callee.inbox 的对应消息 id）。 */
  messageId: string;
}

/** 生成稳定的消息 id；caller / callee 双方记录同一个 id 便于跨 thread 关联。 */
function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 生成新 callee thread 的 id。 */
function generateCalleeThreadId(callerObjectId: string): string {
  // 前缀含 caller 信息，纯做调试可读性；唯一性靠后缀
  return `t_${callerObjectId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 截断标题。 */
function deriveCalleeThreadTitle(content: string, max = 60): string {
  const trimmed = content.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

export async function deliverTalkMessage(input: TalkDeliveryInput): Promise<TalkDeliveryResult> {
  const { caller, content, source } = input;
  const callerThread = caller.thread;
  const callerWindow = caller.talkWindow;
  if (!callerThread.persistence) {
    throw new Error("caller thread has no persistence ref");
  }

  const callerRef = callerThread.persistence;
  const calleeObjectId = callerWindow.target;
  if (!calleeObjectId) throw new Error("talk_window.target is empty");

  // 1) 解析 callee thread；首条消息时创建
  let calleeThreadId = callerWindow.targetThreadId;
  let calleeThread: ThreadContext | undefined;

  if (calleeThreadId) {
    calleeThread = await readThread(
      { baseDir: callerRef.baseDir, sessionId: callerRef.sessionId, objectId: calleeObjectId },
      calleeThreadId,
    );
  }

  if (!calleeThread) {
    // 第一次派送：创建 callee object 目录（已存在则 no-op）+ 新 thread
    await createFlowObject({
      baseDir: callerRef.baseDir,
      sessionId: callerRef.sessionId,
      objectId: calleeObjectId,
    });

    calleeThreadId = generateCalleeThreadId(callerRef.objectId);
    calleeThread = {
      id: calleeThreadId,
      status: "running",
      events: [],
      contextWindows: [],
      creatorThreadId: callerThread.id,
      persistence: {
        baseDir: callerRef.baseDir,
        sessionId: callerRef.sessionId,
        objectId: calleeObjectId,
        threadId: calleeThreadId,
      },
    };
    initContextWindows(calleeThread, {
      creatorThreadId: callerThread.id,
      creatorKind: "talk",
      callerObjectId: callerRef.objectId,
      initialTaskTitle: deriveCalleeThreadTitle(content),
    });
    // 回填 caller talk_window.targetThreadId
    callerWindow.targetThreadId = calleeThreadId;
  }

  // 2) 构造消息：双方共享同一个 message id；caller 视图、callee 视图各自的 windowId 不同
  const messageId = generateMessageId();
  const calleeCreatorWindowId = creatorWindowIdOf(calleeThread.id);
  const createdAt = Date.now();

  const callerMessage: ThreadMessage = {
    id: messageId,
    fromThreadId: callerThread.id,
    toThreadId: calleeThread.id,
    content,
    createdAt,
    source,
    windowId: callerWindow.id,
  };
  const calleeMessage: ThreadMessage = {
    ...callerMessage,
    // callee 视角下，replyToWindowId = 它自己 creator talk_window，让 transcript 归位
    replyToWindowId: calleeCreatorWindowId,
  };

  callerThread.outbox = [...(callerThread.outbox ?? []), callerMessage];
  calleeThread.inbox = [...(calleeThread.inbox ?? []), calleeMessage];
  calleeThread.events = [
    ...calleeThread.events,
    { category: "context_change", kind: "inbox_message_arrived", msgId: messageId },
  ];

  // 3) callee 状态：waiting/done/failed → running；inboxSnapshotAtWait 清空
  if (calleeThread.status !== "running" && calleeThread.status !== "paused") {
    calleeThread.status = "running";
    calleeThread.inboxSnapshotAtWait = undefined;
  }

  // 4) 持久化双方
  await writeThread(callerThread);
  await writeThread(calleeThread);

  return {
    calleeObjectId,
    calleeThreadId: calleeThread.id,
    messageId,
  };
}
