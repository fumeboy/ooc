/**
 * talk fork —— talk(target=自己 objectId) 派生子线程的机制（旧 do_window 并入）。
 *
 * fork 子线程窗（isForkWindow=true）是同对象内的父子双向通道：
 * - `say` 走内存树寻址（findThreadInScope，同 session 同 job、不付磁盘 IO）
 * - close / archive：把子线程标记为 paused
 *
 * Wave 4：share 的 owner 借/还机制（依赖每窗 sharing 字段 = SharingState）随对象模型重构删除，
 * 故 archive 不再做 returnBorrowedOwners；window 引用借/还语义在 OocObjectInstance 模型下待重设计。
 */

import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { TalkWindowView } from "./types.js";

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

/** archive fork 子线程窗对应的子线程（close / onClose 复用）。 */
export function archiveForkChild(thread: ThreadContext | undefined, window: TalkWindowView): void {
  if (!thread) return;
  const targetThreadId = window.targetThreadId;
  if (!targetThreadId) return;
  const child = findChild(thread, targetThreadId);
  if (!child) return;
  if (child.status === "running" || child.status === "waiting") {
    child.status = "paused";
  }
}
