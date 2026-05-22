/**
 * do_window 内部 helper —— 跨 command 共享的工具函数。
 */

import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { DoWindow } from "../_shared/types.js";

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
    source: "do",
  };
}

export function appendInbox(thread: ThreadContext, message: ThreadMessage): void {
  thread.inbox = [...(thread.inbox ?? []), message];
  thread.events = [
    ...thread.events,
    { category: "context_change", kind: "inbox_message_arrived", msgId: message.id },
  ];
}

/** 在父 thread 的子树里按 id 找子线程。 */
export function findChild(parent: ThreadContext, childId: string): ThreadContext | null {
  if (parent.id === childId) return parent;
  for (const child of Object.values(parent.childThreads ?? {})) {
    const found = findChild(child, childId);
    if (found) return found;
  }
  return null;
}

export function archiveDoWindowChild(thread: ThreadContext | undefined, window: DoWindow): void {
  if (!thread) return;
  const child = findChild(thread, window.targetThreadId);
  if (!child) return;
  if (child.status === "running" || child.status === "waiting") {
    child.status = "paused";
  }
}
