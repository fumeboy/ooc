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

  test("seedSession + continueThread delivers via cross-object talk", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));

    try {
      const service = createFlowsService({
        baseDir,
        pauseStore: createPauseStore(),
        jobManager: createJobManager(),
      });
      // 1) seedSession 等价于 user 对 agent 发起初次 talk
      const seeded = await service.seedSession({
        sessionId: "s1",
        targetObjectId: "agent",
        initialMessage: "first message",
      });
      expect(seeded.targetObjectId).toBe("agent");
      expect(seeded.targetThreadId).toBeDefined();
      expect(seeded.jobId).toBeDefined();

      // 2) callee thread 已生成且收到首条 user 消息
      const { readThread } = await import("@src/persistable");
      const callee = await readThread(
        { baseDir, sessionId: "s1", objectId: "agent" },
        seeded.targetThreadId,
      );
      expect(callee?.status).toBe("running");
      expect(callee?.inbox?.[0]?.content).toBe("first message");
      expect(callee?.inbox?.[0]?.source).toBe("user");

      // 3) continueThread 再发一条；callee.inbox 累加
      await service.continueThread({ sessionId: "s1", text: "继续推下去" });
      const calleeAfter = await readThread(
        { baseDir, sessionId: "s1", objectId: "agent" },
        seeded.targetThreadId,
      );
      expect(calleeAfter?.inbox?.length).toBe(2);
      expect(calleeAfter?.inbox?.at(-1)?.content).toBe("继续推下去");
      expect(calleeAfter?.inbox?.at(-1)?.source).toBe("user");

      // 4) user.root.outbox 也累计（双写正确）
      const userThread = await readThread(
        { baseDir, sessionId: "s1", objectId: "user" },
        "root",
      );
      expect(userThread?.outbox?.length).toBe(2);
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

      await expect(service.pauseSession({ sessionId: "s-pause" })).resolves.toEqual({
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

  describe("super sessionId is reserved", () => {
    test("createSession rejects sessionId='super' with INVALID_INPUT", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));
      try {
        const service = createFlowsService({
          baseDir, pauseStore: createPauseStore(), jobManager: createJobManager(),
        });
        await expect(service.createSession({ sessionId: "super" })).rejects.toMatchObject({
          code: "INVALID_INPUT",
        });
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("createSession rejects any case of 'super' (case-insensitive guard for HFS+)", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));
      try {
        const service = createFlowsService({
          baseDir, pauseStore: createPauseStore(), jobManager: createJobManager(),
        });
        await expect(service.createSession({ sessionId: "Super" })).rejects.toMatchObject({
          code: "INVALID_INPUT",
        });
        await expect(service.createSession({ sessionId: "SUPER" })).rejects.toMatchObject({
          code: "INVALID_INPUT",
        });
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("seedSession rejects sessionId='super'", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));
      try {
        const service = createFlowsService({
          baseDir, pauseStore: createPauseStore(), jobManager: createJobManager(),
        });
        await expect(
          service.seedSession({
            sessionId: "super",
            targetObjectId: "alice",
            initialMessage: "hi",
          }),
        ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("createFlowObject rejects sessionId='super' (防止绕过 createSession 守卫直接创建受保护目录)", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));
      try {
        const service = createFlowsService({
          baseDir, pauseStore: createPauseStore(), jobManager: createJobManager(),
        });
        await expect(
          service.createFlowObject({ sessionId: "super", objectId: "mallory" }),
        ).rejects.toMatchObject({ code: "INVALID_INPUT" });
        await expect(
          service.createFlowObject({ sessionId: "SUPER", objectId: "mallory" }),
        ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("regression: createSession accepts normal sessionId", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));
      try {
        const service = createFlowsService({
          baseDir, pauseStore: createPauseStore(), jobManager: createJobManager(),
        });
        const out = await service.createSession({ sessionId: "web-test-1" });
        expect(out.sessionId).toBe("web-test-1");
        expect(out.created).toBe(true);
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });
  });
});
