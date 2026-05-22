/**
 * do_window 内部 helper —— 跨 command 共享的工具函数。
 */

import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { ContextWindow, DoWindow, SharingState } from "../_shared/types.js";

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

/**
 * archive 子 thread 时的归还路径（plan §do_window.move 自动归还）：
 *
 * 在切 child.status 之前，遍历 child.contextWindows
 * - 对每个 owner window（无 sharing 字段）：按 id 在父 thread.contextWindows 里查 lent_out 占位；
 *   若 borrowerThreadId === childId → 归还（owner 副本回写父，清父 lent_out；移除子的 owner）
 * - 子原生创建的 windows / 子持有的 ref placeholder：忽略（随 child archive 自然消失）
 *
 * 多层嵌套：本函数只在被 archive 的那一层做归还；更深层结构由各自层处理。
 */
function returnBorrowedOwnersFromChild(parent: ThreadContext, child: ThreadContext): void {
  const childWindows = child.contextWindows ?? [];
  const parentWindows = parent.contextWindows ?? [];
  const remainingChildWindows: ContextWindow[] = [];
  for (const w of childWindows) {
    if (w.sharing) {
      // sharing 状态的留在子（包括 ref placeholder，自然随 archive 消失）
      remainingChildWindows.push(w);
      continue;
    }
    // owner 状态：找父 thread 的同 id lent_out
    const parentIdx = parentWindows.findIndex(
      (pw) =>
        pw.id === w.id &&
        pw.sharing?.kind === "lent_out" &&
        pw.sharing.borrowerThreadId === child.id,
    );
    if (parentIdx >= 0) {
      // 归还：把子的 latest 内容覆写到父，清掉父的 lent_out
      // w 是 child 的 owner 副本（无 sharing）；直接复制为父的 owner
      const returned: ContextWindow = { ...w };
      delete (returned as { sharing?: SharingState }).sharing;
      parentWindows[parentIdx] = returned;
      // 子的 owner 副本不再保留（已回写）
      continue;
    }
    // 子原生 owner：留在子（archive 后自然不再被 schedule）
    remainingChildWindows.push(w);
  }
  child.contextWindows = remainingChildWindows;
  parent.contextWindows = parentWindows;
}

export function archiveDoWindowChild(thread: ThreadContext | undefined, window: DoWindow): void {
  if (!thread) return;
  const child = findChild(thread, window.targetThreadId);
  if (!child) return;
  if (child.status === "running" || child.status === "waiting") {
    // 在切 paused/archived 之前自动归还借来的 owner windows
    returnBorrowedOwnersFromChild(thread, child);
    child.status = "paused";
  }
}
