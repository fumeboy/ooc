import type { LlmClient } from "./llm/types";
import type { ThreadContext } from "./context";
import { think } from "./thinkloop";
import { writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";
// thread 业务 policy（blessed thread import，同 writeThread）：core scheduler 只调、不内联读 thread 业务字段。
import { emitChildEndNotifications } from "@ooc/builtins/agent/thread/executable/child-notify.js";
import { harvestSummarizerForks } from "@ooc/builtins/agent/thread/executable/compress.js";

/** Scheduler 的运行参数。 */
export interface SchedulerOptions {
  /** 单次调度最多执行多少轮，防止测试或本地运行中无限循环。 */
  maxTicks?: number;
}

/** 收集线程树中所有 running 节点，不在这里决定执行顺序。 */
function collectRunningThreads(root: ThreadContext): ThreadContext[] {
  const result: ThreadContext[] = [];

  if (root.status === "running") {
    result.push(root);
  }

  for (const child of Object.values(root.childThreads ?? {})) {
    result.push(...collectRunningThreads(child));
  }

  return result;
}

/** 找出 thread 中已结束（done/failed）的子线程，以便给父线程写入 system 通知。 */
function* iterateThreads(root: ThreadContext): Iterable<ThreadContext> {
  yield root;
  for (const child of Object.values(root.childThreads ?? {})) {
    yield* iterateThreads(child);
  }
}

/**
 * 把 waiting 状态的线程在 inbox 长度增长后翻回 running。
 *
 * 等待语义的简化：唯一唤醒规则 = inbox 出现新消息（与入眠快照对比）。
 */
function wakeWaitingThreadsOnInbox(root: ThreadContext): void {
  for (const thread of iterateThreads(root)) {
    if (thread.status !== "waiting") continue;
    const snapshot = thread.inboxSnapshotAtWait ?? 0;
    const now = thread.inbox?.length ?? 0;
    if (now > snapshot) {
      thread.status = "running";
      thread.inboxSnapshotAtWait = undefined;
      // waitingOn 与 inboxSnapshotAtWait 同生命周期；wakeup 后清空（observability 字段）
      thread.waitingOn = undefined;
    }
  }
}

/** 按 lastExecutedAt 选择最久未执行的线程，id 只用于稳定打平手。 */
function selectNextThread(threads: ThreadContext[]): ThreadContext {
  return [...threads].sort((a, b) => {
    const left = a.lastExecutedAt ?? 0;
    const right = b.lastExecutedAt ?? 0;
    if (left !== right) return left - right;
    return a.id.localeCompare(b.id);
  })[0]!;
}

/**
 * 运行线程树调度循环。
 *
 * 每个 tick：
 * 1. 把已结束的子线程通知写到父 inbox（system 消息）
 * 2. 看哪些 waiting 线程因 inbox 增长可以唤醒
 * 3. 选一个 running 线程执行一轮 think
 * 4. 若该线程携带 persistence ref，think 完成后立即落盘
 *
 * 不负责跨 Object talk、deadlock 兜底或 paused 恢复。
 *
 * harvest（compress）/ emitChildEndNotifications（child-end）是 **thread builtin policy**——
 * core scheduler 经 blessed thread import 只调、不内联读 thread 业务字段。
 */
export async function runScheduler(
  rootThread: ThreadContext,
  llmClient: LlmClient,
  options: SchedulerOptions = {}
): Promise<void> {
  const maxTicks = options.maxTicks ?? 20;

  for (let tick = 0; tick < maxTicks; tick += 1) {
    harvestSummarizerForks(rootThread);
    emitChildEndNotifications(rootThread);
    wakeWaitingThreadsOnInbox(rootThread);

    const runningThreads = collectRunningThreads(rootThread);
    if (runningThreads.length === 0) return;

    const nextThread = selectNextThread(runningThreads);
    nextThread.lastExecutedAt = Date.now();
    await think(nextThread, llmClient);
    await writeThread(nextThread);
  }
}
