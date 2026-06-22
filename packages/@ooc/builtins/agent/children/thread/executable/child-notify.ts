/**
 * child-notify —— thread 子线程终态 → 父线程通知（onChildTerminal 退潮：从 core scheduler 搬入 thread builtin）。
 *
 * 这是 thread 自己的业务 policy：读子线程的业务字段（endSummary / endReason / isSummarizer）、
 * 往父 thread 的 inbox 写一条 child-end system marker。core scheduler 每 tick 调 `emitChildEndNotifications`
 * （blessed thread import，同 writeThread），但**不再内联读 thread 业务字段**——业务读写收在本文件。
 *
 * 唤醒机制不变：写 marker 进父 inbox（inbox 增长）→ core scheduler.wakeWaitingThreadsOnInbox 翻 running。
 * 「调度重投影、零副本」refinement 归 thread-as-referencable-object（与 say 读侧重投影同一能力）。
 *
 * 幂等：同一 (parentId, childId, 本次 end 实例=child.lastExecutedAt) 只写一次。
 */
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";
import { makeMessage } from "@ooc/builtins/agent/thread/executable/talk-fork.js";

function* iterateThreads(root: ThreadContext): Iterable<ThreadContext> {
  yield root;
  for (const child of Object.values(root.childThreads ?? {})) {
    yield* iterateThreads(child);
  }
}

/**
 * 给 waiting 父线程注入「子线程已结束」的 system 消息（done/failed 终态）。
 * summarizer fork 的终态由 compress harvest 内部回收、不在此发通知（避免污染父会话 + 双记）。
 */
export function emitChildEndNotifications(root: ThreadContext): void {
  for (const thread of iterateThreads(root)) {
    for (const child of Object.values(thread.childThreads ?? {})) {
      if (child.isSummarizer) continue;
      if (child.status !== "done" && child.status !== "failed") continue;
      // tail 区分 child 的每次 end（lastExecutedAt 在 end tick 被设上）；do_window.continue 多次 end 各唤醒一次。
      const tail = child.lastExecutedAt ?? 0;
      const marker = `[child:${child.id}:${child.status}@${tail}]`;
      const already = (thread.inbox ?? []).some((m) => m.content.startsWith(marker));
      if (already) continue;
      const summary = child.endSummary ?? "(无 summary)";
      const reason = child.endReason ?? child.status;
      const notice = {
        ...makeMessage(child.id, thread.id, `${marker} ${reason} - ${summary}`),
        source: "system" as const,
      };
      thread.inbox = [...(thread.inbox ?? []), notice];
      thread.events = [
        ...thread.events,
        { category: "context_change", kind: "inbox_message_arrived", msgId: notice.id },
      ];
    }
  }
}
