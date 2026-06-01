import { randomUUID } from "node:crypto";
import type { RuntimeJob, RuntimeJobInput } from "./types";

export function createJobManager() {
  const jobs = new Map<string, RuntimeJob>();

  function findRunning(sessionId: string, objectId: string): RuntimeJob | undefined {
    return [...jobs.values()].find((job) => {
      return (
        job.sessionId === sessionId &&
        job.objectId === objectId &&
        (job.status === "queued" || job.status === "running")
      );
    });
  }

  function createJob(kind: RuntimeJob["kind"], input: RuntimeJobInput, dedupe: boolean): RuntimeJob {
    if (dedupe) {
      const existing = findRunning(input.sessionId, input.objectId);
      if (existing) return existing;
    }

    const job: RuntimeJob = {
      ...input,
      jobId: randomUUID(),
      kind,
      status: "queued",
    };
    jobs.set(job.jobId, job);
    return job;
  }

  return {
    createRunThreadJob(input: RuntimeJobInput): RuntimeJob {
      return createJob("run-thread", input, true);
    },
    createResumeThreadJob(input: RuntimeJobInput): RuntimeJob {
      return createJob("resume-thread", input, false);
    },
    listJobs(): RuntimeJob[] {
      return [...jobs.values()];
    },
    getJob(jobId: string): RuntimeJob | undefined {
      return jobs.get(jobId);
    },
    updateJob(jobId: string, patch: Partial<RuntimeJob>): RuntimeJob | undefined {
      const current = jobs.get(jobId);
      if (!current) return undefined;
      const next = { ...current, ...patch };
      jobs.set(jobId, next);
      return next;
    },
    /**
     * Atomic claim: 把 queued job 翻成 running, 返回更新后的 job. 失败 (不存在 / 已不是 queued) 返回 undefined.
     *
     * 用于 worker 并发 tick 安全处理 queued jobs — 多个 tick 同时进 processQueuedJobs 时, 每个 job 只会被 claim 一次.
     * 因为 JS 是单线程, Map.set 是原子的, 这里的 if + set 在单 tick 内不会被打断.
     */
    tryClaimQueuedJob(jobId: string): RuntimeJob | undefined {
      const current = jobs.get(jobId);
      if (!current || current.status !== "queued") return undefined;
      const next: RuntimeJob = { ...current, status: "running", startedAt: Date.now(), error: undefined };
      jobs.set(jobId, next);
      return next;
    },
  };
}
