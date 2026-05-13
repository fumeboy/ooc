import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readThread } from "@src/persistable";
import { createJobManager } from "../../runtime/job-manager";
import { createPauseStore } from "../../runtime/pause-store";
import { createFlowsService } from "./service";

describe("flows service", () => {
  test("listFlows exposes session paused state", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));

    try {
      const pauseStore = createPauseStore();
      const service = createFlowsService({
        baseDir,
        pauseStore,
        jobManager: createJobManager(),
      });

      await service.createSession({ sessionId: "s1", title: "demo" });
      await service.createSession({ sessionId: "s2", title: "demo 2" });
      pauseStore.pauseSession("s2");

      const out = await service.listFlows();
      expect(out.items.map((item) => ({ sessionId: item.sessionId, paused: item.paused }))).toEqual([
        { sessionId: "s1", paused: false },
        { sessionId: "s2", paused: true },
      ]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

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
      const thread = await readThread({ baseDir, sessionId: "s1", objectId: "agent" }, "root");
      const initialMsgId = thread?.inbox?.[0]?.id;
      expect(initialMsgId).toBeDefined();
      expect(thread?.inbox).toHaveLength(1);
      expect(thread?.inbox?.[0]?.content).toBe("你好");
      expect(thread?.events).toEqual([
        {
          category: "context_change",
          kind: "inbox_message_arrived",
          msgId: initialMsgId as string
        }
      ]);
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
      const continuedMsgId = after?.inbox?.at(-1)?.id;
      expect(continuedMsgId).toBeDefined();
      expect(after?.status).toBe("running");
      expect(after?.inbox?.at(-1)?.content).toBe("继续推下去");
      expect(after?.events.at(-1)).toEqual({
        category: "context_change",
        kind: "inbox_message_arrived",
        msgId: continuedMsgId as string
      });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("pauseSession and resumeSession return latest paused flag", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));

    try {
      const service = createFlowsService({
        baseDir,
        pauseStore: createPauseStore(),
        jobManager: createJobManager(),
      });

      await service.createSession({ sessionId: "s-pause" });

      expect(service.pauseSession({ sessionId: "s-pause" })).toEqual({
        sessionId: "s-pause",
        paused: true,
      });

      await expect(service.resumeSession({ sessionId: "s-pause" })).resolves.toEqual({
        sessionId: "s-pause",
        paused: false,
        resumedThreadIds: [],
        jobIds: [],
      });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
