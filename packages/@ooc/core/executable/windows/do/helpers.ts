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
 * 子→父 reply 协议（root cause #1 dogfooding 闭环）：
 *
 * 当 do_window.continue 由子 thread 在自身 creator do_window 上调用时，
 * targetThreadId 指向**祖先**而非后裔。先尝试 findChild（兼容 parent→child 用法）；
 * 没找到再沿 \`_parentThreadRef\` 链向上查找。
 *
 * 为什么不只走 _parentThreadRef：parent→child 仍是主要场景（父调 do_window.continue
 * 给已知子）；保留 findChild 路径无成本。
 *
 * _parentThreadRef 是运行时反向引用（root.do 创建 child 时建立，见
 * windows/root/command.do.ts:201），不参与持久化；磁盘恢复的 thread 没有这条链，
 * 此时子→父 reply 仍可能失败——recovery 路径的 supplement 由 persistable 层负责。
 */
export function findThreadInScope(self: ThreadContext, targetId: string): ThreadContext | null {
  // 向下：自身 + 后裔
  const downward = findChild(self, targetId);
  if (downward) return downward;
  // 向上：沿 _parentThreadRef 链
  let cur: ThreadContext | undefined = self._parentThreadRef;
  while (cur) {
    if (cur.id === targetId) return cur;
    // 上层的 sibling 子树也应可达（罕见但合法：grandchild → 兄弟节点 reply）
    const sibling = findChild(cur, targetId);
    if (sibling) return sibling;
    cur = cur._parentThreadRef;
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
  // batch C narrowing(N4): contextWindows 契约层是 base[]；narrow 回 union[] 以构造 union 副本
  // 并推入 union 数组（runtime 即 union 实例）。
  const childWindows = (child.contextWindows ?? []) as ContextWindow[];
  const parentWindows = (parent.contextWindows ?? []) as ContextWindow[];
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
