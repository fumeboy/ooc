/**
 * background worker —— 后台循环驱动 scheduler。
 *
 * 设计最简：每个 sessionId 一条 worker；接收 enqueue 信号即跑一轮 scheduler.runScheduler。
 * 避免 busy-loop：waiting 或无 running thread 时回到等待，由 enqueue 唤醒。
 */
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import { runScheduler } from "@ooc/builtins/agent/thread/thinkable/index.js";
import { persistSession } from "@ooc/core/persistable/runtime-object-io.js";
import { observeLog } from "@ooc/core/observable/index.js";

interface WorkerState {
  sessionId: string;
  llm: LlmClient;
  baseDir: string;
  busy: boolean;
  pending: boolean;
}

const workers = new Map<string, WorkerState>();

/** 给 session 入队一次调度信号；已 busy 则置 pending 等当前 tick 结束再跑一次。 */
export async function enqueueScheduler(
  sessionId: string,
  llm: LlmClient,
  baseDir: string,
): Promise<void> {
  let w = workers.get(sessionId);
  if (!w) {
    w = { sessionId, llm, baseDir, busy: false, pending: false };
    workers.set(sessionId, w);
  }
  if (w.busy) {
    w.pending = true;
    return;
  }
  await runOnce(w);
}

async function runOnce(w: WorkerState): Promise<void> {
  w.busy = true;
  try {
    await runScheduler(w.sessionId, w.llm, {
      maxTicks: 15,
      worldDir: w.baseDir,
      onDataEdit: async () => {
        await persistSession(w.baseDir, w.sessionId);
      },
    });
    // 每轮 tick 结束后兜底落盘
    await persistSession(w.baseDir, w.sessionId);
  } catch (err) {
    observeLog("worker.runScheduler.error", `[worker] ${(err as Error).message}`);
  } finally {
    w.busy = false;
  }
  if (w.pending) {
    w.pending = false;
    await runOnce(w);
  }
}

/** worker 数（debug 用）。 */
export function workerCount(): number {
  return workers.size;
}

/** 清空所有 worker（测试 / shutdown 用）。 */
export function clearWorkers(): void {
  workers.clear();
}
