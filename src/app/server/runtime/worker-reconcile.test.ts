import { describe, expect, test } from "bun:test";
import { createJobManager } from "./job-manager";
import { processQueuedJobs, type RuntimeJobResult } from "./worker";
import type { ServerConfig } from "../bootstrap/config";

/**
 * observability 根因 #4: job 终态与 thread 终态对账。
 *
 * thinkloop 把 LLM 超时/异常**内部消化**成 thread.status="failed"（不向 runner 抛），
 * runner 正常返回。这里验证 processQueuedJobs 据 runner 返回的 thread 终态对账：
 * - thread failed → job 标 failed + statusReason（不裸标 done，消除假成功）
 * - thread done   → job 标 done
 * - runner 抛错   → job 标 failed + statusReason="runner_error"
 */
function makeConfig(jobManager: ReturnType<typeof createJobManager>): ServerConfig {
  // processQueuedJobs 只触碰 config.jobManager；其余字段不参与，runner 被 mock。
  return { jobManager } as unknown as ServerConfig;
}

describe("processQueuedJobs job/thread 对账 (根因 #4)", () => {
  test("thread failed (llm_timeout) → job 标 failed 而非裸 done", async () => {
    const jobManager = createJobManager();
    const job = jobManager.createRunThreadJob({ sessionId: "s1", objectId: "agent", threadId: "root" });

    const runner = async (): Promise<RuntimeJobResult> => ({
      threadStatus: "failed",
      threadStatusReason: "llm_timeout",
      threadLastError: "LLM 调用超时 (已等待 120000ms)",
    });

    await processQueuedJobs(makeConfig(jobManager), runner);

    const after = jobManager.getJob(job.jobId)!;
    expect(after.status).toBe("failed");
    expect(after.statusReason).toBe("llm_timeout");
    expect(after.error).toContain("超时");
    expect(after.finishedAt).toBeGreaterThan(0);
  });

  test("thread done → job 标 done", async () => {
    const jobManager = createJobManager();
    const job = jobManager.createRunThreadJob({ sessionId: "s1", objectId: "agent", threadId: "root" });

    const runner = async (): Promise<RuntimeJobResult> => ({ threadStatus: "done" });

    await processQueuedJobs(makeConfig(jobManager), runner);

    const after = jobManager.getJob(job.jobId)!;
    expect(after.status).toBe("done");
    expect(after.statusReason).toBeUndefined();
  });

  test("runner 返回 void (无对账信息, 如 user/resume 路径) → job 标 done", async () => {
    const jobManager = createJobManager();
    const job = jobManager.createRunThreadJob({ sessionId: "s1", objectId: "agent", threadId: "root" });

    const runner = async (): Promise<void> => {};

    await processQueuedJobs(makeConfig(jobManager), runner);

    expect(jobManager.getJob(job.jobId)!.status).toBe("done");
  });

  test("thread failed 缺 statusReason → 回落 'thread_failed'", async () => {
    const jobManager = createJobManager();
    const job = jobManager.createRunThreadJob({ sessionId: "s1", objectId: "agent", threadId: "root" });

    const runner = async (): Promise<RuntimeJobResult> => ({ threadStatus: "failed" });

    await processQueuedJobs(makeConfig(jobManager), runner);

    expect(jobManager.getJob(job.jobId)!.statusReason).toBe("thread_failed");
  });

  test("runner 抛错 → job 标 failed + statusReason='runner_error'", async () => {
    const jobManager = createJobManager();
    const job = jobManager.createRunThreadJob({ sessionId: "s1", objectId: "agent", threadId: "root" });

    const runner = async (): Promise<RuntimeJobResult> => {
      throw new Error("thread not found: root");
    };

    await processQueuedJobs(makeConfig(jobManager), runner);

    const after = jobManager.getJob(job.jobId)!;
    expect(after.status).toBe("failed");
    expect(after.statusReason).toBe("runner_error");
    expect(after.error).toBe("thread not found: root");
  });
});
