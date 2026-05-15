import { createLlmClient } from "@src/thinkable/llm/client";
import { readThread } from "@src/persistable";
import { runScheduler } from "@src/thinkable/scheduler";
import type { ServerConfig } from "../bootstrap/config";
import type { RuntimeJob } from "./types";
import { resumePausedThread } from "./resume";

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
