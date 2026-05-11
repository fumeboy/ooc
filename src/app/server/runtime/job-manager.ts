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
  };
}
