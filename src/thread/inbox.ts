/**
 * inbox 清理策略
 *
 * 规则（来自 Spec Section 3.3）：
 * - unread 上限 50 条，超过时自动 mark(ignore, "inbox 溢出") 最早的消息
 * - marked 消息超过 200 条时，自动清理最早的 marked 消息（保留最近 100 条）
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#3.3
 */

import type { ThreadInboxMessage } from "./types.js";

/** unread 消息上限 */
const UNREAD_LIMIT = 50;
/** marked 消息触发清理的阈值 */
const MARKED_CLEANUP_THRESHOLD = 200;
/** marked 消息清理后保留的数量 */
const MARKED_KEEP_COUNT = 100;

/** 清理结果 */
export interface InboxCleanupResult {
  /** 清理后的完整 inbox */
  cleaned: ThreadInboxMessage[];
  /** 本次因溢出被自动 mark(ignore) 的消息（用于日志/通知） */
  overflowed: ThreadInboxMessage[];
}

/**
 * 执行 inbox 清理策略
 *
 * 不修改原数组，返回新数组（不可变）。
 *
 * S1: 调用时机说明：
 * - 主要调用点：ThreadsTree.writeInbox() 内部已内置溢出处理逻辑（见 tree.ts），
 *   每次写入 inbox 消息后自动执行 unread 溢出和 marked 清理。
 * - collaboration.ts 的 executeTalk / executeReplyToFlow / commentOnIssueWithNotify
 *   统一通过 tree.writeInbox() 写入消息，无需手动调用 enforceInboxLimits。
 * - 本函数作为独立工具函数导出，供以下场景使用：
 *   1. Context 构建前兜底清理（确保渲染时 inbox 不超限）
 *   2. 单元测试中直接验证清理逻辑
 *
 * @param inbox - 当前 inbox 消息列表
 * @returns 清理结果
 */
export function enforceInboxLimits(inbox: ThreadInboxMessage[]): InboxCleanupResult {
  const overflowed: ThreadInboxMessage[] = [];

  /* 第一步：处理 unread 溢出 */
  const unread = inbox.filter((m) => m.status === "unread");
  const marked = inbox.filter((m) => m.status === "marked");

  let newUnread = [...unread];
  let newMarked = [...marked];

  if (newUnread.length > UNREAD_LIMIT) {
    /* 按 timestamp 升序排列，最早的先溢出 */
    newUnread.sort((a, b) => a.timestamp - b.timestamp);
    const overflowCount = newUnread.length - UNREAD_LIMIT;
    const overflowMsgs = newUnread.splice(0, overflowCount);

    /* 溢出消息自动 mark(ignore) */
    const now = Date.now();
    for (const msg of overflowMsgs) {
      const markedMsg: ThreadInboxMessage = {
        ...msg,
        status: "marked",
        mark: { type: "ignore", tip: "inbox 溢出", markedAt: now },
      };
      newMarked.push(markedMsg);
      overflowed.push(markedMsg);
    }
  }

  /* 第二步：处理 marked 溢出 */
  if (newMarked.length > MARKED_CLEANUP_THRESHOLD) {
    newMarked.sort((a, b) => a.timestamp - b.timestamp);
    newMarked = newMarked.slice(newMarked.length - MARKED_KEEP_COUNT);
  }

  /* 合并并按 timestamp 排序 */
  const cleaned = [...newMarked, ...newUnread].sort((a, b) => a.timestamp - b.timestamp);

  return { cleaned, overflowed };
}
