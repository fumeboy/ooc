/**
 * background worker —— 后台循环驱动 scheduler。
 *
 * 设计最简：每个 sessionId 一条 worker；接收 enqueue 信号即跑一轮 scheduler.runScheduler。
 * 避免 busy-loop：waiting 或无 running thread 时回到等待，由 enqueue 唤醒。
 *
 * **issue F1 (2026-06-29)**：加 `reloadTable` opt 透传 — 经 scheduler → thinkable.think →
 * ThreadRuntime → maybeDispatchOnReload，兑现 lifecycle.on_reload 在生产 server 的派发。
 */
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import type { ReloadTable } from "@ooc/core/runtime/reload-table.js";
import { runScheduler } from "@ooc/builtins/agent/children/thread/thinkable/index.js";
import { persistSession } from "@ooc/core/persistable/runtime-object-io.js";
import { observeLog } from "@ooc/core/observable/index.js";
import { isGlobalPaused, isSessionPaused } from "./pause-store.js";

interface WorkerState {
  sessionId: string;
  llm: LlmClient;
  baseDir: string;
  /**
   * lifecycle on_reload 派发标记表（issue F1）。worker 注册时捕获该引用,后续 runOnce 透给
   * scheduler / thinkable.think / ThreadRuntime。server 不重启则 worker 持同一 reloadTable
   * 引用;server 重启 `clearWorkers()` 后下次 enqueue 重新捕获新表。
   */
  reloadTable?: ReloadTable;
  busy: boolean;
  pending: boolean;
}

const workers = new Map<string, WorkerState>();

/** 给 session 入队一次调度信号；已 busy 则置 pending 等当前 tick 结束再跑一次。 */
export async function enqueueScheduler(
  sessionId: string,
  llm: LlmClient,
  baseDir: string,
  reloadTable?: ReloadTable,
): Promise<void> {
  // S4 + S8 (2026-06-29): pause 闸 — global pause / per-session pause 命中即跳过入队。
  // 已 busy 的 worker 仍可继续 (pause 不打断 inflight LLM, 仅禁新调度信号入队)。
  if (isGlobalPaused() || isSessionPaused(sessionId)) {
    return;
  }
  let w = workers.get(sessionId);
  if (!w) {
    w = { sessionId, llm, baseDir, reloadTable, busy: false, pending: false };
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
      reloadTable: w.reloadTable,
      onDataEdit: async () => {
        await persistSession(w.baseDir, w.sessionId);
      },
      /**
       * issue G：把 enqueueScheduler 闭包注入 ThreadRuntime.scheduleSession 钩子。
       * say / reply / talk-super append 写盘后调用 → 跨 session 唤醒对端 worker。
       * 此处 fire-and-forget（enqueueScheduler 是 async 但 wakeSession 签名同步）；
       * 投递失败不阻塞当前 think 一轮，crash 容忍由 scheduler 启动 / 周期 tick 扫 inbox 兜底。
       * **issue F1**: reloadTable 透传保持(同 session 共用同一表)。
       */
      wakeSession: (sid: string) => {
        void enqueueScheduler(sid, w.llm, w.baseDir, w.reloadTable);
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
