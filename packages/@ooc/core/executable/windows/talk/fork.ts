/**
 * talk fork —— talk(target=自己 objectId) 派生子线程的机制（旧 do_window 并入）。
 *
 * fork 子线程窗（isForkWindow=true）是同对象内的父子双向通道：
 * - `say` 走内存树寻址（findThreadInScope，同 session 同 job、不付磁盘 IO）
 * - close / archive：把子线程标记为 paused、自动归还借出的 owner windows
 * - share：跨 thread 传 window 引用（method.share.ts）
 *
 * 这些 helper 从旧 windows/do/helpers.ts 原样迁入，仅 source 标记 "do" → "fork"。
 */

import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { ContextWindow, SharingState, TalkWindow } from "../_shared/types.js";

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
 * 子→父 reply 协议：当 fork 子线程窗的 say 由子 thread 在自身 creator 窗上调用时，
 * targetThreadId 指向**祖先**而非后裔。先尝试 findChild（兼容 parent→child 用法）；
 * 没找到再沿 `_parentThreadRef` 链向上查找。
 *
 * _parentThreadRef 是运行时反向引用（fork 创建 child 时建立），不参与持久化；
 * 磁盘恢复的 thread 没有这条链，此时子→父 reply 仍可能失败——recovery 路径的
 * supplement 由 persistable 层负责。
 */
export function findThreadInScope(self: ThreadContext, targetId: string): ThreadContext | null {
  const downward = findChild(self, targetId);
  if (downward) return downward;
  let cur: ThreadContext | undefined = self._parentThreadRef;
  while (cur) {
    if (cur.id === targetId) return cur;
    const sibling = findChild(cur, targetId);
    if (sibling) return sibling;
    cur = cur._parentThreadRef;
  }
  return null;
}

/**
 * archive 子 thread 时的归还路径（share move 自动归还）：
 *
 * 在切 paused 之前，遍历 child.contextWindows
 * - 对每个 owner window（无 sharing 字段）：按 id 在父 thread.contextWindows 里查 mutable-ref shadow；
 *   若 borrowerThreadId === childId → 归还（owner 副本回写父，清父 shadow；移除子的 owner）
 * - 子原生创建的 windows / 子持有的 readonly-ref placeholder：忽略（随 child archive 自然消失）
 */
function returnBorrowedOwnersFromChild(parent: ThreadContext, child: ThreadContext): void {
  const childWindows = (child.contextWindows ?? []) as ContextWindow[];
  const parentWindows = (parent.contextWindows ?? []) as ContextWindow[];
  const remainingChildWindows: ContextWindow[] = [];
  for (const w of childWindows) {
    if (w.sharing) {
      remainingChildWindows.push(w);
      continue;
    }
    const parentIdx = parentWindows.findIndex(
      (pw) =>
        pw.id === w.id &&
        pw.sharing?.kind === "mutable-ref" &&
        pw.sharing.borrowerThreadId === child.id,
    );
    if (parentIdx >= 0) {
      const returned: ContextWindow = { ...w };
      delete (returned as { sharing?: SharingState }).sharing;
      parentWindows[parentIdx] = returned;
      continue;
    }
    remainingChildWindows.push(w);
  }
  child.contextWindows = remainingChildWindows;
  parent.contextWindows = parentWindows;
}

/** archive fork 子线程窗对应的子线程（close / onClose 复用）。 */
export function archiveForkChild(thread: ThreadContext | undefined, window: TalkWindow): void {
  if (!thread) return;
  const targetThreadId = window.targetThreadId;
  if (!targetThreadId) return;
  const child = findChild(thread, targetThreadId);
  if (!child) return;
  if (child.status === "running" || child.status === "waiting") {
    returnBorrowedOwnersFromChild(thread, child);
    child.status = "paused";
  }
}
