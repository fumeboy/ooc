/**
 * talk fork 消息原语 —— fork / peer / 派送共用的消息构造与 inbox 追加。
 *
 * fork 子线程窗（isForkWindow=true）是同对象内的父子双向通道；fork 的 caller-side wiring（造子 +
 * 父挂子 + 投初始消息）见 `fork.ts#openForkChild`，关 fork 子窗经 close 原语 → refcount 归 0 触发
 * thread.unactive 通知「无订阅者」（见 index.ts）。本文件只留消息原语（makeMessage / appendInbox）。
 */

import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/thread/types.js";

export function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function makeMessage(fromId: string, toId: string, content: string): ThreadMessage {
  return {
    id: generateMessageId(),
    fromThreadId: fromId,
    toThreadId: toId,
    content,
    createdAt: Date.now(),
    source: "talk",
  };
}

export function appendInbox(thread: ThreadContext, message: ThreadMessage): void {
  thread.inbox = [...(thread.inbox ?? []), message];
  thread.events = [
    ...thread.events,
    { category: "context_change", kind: "inbox_message_arrived", msgId: message.id },
  ];
}

