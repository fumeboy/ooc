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
});
