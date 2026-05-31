/**
 * deliverDoMessage —— do 父子线程间追加消息的共享核心（OOC-4 L6b）。
 *
 * 从 command.continue.ts 的 executeDoWindowContinue 抽出 inbox-write + done→running 重启 +
 * outbox + 可选 wait + notify 核心，去掉「挂在 do_window 上」的前提，直接按 targetThreadId 派送。
 * 这让两个调用方共享同一套行为：
 *   - root.do_continue（agent-facing）：agent 直接 do_continue(target=<threadId>, content, wait?)
 *   - do_window.continue（内部数据/end.result 路径）：仍存在，executeDoWindowContinue 改调本函数
 *
 * 方向（两种都合法，findThreadInScope 自动判别）：
 * - 父→子：target 是后裔 thread；findThreadInScope 向下 findChild 命中。
 * - 子→父：target 是祖先 thread；findThreadInScope 沿运行时 _parentThreadRef 上行命中。
 *   （reload 后的树由 readThread 的 persistable supplement 重建 _parentThreadRef，见 thread-json.ts。）
 *
 * Critical 4 兜底：当 findThreadInScope 失败、但 target === thread.parentThreadId（典型：
 * truly-standalone child 经 readThread(childId) 单独加载，没有 parent 子树 + 没有 _parentThreadRef）
 * 时，不静默丢消息——notifyThreadActivated 把 parent 入队（worker 会 readThread(parentId)，
 * 经 scheduler.emitChildEndNotifications 从 child status 学到回报语义），并返回 explicit 提示串。
 */

import { notifyThreadActivated } from "../../../observable/index.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import { appendInbox, findThreadInScope, makeMessage } from "./helpers.js";

/**
 * 向 targetThreadId 指向的对端线程追加一条 do 消息。
 *
 * @returns undefined 表示成功；非空 string 表示 explicit 失败原因（调用方据此回显给 agent / 写 events）。
 */
export function deliverDoMessage(
  thread: ThreadContext,
  targetThreadId: string,
  content: string,
  wait: boolean,
): string | undefined {
  if (!targetThreadId) return "[do_continue] 缺少目标线程 id。";
  if (!content) return "[do_continue] 缺少消息内容。";

  const target = findThreadInScope(thread, targetThreadId);

  if (!target) {
    // Critical 4 兜底：target 是本 thread 的 parent，但当前内存树里上行不可达
    // （truly-standalone child 单独 reload，无 parent 子树/无 _parentThreadRef）。
    if (
      targetThreadId === thread.parentThreadId &&
      thread.persistence
    ) {
      notifyThreadActivated({
        sessionId: thread.persistence.sessionId,
        objectId: thread.persistence.objectId,
        threadId: targetThreadId,
      });
      return (
        `[do_continue] 目标 parent 线程 ${targetThreadId} 不在当前内存线程树里（已 reload 为独立线程）；` +
        `已通知 runtime 调度 parent，由它经子线程状态学到本次回报。`
      );
    }
    return `[do_continue] 找不到目标线程 ${targetThreadId}。`;
  }

  const message = makeMessage(thread.id, targetThreadId, content);
  appendInbox(target, message);
  if (target.status === "done" || target.status === "failed") {
    target.status = "running";
  }
  thread.outbox = [...(thread.outbox ?? []), message];

  if (wait) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
    thread.waitingOn = targetThreadId;
  }

  // 父→子 / 子→父 inbox 写入后通知 runtime 入队 target（target 与本 thread 同 thread.json
  // 时 target.persistence 可能缺失——此时无需通知，下一轮 runJob 自然处理）。
  if (target.persistence) {
    notifyThreadActivated({
      sessionId: target.persistence.sessionId,
      objectId: target.persistence.objectId,
      threadId: target.id,
    });
  }
  return undefined;
}
