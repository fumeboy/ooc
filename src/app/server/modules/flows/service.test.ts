import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJobManager } from "../../runtime/job-manager";
import { createPauseStore } from "../../runtime/pause-store";
import { createFlowsService } from "./service";

describe("flows service", () => {
  test("creates flow object without initialMessage → no job enqueued", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));

    try {
      const service = createFlowsService({
        baseDir,
        pauseStore: createPauseStore(),
        jobManager: createJobManager(),
      });

      await service.createSession({ sessionId: "s1", title: "demo" });
      const result = await service.createFlowObject({ sessionId: "s1", objectId: "agent" });

      expect(result.initialThreadId).toBe("root");
      // 没传 initialMessage → 不入队 job，等 user 显式 continue 才启动
      expect(result.jobId).toBeUndefined();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("createFlowObject with initialMessage auto-enqueues root thread job", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));

    try {
      const service = createFlowsService({
        baseDir,
        pauseStore: createPauseStore(),
        jobManager: createJobManager(),
      });

      await service.createSession({ sessionId: "s1", title: "demo" });
      const result = await service.createFlowObject({
        sessionId: "s1",
        objectId: "agent",
        initialMessage: "你好",
      });

      expect(result.initialThreadId).toBe("root");
      expect(typeof result.jobId).toBe("string");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("resumeSession scans paused threads and enqueues resume-thread jobs", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));

    try {
      const jobManager = createJobManager();
      const service = createFlowsService({
        baseDir,
        pauseStore: createPauseStore(),
        jobManager,
      });
      await service.createSession({ sessionId: "s-resume" });
      await service.createFlowObject({ sessionId: "s-resume", objectId: "agent1" });
      await service.createFlowObject({ sessionId: "s-resume", objectId: "agent2" });

      // 把 agent1.root 标记为 paused（模拟 pause 状态）；agent2.root 留作 running
      const { readThread, writeThread } = await import("@src/persistable");
      const t1 = await readThread({ baseDir, sessionId: "s-resume", objectId: "agent1" }, "root");
      t1!.status = "paused";
      await writeThread(t1!);

      const out = await service.resumeSession({ sessionId: "s-resume" });
      expect(out.resumedThreadIds).toEqual(["agent1/root"]);
      expect(out.jobIds.length).toBe(1);
      const job = jobManager.getJob(out.jobIds[0]!);
      expect(job?.kind).toBe("resume-thread");
      expect(job?.objectId).toBe("agent1");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("resumeSession returns empty when no paused threads", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));

    try {
      const service = createFlowsService({
        baseDir,
        pauseStore: createPauseStore(),
        jobManager: createJobManager(),
      });
      await service.createSession({ sessionId: "s-empty" });
      const out = await service.resumeSession({ sessionId: "s-empty" });
      expect(out.resumedThreadIds).toEqual([]);
      expect(out.jobIds).toEqual([]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("continueThread flips failed thread back to running", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));

    try {
      const service = createFlowsService({
        baseDir,
        pauseStore: createPauseStore(),
        jobManager: createJobManager(),
      });
      await service.createSession({ sessionId: "s1" });
      await service.createFlowObject({ sessionId: "s1", objectId: "agent" });

      // 模拟 LLM 失败：手动把 thread 改成 failed
      const { readThread, writeThread } = await import("@src/persistable");
      const thread = await readThread({ baseDir, sessionId: "s1", objectId: "agent" }, "root");
      thread!.status = "failed";
      await writeThread(thread!);

      const out = await service.continueThread({
        sessionId: "s1",
        objectId: "agent",
        threadId: "root",
        text: "继续推下去",
      });
      expect(out.status).toBe("running");
      const after = await readThread({ baseDir, sessionId: "s1", objectId: "agent" }, "root");
      expect(after?.status).toBe("running");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
