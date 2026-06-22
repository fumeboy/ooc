import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";

/**
 * thread 状态简化
 * - 取消 waitingType / awaitingChildren 字段
 * - waiting 状态唯一含义 = "等待 inbox 新消息"
 * - resume 把 status 翻回 running，并清空 inboxSnapshotAtWait
 */

export function canResumeThread(thread: Pick<ThreadContext, "status">): boolean {
  return thread.status === "paused";
}

export function applyResumeTransition(thread: ThreadContext): ThreadContext {
  if (!canResumeThread(thread)) {
    return thread;
  }
  return {
    ...thread,
    status: "running",
    inboxSnapshotAtWait: undefined,
  };
}
