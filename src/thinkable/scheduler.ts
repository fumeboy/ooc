import type { LlmClient } from "./llm/types";
import type { ThreadContext } from "./context";
import { think } from "./thinkloop";

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

/**
 * 唤醒等待子线程完成的父线程。
 *
 * 当前只实现 waitingType=await_children；talk_sync / explicit_wait 的 inbox 唤醒
 * 由后续协作消息写入路径定义，不在本调度器里隐式补全。
 */
function wakeParentsWaitingForChildren(root: ThreadContext): void {
  for (const child of Object.values(root.childThreads ?? {})) {
    wakeParentsWaitingForChildren(child);
  }

  if (root.status !== "waiting" || root.waitingType !== "await_children") {
    return;
  }

  const awaiting = root.awaitingChildren ?? [];
  if (awaiting.length === 0) return;

  const allFinished = awaiting.every((childId) => {
    const child = root.childThreads?.[childId];
    return child && (child.status === "done" || child.status === "failed");
  });

  if (!allFinished) return;

  root.status = "running";
  root.waitingType = undefined;
  root.awaitingChildren = [];
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
 * 每个 tick 先检查可唤醒父线程，再只执行一个 running thread 的一轮 think。
 * 本函数不负责持久化、跨 Object talk、deadlock 兜底或 paused 恢复。
 */
export async function runScheduler(
  rootThread: ThreadContext,
  llmClient: LlmClient,
  options: SchedulerOptions = {}
): Promise<void> {
  const maxTicks = options.maxTicks ?? 20;

  for (let tick = 0; tick < maxTicks; tick += 1) {
    wakeParentsWaitingForChildren(rootThread);

    const runningThreads = collectRunningThreads(rootThread);
    if (runningThreads.length === 0) return;

    const nextThread = selectNextThread(runningThreads);
    nextThread.lastExecutedAt = Date.now();
    await think(nextThread, llmClient);
  }
}
