import { describe, expect, test } from "bun:test";
import { createJobManager } from "./job-manager";

describe("job-manager", () => {
  test("deduplicates running job per session/object", () => {
    const jobs = createJobManager();

    const first = jobs.createRunThreadJob({
      sessionId: "s1",
      objectId: "agent",
      threadId: "root",
    });
    const second = jobs.createRunThreadJob({
      sessionId: "s1",
      objectId: "agent",
      threadId: "root",
    });

    expect(second.jobId).toBe(first.jobId);
  });

  // 回归：同一 object 在同一 session 下的**不同 thread**
  // 各自必须拿到独立 job。此前 dedupe 只按 (sessionId, objectId)，导致 supervisor 的
  // pr-review thread（t_prreview_supervisor_<id>）被其已有的别的 super-session job
  // 折叠吞掉，永不被 worker 调度 →「supervisor 始终参与 review」在 agent 侧形同虚设。
  test("does NOT dedupe distinct threads of the same session/object", () => {
    const jobs = createJobManager();

    const review = jobs.createRunThreadJob({
      sessionId: "super",
      objectId: "supervisor",
      threadId: "t_prreview_supervisor_1",
    });
    const other = jobs.createRunThreadJob({
      sessionId: "super",
      objectId: "supervisor",
      threadId: "t_welcome",
    });

    expect(other.jobId).not.toBe(review.jobId);
    const queued = jobs.listJobs().filter((j) => j.status === "queued");
    expect(queued.map((j) => j.threadId).sort()).toEqual([
      "t_prreview_supervisor_1",
      "t_welcome",
    ]);
  });
});
