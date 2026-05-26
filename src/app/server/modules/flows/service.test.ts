import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readThread } from "@src/persistable";
import { clearStoneSkillsCache } from "@src/persistable/stone-skills";
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

  /**
   * addUserTalkWindow（spec 2026-05-26 user-home 双栏）：在已存在 session 的 user.root 上
   * 追加新 talk_window 指向另一个 object。区别于 seedSession：不再建 session、user 已存在
   * 时复用、同 target 已有 talk_window 时幂等返回。
   */
  describe("addUserTalkWindow", () => {
    test("appends a new talk_window pointing at another object and delivers initialMessage", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-add-talk-"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        // 先 seed 一个跟 supervisor 的 session
        const seeded = await service.seedSession({
          sessionId: "s1",
          targetObjectId: "supervisor",
          initialMessage: "hi sup",
        });
        // 再加一个跟 pdf-extractor 的 talk_window
        const out = await service.addUserTalkWindow({
          sessionId: "s1",
          targetObjectId: "pdf-extractor",
          initialMessage: "extract this PDF",
        });

        expect(out.created).toBe(true);
        expect(out.targetObjectId).toBe("pdf-extractor");
        expect(out.targetThreadId).toBeDefined();
        expect(out.jobId).toBeDefined();
        expect(out.talkWindowId).not.toBe(seeded.talkWindowId);

        // user.root.contextWindows 应同时含两个 talk_window（supervisor + pdf-extractor）
        const userThread = await readThread(
          { baseDir, sessionId: "s1", objectId: "user" },
          "root",
        );
        const targets = (userThread?.contextWindows ?? [])
          .filter((w) => w.type === "talk")
          .map((w) => (w as { target: string }).target);
        expect(targets).toContain("supervisor");
        expect(targets).toContain("pdf-extractor");

        // pdf-extractor callee thread 真创建了，inbox 含首条消息
        const callee = await readThread(
          { baseDir, sessionId: "s1", objectId: "pdf-extractor" },
          out.targetThreadId!,
        );
        expect(callee?.inbox?.[0]?.content).toBe("extract this PDF");
        expect(callee?.inbox?.[0]?.source).toBe("user");
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("idempotent: same target twice returns the existing talk_window without re-creating", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-add-talk-idem-"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        await service.seedSession({
          sessionId: "s1",
          targetObjectId: "supervisor",
          initialMessage: "hi",
        });
        const first = await service.addUserTalkWindow({
          sessionId: "s1",
          targetObjectId: "alice",
          initialMessage: "hello alice",
        });
        const second = await service.addUserTalkWindow({
          sessionId: "s1",
          targetObjectId: "alice",
          initialMessage: "second call ignored",
        });
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.talkWindowId).toBe(first.talkWindowId);
        // alice callee inbox 应当只有第一条消息（第二次不重新派送）
        const callee = await readThread(
          { baseDir, sessionId: "s1", objectId: "alice" },
          first.targetThreadId!,
        );
        expect(callee?.inbox?.length).toBe(1);
        expect(callee?.inbox?.[0]?.content).toBe("hello alice");
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("rejects when user.root not seeded yet", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-add-talk-no-user-"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        await service.createSession({ sessionId: "s1" });
        await expect(
          service.addUserTalkWindow({
            sessionId: "s1",
            targetObjectId: "alice",
            initialMessage: "hi",
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });
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

  /**
   * getThread response 的 `hash` 字段是前端 polling 触发 refresh 的依据 ——
   * 同输入两次必须返回相同 hash，否则前端会永远命中"内容变了"。
   *
   * 这是反复回归点：synthesizer 每轮 derive 出的合成 window（KnowledgeWindow /
   * RelationWindow / SkillIndexWindow / Issue knowledge）带 ephemeral id+createdAt，
   * 必须在 service.ts:stripVolatileForHash 里剔掉。任意一条没剔，hash 就翻动。
   *
   * 历史踩过：
   * - 2026-05-25：skill_index 漏剔 createdAt（用户报告 supervisor thread hash 一直变）
   * - 之前：relation / issue / non-explicit knowledge 陆续补齐
   */
  describe("getThread hash is stable for unchanged context", () => {
    test("hash unchanged across two calls with derived knowledge + relation windows", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-hash-"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        // seedSession：建 user.root + agent.root，user.root 上挂指向 agent 的 talk_window
        // → agent.root 自带 creator talk_window；两边都会 derive RelationWindow + protocol knowledge。
        const seeded = await service.seedSession({
          sessionId: "s1",
          targetObjectId: "agent",
          initialMessage: "hi",
        });

        const a = await service.getThread({
          sessionId: "s1",
          objectId: "agent",
          threadId: seeded.targetThreadId,
        });
        const b = await service.getThread({
          sessionId: "s1",
          objectId: "agent",
          threadId: seeded.targetThreadId,
        });
        expect(a.hash).toBe(b.hash);

        // 同样验证 user.root：含 talk_window → relation derive
        const u1 = await service.getThread({
          sessionId: "s1",
          objectId: "user",
          threadId: "root",
        });
        const u2 = await service.getThread({
          sessionId: "s1",
          objectId: "user",
          threadId: "root",
        });
        expect(u1.hash).toBe(u2.hash);
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("hash unchanged when SkillIndexWindow is injected (skill_index.createdAt must be stripped)", async () => {
      // 回归点：skill_index window 每轮 derive 时 createdAt=Date.now()；
      // stripVolatileForHash 没剔会让 hash 永远翻。
      const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-hash-skill-"));
      try {
        // 在 stones/main/skills/<name>/SKILL.md 放一个 skill，让 listBranchSkills 扫到。
        const skillDir = join(baseDir, "stones", "main", "skills", "dummy-skill");
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          join(skillDir, "SKILL.md"),
          "---\nname: dummy-skill\ndescription: test skill for hash stability\n---\n\n# Dummy\n",
        );
        // skills 有 10s TTL 缓存；每轮 derive 都从缓存拿同一份；清缓存以确保本测试不被旧条目干扰。
        clearStoneSkillsCache();

        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        const seeded = await service.seedSession({
          sessionId: "s1",
          targetObjectId: "agent",
          initialMessage: "hi",
        });

        const a = await service.getThread({
          sessionId: "s1",
          objectId: "agent",
          threadId: seeded.targetThreadId,
        });
        // 确认 skill_index 真的被注入（否则该测试就退化成跟前一条重复）
        const hasSkillIndex = (a.contextWindows ?? []).some((w) => w.type === "skill_index");
        expect(hasSkillIndex).toBe(true);

        const b = await service.getThread({
          sessionId: "s1",
          objectId: "agent",
          threadId: seeded.targetThreadId,
        });
        expect(a.hash).toBe(b.hash);
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });
  });
});
