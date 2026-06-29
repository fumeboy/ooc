/**
 * background worker —— 后台循环驱动 scheduler。
 *
 * 设计最简：每个 sessionId 一条 worker；接收 enqueue 信号即跑一轮 scheduler.runScheduler。
 * 避免 busy-loop：waiting 或无 running thread 时回到等待，由 enqueue 唤醒。
 *
 * **issue F1 (2026-06-29)**：加 `reloadTable` opt 透传 — 经 scheduler → thinkable.think →
 * ThreadRuntime → maybeDispatchOnReload，兑现 lifecycle.on_reload 在生产 server 的派发。
 *
 * **issue S7 (2026-06-29)**: 加 job-manager 集成。enqueueScheduler 返 `{ jobId }` 让
 * HTTP 控制面前端拿到 job id 用于 polling 状态。runOnce 内 startJob/finishJob 推进
 * job 状态机 (queued → running → done|failed)。
 */
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import type { ReloadTable } from "@ooc/core/runtime/reload-table.js";
import { runScheduler } from "@ooc/builtins/agent/children/thread/thinkable/index.js";
import { persistSession } from "@ooc/core/persistable/runtime-object-io.js";
import { observeLog } from "@ooc/core/observable/index.js";
import { isGlobalPaused, isSessionPaused } from "./pause-store.js";
import { createJob, startJob, finishJob } from "./job-manager.js";
import { writeLoopDebug } from "./loop-debug.js";

interface WorkerState {
  sessionId: string;
  llm: LlmClient;
  baseDir: string;
  /** lifecycle on_reload 派发标记表（issue F1）。 */
  reloadTable?: ReloadTable;
  busy: boolean;
  pending: boolean;
  /** 当前正在推进的 jobId (run-thread); pending 信号会派生新 job。 */
  currentJobId?: string;
  /** pending 信号待消费的 jobId (busy 期间 enqueue 触发的新 job)。 */
  pendingJobId?: string;
}

const workers = new Map<string, WorkerState>();

/**
 * 给 session 入队一次调度信号；已 busy 则置 pending 等当前 tick 结束再跑一次。
 *
 * 返回 `{ jobId }` (S7 集成) — 即使 paused / no-op 也返回 jobId, 状态会即时 finish 为 done
 * (与 S4 pause 语义对齐: pause 不抛 error,只跳过入队,job 视为已完成的 no-op)。
 */
export async function enqueueScheduler(
  sessionId: string,
  llm: LlmClient,
  baseDir: string,
  reloadTable?: ReloadTable,
): Promise<{ jobId: string }> {
  // S4 + S8: pause 闸 — 命中即不入队, 但仍 return job (no-op job, status=done)
  if (isGlobalPaused() || isSessionPaused(sessionId)) {
    const job = createJob("run-thread", sessionId);
    finishJob(job.id, true); // done immediately (paused, no work)
    return { jobId: job.id };
  }
  let w = workers.get(sessionId);
  if (!w) {
    w = { sessionId, llm, baseDir, reloadTable, busy: false, pending: false };
    workers.set(sessionId, w);
  }
  const job = createJob("run-thread", sessionId);
  if (w.busy) {
    w.pending = true;
    w.pendingJobId = job.id;
    // job 进入 queued 状态, 等 runOnce pending pass 处理 (会 startJob/finishJob)
    return { jobId: job.id };
  }
  w.currentJobId = job.id;
  await runOnce(w);
  return { jobId: job.id };
}

async function runOnce(w: WorkerState): Promise<void> {
  w.busy = true;
  const jobId = w.currentJobId;
  if (jobId) startJob(jobId);
  let ok = true;
  let errMsg: string | undefined;
  try {
    await runScheduler(w.sessionId, w.llm, {
      maxTicks: 15,
      worldDir: w.baseDir,
      reloadTable: w.reloadTable,
      onDataEdit: async () => {
        await persistSession(w.baseDir, w.sessionId);
      },
      wakeSession: (sid: string) => {
        void enqueueScheduler(sid, w.llm, w.baseDir, w.reloadTable);
      },
      // S9 (2026-06-29): loop debug 落盘 hook — debug=on 时落 loop_NNNN.{input,output,meta}.json
      onLoopComplete: async (info) => {
        const meta = info.meta as { threadId?: string; sessionId?: string };
        if (!meta.threadId || !meta.sessionId) return;
        // objectId = thread.calleeObjectId (LoopTimeline 按此寻址 debug 路径)
        const reg = await import("@ooc/core/runtime/object-registry.js");
        const inst = reg.getSessionRegistry(meta.sessionId).getObject(meta.threadId);
        const calleeObjectId = (inst?.data as { calleeObjectId?: string } | undefined)?.calleeObjectId;
        if (!calleeObjectId) return;
        await writeLoopDebug({
          baseDir: w.baseDir,
          sessionId: meta.sessionId,
          objectId: calleeObjectId,
          threadId: meta.threadId,
          loopIndex: info.loopIndex,
          input: info.input,
          output: info.output,
          meta: info.meta,
        });
      },
    });
    await persistSession(w.baseDir, w.sessionId);
  } catch (err) {
    ok = false;
    errMsg = (err as Error).message;
    // ENOENT 通常是 thread GC 后正常竞态(thread inst 已删,worker tick 仍读 .flow.json),
    // 降级日志避免噪声;其他 error 仍 observeLog。
    if (!errMsg.includes("ENOENT")) {
      observeLog("worker.runScheduler.error", `[worker] ${errMsg}`);
    }
  } finally {
    w.busy = false;
    if (jobId) finishJob(jobId, ok, errMsg);
    w.currentJobId = undefined;
  }
  if (w.pending) {
    w.pending = false;
    // 把 pending 期间累计的 jobId 接到下一轮 runOnce
    w.currentJobId = w.pendingJobId;
    w.pendingJobId = undefined;
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
