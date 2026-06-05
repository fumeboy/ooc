import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readThread, writeThread } from "@ooc/core/persistable";
import type { createJobManager } from "./job-manager";
import { scanPausedThreads } from "./thread-query";
import { applyResumeTransition, canResumeThread } from "./thread-transition";

/**
 * Resume 编排（2026-06-05，observable pause 单向陷阱修复）。
 *
 * 把"扫 paused thread → 翻 running → 入队 resume-thread job"这段编排从
 * flows.resumeSession 抽出，让 **session 级 resume**（flows）与 **全局 pause 解除**
 * （runtime global-pause/disable）共用同一条恢复路径——避免 global-pause/disable
 * 只翻内存 flag、却把已 paused 的 thread 永久搁浅的单向陷阱。
 *
 * 设计边界：这里只依赖 pause-store **之外**的 thread 状态机
 * （scanPausedThreads / canResumeThread / applyResumeTransition）+ jobManager，
 * 不触碰 observable pause-checker 与 pause-store 的内部合并（F6 推迟项）。
 * resume 的正确性不依赖那次合并——它消费的是 thread.status="paused" 这个落盘事实，
 * 而非 pause 来源。
 */

export interface ResumeOrchestrationDeps {
  baseDir: string;
  jobManager: ReturnType<typeof createJobManager>;
}

export interface ResumedThread {
  /** `${objectId}/${threadId}` 形式，与 flows.resumeSession 返回契约一致。 */
  resumedThreadId: string;
  jobId: string;
}

/**
 * 扫单个 session 下所有 paused thread，逐个翻回 running 并入队一个 resume-thread job。
 *
 * 幂等：thread 在 scan 与 readThread 之间被改走（非 paused）时跳过（canResumeThread 守门）。
 * 不清 pause-store 标记——那是 caller（resumeSession 清 session 标记 / disableGlobalPause
 * 清 global 标记）的职责，本函数只做 thread 级恢复。
 */
export async function resumePausedThreadsInSession(
  deps: ResumeOrchestrationDeps,
  sessionId: string,
): Promise<ResumedThread[]> {
  const paused = await scanPausedThreads(deps.baseDir, sessionId);
  const resumed: ResumedThread[] = [];
  for (const { objectId, threadId } of paused) {
    const ref = { baseDir: deps.baseDir, sessionId, objectId };
    const thread = await readThread(ref, threadId);
    if (!thread || !canResumeThread(thread)) {
      continue;
    }
    await writeThread(applyResumeTransition(thread));
    const job = deps.jobManager.createResumeThreadJob({
      sessionId,
      objectId,
      threadId,
    });
    resumed.push({ resumedThreadId: `${objectId}/${threadId}`, jobId: job.jobId });
  }
  return resumed;
}

/**
 * 全局 pause 解除路径：扫 **所有** session 下的 paused thread 并恢复。
 *
 * global pause 是进程级、跨 session 的开关——它能停下任意 session 的任意 thread。
 * 因此其解除（global-pause/disable）必须对称地扫全部 session，而不是某一个。
 *
 * flows/ 目录不存在或读失败时返回空集（与 worker bootstrap 退化路径一致），不抛。
 */
export async function resumeAllPausedThreads(
  deps: ResumeOrchestrationDeps,
): Promise<ResumedThread[]> {
  const sessionIds = await listSessionIds(deps.baseDir);
  const all: ResumedThread[] = [];
  for (const sessionId of sessionIds) {
    const resumed = await resumePausedThreadsInSession(deps, sessionId);
    all.push(...resumed);
  }
  return all;
}

async function listSessionIds(baseDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(baseDir, "flows"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
