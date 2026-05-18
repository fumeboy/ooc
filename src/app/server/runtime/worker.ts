import { createLlmClient } from "@src/thinkable/llm/client";
import { readThread } from "@src/persistable";
import { runScheduler } from "@src/thinkable/scheduler";
import type { ServerConfig } from "../bootstrap/config";
import type { RuntimeJob } from "./types";
import { resumePausedThread } from "./resume";
import { scanRunningThreads } from "./thread-query";

export type RuntimeJobRunner = (job: RuntimeJob, config: ServerConfig) => Promise<void>;

/**
 * 约定值：user 是 web session 中的特殊 flow object，由控制面（人类）驱动；
 * worker 跳过它，让任何针对 user object 的 thread 都不被 LLM 调度。
 *
 * collaborable § cross-object talk（spec 2026-05-15）。
 */
const USER_OBJECT_ID = "user";

export async function runJob(
  job: RuntimeJob,
  config: Pick<ServerConfig, "baseDir" | "workerMaxTicks">
): Promise<void> {
  if (job.objectId === USER_OBJECT_ID) {
    // user object 是被动对象——所有思考由 web 用户在 UI 上完成，worker 不调度
    return;
  }

  if (job.kind === "resume-thread") {
    await resumePausedThread({
      baseDir: config.baseDir,
      sessionId: job.sessionId,
      objectId: job.objectId,
      threadId: job.threadId,
    });
    return;
  }

  const rootThread = await readThread(
    {
      baseDir: config.baseDir,
      sessionId: job.sessionId,
      objectId: job.objectId,
    },
    job.threadId
  );
  if (!rootThread) {
    throw new Error(`thread not found: ${job.threadId}`);
  }
  await runScheduler(rootThread, createLlmClient(), { maxTicks: config.workerMaxTicks ?? 15 });
}

export async function processQueuedJobs(
  config: ServerConfig,
  runner: RuntimeJobRunner = runJob
): Promise<void> {
  // 入口先做一次"全 session 兜底扫描":对每个有 running thread 但当前没在 jobManager
  // 队列里的 (session,object,thread) 入队 run-thread job。createRunThreadJob 自带去重,
  // 已有 queued/running 的 (session,object) 不会重复入队。
  // 这覆盖两种场景:
  // 1. server 启动后 jobManager 是空的,但磁盘上有 running thread(上次没跑完)
  // 2. 跨对象 talk:caller say 后 callee 变 running,但 executor 拿不到 jobManager,
  //    依赖这里把 callee 兜起来
  await enqueueOrphanRunningThreads(config);

  const jobs = config.jobManager.listJobs().filter((job) => job.status === "queued");

  for (const job of jobs) {
    config.jobManager.updateJob(job.jobId, {
      status: "running",
      startedAt: Date.now(),
      error: undefined,
    });

    try {
      await runner(job, config);
      config.jobManager.updateJob(job.jobId, {
        status: "done",
        finishedAt: Date.now(),
      });
    } catch (error) {
      config.jobManager.updateJob(job.jobId, {
        status: "failed",
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 同一目的的事后扫描:本 job 中可能产生新的 callee running thread
    await enqueueOrphanRunningThreads(config, job.sessionId);
  }
}

/**
 * 扫指定 session(或全部 session) 的 running thread 入队 follow-up job。
 * 失败不抛,以保证 worker 循环不被一个坏 session 拖垮。
 */
async function enqueueOrphanRunningThreads(
  config: ServerConfig,
  onlySessionId?: string,
): Promise<void> {
  try {
    const sessionIds = onlySessionId ? [onlySessionId] : await listSessionIds(config.baseDir);
    for (const sessionId of sessionIds) {
      const running = await scanRunningThreads(config.baseDir, sessionId);
      for (const { objectId, threadId } of running) {
        if (objectId === USER_OBJECT_ID) continue;
        config.jobManager.createRunThreadJob({ sessionId, objectId, threadId });
      }
    }
  } catch {
    // swallow — 扫描失败不阻塞主循环
  }
}

async function listSessionIds(baseDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const entries = await readdir(join(baseDir, "flows"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export function startJobWorker(config: ServerConfig): { stop(): void } {
  let processing = false;
  const interval = setInterval(() => {
    if (processing) return;
    processing = true;
    processQueuedJobs(config).finally(() => {
      processing = false;
    });
  }, config.workerPollMs);

  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return {
    stop() {
      clearInterval(interval);
    },
  };
}
