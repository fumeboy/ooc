import type { LlmClient } from "./llm/types";
import type { ThreadContext } from "./context";
import { think } from "./thinkloop";
import { writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";
// thread 业务 policy（blessed thread import，同 writeThread）：core scheduler 只调、不内联读 thread 业务字段。
import { emitChildEndNotifications } from "@ooc/builtins/agent/thread/executable/child-notify.js";
import { isSelfThreadWindow } from "../_shared/types/context-window.js";
import {
  addSummarizedRange,
  type SummarizedRange,
} from "../_shared/utils/summarized-ranges.js";

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
 */
/**
 * compress v2 —— harvest summarizer fork（每 tick 顶部，先于 emitChildEndNotifications）。
 *
 * 对每个 self-view thread 窗带 `inFlightCompress` 的线程：找其 summarizer 子线程 forkThreadId——
 * - done → 读 child.endSummary 记入父窗 `summarizedRanges{fromIdx,toIdx,summary}` + push 可见
 *   `context_compressed` 事件（silent-swallow-ban：折叠对 LLM 可见）；
 * - failed / orphan（child 不存在，crash）→ 不记 fold（clamp floor 兜底防溢出）；
 * 之后清 `inFlightCompress`（解除 force-wait）；若父在本 compress 上 waiting → 直接翻 running 唤醒
 * （内部回收，不靠 inbox 污染 / child-end 通知）。
 */
export function harvestSummarizerForks(root: ThreadContext): void {
  for (const thread of iterateThreads(root)) {
    const selfWin = thread.contextWindows?.find((w) => isSelfThreadWindow(w.id))?.win as
      | {
          summarizedRanges?: SummarizedRange[];
          inFlightCompress?: { forkThreadId: string; fromIdx: number; toIdx: number };
          autoCompressLevel?: 0 | 1 | 2;
        }
      | undefined;
    const inFlight = selfWin?.inFlightCompress;
    if (!selfWin || !inFlight) continue;
    const child = thread.childThreads?.[inFlight.forkThreadId];
    if (child && child.status !== "done" && child.status !== "failed") continue; // 还在跑
    if (child && child.status === "done") {
      const summary = (child.endSummary ?? "").trim() || "(summarizer 未产出摘要)";
      selfWin.summarizedRanges = addSummarizedRange(selfWin.summarizedRanges, {
        fromIdx: inFlight.fromIdx,
        toIdx: inFlight.toIdx,
        summary,
      });
      thread.events = [
        ...thread.events,
        {
          category: "context_change",
          kind: "context_compressed",
          levelChange: "auto-fold",
          reason: "auto-summarized",
        },
      ];
    } else if (child && child.status === "failed") {
      // summarizer fork 失败：关掉本窗自动压缩（防反复 spawn-fail livelock），插可见 note（silent-swallow-ban）；
      // 超 hard 由 buildInputItems clamp floor 兜底。agent 可再 resize 重开。
      selfWin.autoCompressLevel = 0;
      thread.events = [
        ...thread.events,
        {
          category: "context_change",
          kind: "context_compressed",
          levelChange: "auto-fold-failed",
          reason: "summarizer-fork-failed; auto-compress 已关闭，可 resize 重开",
        },
      ];
    }
    selfWin.inFlightCompress = undefined;
    if (thread.status === "waiting" && (thread.waitingOn ?? "").startsWith("compress:")) {
      thread.status = "running";
      thread.inboxSnapshotAtWait = undefined;
      thread.waitingOn = undefined;
    }
  }
}

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
