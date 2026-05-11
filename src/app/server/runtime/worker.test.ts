import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobManager } from "./job-manager";
import { createPauseStore } from "./pause-store";
import { processQueuedJobs } from "./worker";

describe("worker", () => {
  test("processes queued jobs and marks them done", async () => {
    const jobManager = createJobManager();
    const config = {
      port: 0,
      baseDir: mkdtempSync(join(tmpdir(), "ooc-worker-")),
      workerPollMs: 5,
      workerEnabled: false,
      workerMaxTicks: 15,
      pauseStore: createPauseStore(),
      jobManager,
    };
    const job = jobManager.createRunThreadJob({
      sessionId: "s1",
      objectId: "o1",
      threadId: "root",
    });
    const processed: string[] = [];

    await processQueuedJobs(config, async (currentJob) => {
      processed.push(currentJob.jobId);
    });

    expect(processed).toEqual([job.jobId]);
    expect(jobManager.getJob(job.jobId)?.status).toBe("done");
    expect(jobManager.getJob(job.jobId)?.startedAt).toBeGreaterThan(0);
    expect(jobManager.getJob(job.jobId)?.finishedAt).toBeGreaterThan(0);
  });
});
