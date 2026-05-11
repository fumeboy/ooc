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
      // 没传 initialMessage → 不入队 job，等 user 显式 inject 才启动
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

  test("injectThread flips failed thread back to running", async () => {
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

      const out = await service.injectThread({
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
