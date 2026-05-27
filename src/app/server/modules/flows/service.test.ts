import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readThread, writeThread } from "@src/persistable";
import { clearStoneSkillsCache } from "@src/persistable/stone-skills";
import type { ThreadContext } from "@src/thinkable/context";
import type {
  ContextWindow,
  TalkWindow,
  PlanWindow,
} from "@src/executable/windows/_shared/types";
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

    test("idempotent (no initialMessage): same target twice reuses the existing talk_window without re-creating or re-delivering", async () => {
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
        // 第二次不带 initialMessage → 纯幂等：复用窗口、不重新派送、无 job
        const second = await service.addUserTalkWindow({
          sessionId: "s1",
          targetObjectId: "alice",
        });
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.talkWindowId).toBe(first.talkWindowId);
        expect(second.jobId).toBeUndefined();
        // alice callee inbox 仍只有第一条消息（第二次无消息 → 不派送）
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

    /**
     * 根因 #5（待办 #5，2026-05-27）回归 gate：
     * 对一个**已存在 talk_window** 的 object 再次调 addUserTalkWindow 且**带 initialMessage**，
     * 旧实现会幂等早返回、静默丢弃这条消息（HTTP 仍 200，"假成功"）。体验官实测踩坑被迫改用 /continue。
     *
     * 修复后不变量：带 initialMessage 时无论窗口新建/复用，消息必须送达 callee.inbox + 触发 run-thread 入队；
     * created:false（复用窗口）但 jobId 真实存在 — 调用方据此区分新建 vs 复用且拿得到 job。
     */
    test("reuse + initialMessage: second call with a message DELIVERS (must not silently drop) and returns a real jobId", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "_test_collab_reuse_deliver_"));
      try {
        const jobManager = createJobManager();
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager,
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
        // 第二次带 initialMessage 命中既有 talk_window → 必须仍投递，不得静默丢
        const second = await service.addUserTalkWindow({
          sessionId: "s1",
          targetObjectId: "alice",
          initialMessage: "second message must be delivered",
        });

        // 复用既有窗口，但消息确实送达
        expect(second.created).toBe(false);
        expect(second.talkWindowId).toBe(first.talkWindowId);
        expect(second.targetObjectId).toBe("alice");
        expect(second.targetThreadId).toBe(first.targetThreadId);
        // 真实 jobId（不再 undefined）
        expect(typeof second.jobId).toBe("string");
        const job = jobManager.getJob(second.jobId!);
        expect(job?.kind).toBe("run-thread");
        expect(job?.objectId).toBe("alice");
        expect(job?.threadId).toBe(first.targetThreadId);

        // alice callee inbox 现在含两条消息；第二条进了 target thread（events 可搜到）
        const callee = await readThread(
          { baseDir, sessionId: "s1", objectId: "alice" },
          first.targetThreadId!,
        );
        expect(callee?.inbox?.length).toBe(2);
        expect(callee?.inbox?.at(-1)?.content).toBe("second message must be delivered");
        expect(callee?.inbox?.at(-1)?.source).toBe("user");
        const secondMsgId = callee?.inbox?.at(-1)?.id;
        expect(secondMsgId).toBeDefined();
        // inbox_message_arrived 事件入了 target thread（两条派送各一条）
        const arrived = (callee?.events ?? []).filter(
          (e) => e.kind === "inbox_message_arrived",
        );
        expect(arrived.length).toBe(2);
        expect(arrived.some((e) => (e as { msgId?: string }).msgId === secondMsgId)).toBe(true);

        // user.root.outbox 双写：两条
        const userThread = await readThread(
          { baseDir, sessionId: "s1", objectId: "user" },
          "root",
        );
        const aliceOutbox = (userThread?.outbox ?? []).filter(
          (m) => m.toThreadId === first.targetThreadId,
        );
        expect(aliceOutbox.length).toBe(2);
        expect(aliceOutbox.at(-1)?.content).toBe("second message must be delivered");
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

  /**
   * Round 8 D2（design: docs/2026-05-26-session-threads-index-design.md §4.1）：
   * listThreads 扩展返回 thread metadata + 4 种关系字段；测试覆盖：
   * 1) 基础 metadata：status / createdAt / objectId / threadId 都正确
   * 2) threadTree 关系：parent / creator / childThreadIds
   * 3) talkPeers：从 contextWindows[type==="talk"] 提取
   * 4) shares：从 contextWindows[*].sharing 提取（kind=ref / lent_out）
   * 5) 失败容错：损坏的 thread.json → status="failed"，listThreads 不抛
   */
  describe("listThreads metadata extension (Round 8 D2)", () => {
    test("基础 metadata：user.root + agent.root 各自 status / objectId / threadId 正确", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "_test_collab_basic_"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        await service.seedSession({
          sessionId: "s1",
          targetObjectId: "supervisor",
          initialMessage: "hi sup",
        });

        const out = await service.listThreads({ sessionId: "s1" });
        // 至少含 user.root + supervisor.<calleeThreadId>
        const objectIds = out.items.map((i) => i.objectId).sort();
        expect(objectIds).toContain("user");
        expect(objectIds).toContain("supervisor");

        const userItem = out.items.find(
          (i) => i.objectId === "user" && i.threadId === "root",
        );
        expect(userItem).toBeDefined();
        expect(userItem!.status).toBe("running");
        expect(typeof userItem!.createdAt).toBe("number");
        expect(userItem!.childThreadIds).toEqual([]);
        // user.root 含一个 talk_window 指向 supervisor
        expect(userItem!.talkPeers.length).toBeGreaterThanOrEqual(1);
        const peer = userItem!.talkPeers.find((p) => p.targetObjectId === "supervisor");
        expect(peer).toBeDefined();
        expect(peer!.windowId).toMatch(/^w_talk_/);
        // 非 super session → isSuperFlow 缺省
        expect(userItem!.isSuperFlow).toBeUndefined();

        // 排序：items 按 (objectId, threadId) localeCompare
        const sorted = [...out.items].sort((a, b) =>
          a.objectId === b.objectId
            ? a.threadId.localeCompare(b.threadId)
            : a.objectId.localeCompare(b.objectId),
        );
        expect(out.items).toEqual(sorted);
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("threadTree 关系：parentThreadId / creatorThreadId / childThreadIds 正确填充", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "_test_collab_tree_"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        await service.createSession({ sessionId: "s-tree" });
        // 手工构造 parent + child 关系（避开真启 LLM）
        await service.createFlowObject({ sessionId: "s-tree", objectId: "agent" });
        const parent = await readThread(
          { baseDir, sessionId: "s-tree", objectId: "agent" },
          "root",
        );
        expect(parent).toBeDefined();
        // child thread 与 parent 同 object
        const childId = "child_t1";
        const child: ThreadContext = {
          id: childId,
          status: "running",
          events: [],
          parentThreadId: "root",
          creatorThreadId: "root",
          creatorObjectId: "agent",
          contextWindows: [],
          persistence: {
            baseDir,
            sessionId: "s-tree",
            objectId: "agent",
            threadId: childId,
          },
        };
        await writeThread(child);
        // 在 parent 写入 childThreadIds 链
        parent!.childThreadIds = [childId];
        await writeThread(parent!);

        const out = await service.listThreads({ sessionId: "s-tree" });
        const rootItem = out.items.find((i) => i.threadId === "root");
        const childItem = out.items.find((i) => i.threadId === childId);
        expect(rootItem).toBeDefined();
        expect(childItem).toBeDefined();
        expect(rootItem!.childThreadIds).toEqual([childId]);
        expect(childItem!.parentThreadId).toBe("root");
        expect(childItem!.creatorThreadId).toBe("root");
        expect(childItem!.creatorObjectId).toBe("agent");
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("talkPeers：含 target / targetThreadId / windowId 从 talk_window 提取", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "_test_collab_talkpeers_"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        // seedSession 自动构造 user.root.talk_window → supervisor
        const seeded = await service.seedSession({
          sessionId: "s-peers",
          targetObjectId: "supervisor",
          initialMessage: "hi",
        });

        const out = await service.listThreads({ sessionId: "s-peers" });
        const userItem = out.items.find(
          (i) => i.objectId === "user" && i.threadId === "root",
        );
        expect(userItem).toBeDefined();
        const peer = userItem!.talkPeers.find(
          (p) => p.targetObjectId === "supervisor",
        );
        expect(peer).toBeDefined();
        // talk-delivery 应已回填 targetThreadId
        expect(peer!.targetThreadId).toBe(seeded.targetThreadId);
        expect(peer!.windowId).toBe(seeded.talkWindowId);
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("shares：sharing.kind=lent_out / ref 分别进 lentOut / holding", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "_test_collab_shares_"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        await service.createSession({ sessionId: "s-shares" });
        await service.createFlowObject({ sessionId: "s-shares", objectId: "owner" });
        await service.createFlowObject({ sessionId: "s-shares", objectId: "borrower" });

        // 给 owner.root 手工挂一个 lent_out plan_window
        const ownerThread = await readThread(
          { baseDir, sessionId: "s-shares", objectId: "owner" },
          "root",
        );
        expect(ownerThread).toBeDefined();
        const planSnapshotBase: PlanWindow = {
          id: "w_plan_share_1",
          type: "plan",
          title: "shared plan",
          status: "active",
          createdAt: Date.now(),
          steps: [],
        };
        const lentOutWindow: PlanWindow = {
          ...planSnapshotBase,
          sharing: {
            kind: "lent_out",
            borrowerThreadId: "root",
            lentToWindowId: "w_do_xyz",
            sharedAt: Date.now(),
            snapshot: planSnapshotBase,
          },
        };
        ownerThread!.contextWindows = [
          ...(ownerThread!.contextWindows ?? []),
          lentOutWindow as ContextWindow,
        ];
        await writeThread(ownerThread!);

        // 给 borrower.root 手工挂一个 ref 进来的 plan_window（同 id 配对）
        const borrowerThread = await readThread(
          { baseDir, sessionId: "s-shares", objectId: "borrower" },
          "root",
        );
        expect(borrowerThread).toBeDefined();
        const refWindow: PlanWindow = {
          ...planSnapshotBase,
          sharing: {
            kind: "ref",
            ownerThreadId: "root",
            lentByWindowId: "w_do_abc",
            sharedAt: Date.now(),
            snapshot: planSnapshotBase,
          },
        };
        borrowerThread!.contextWindows = [
          ...(borrowerThread!.contextWindows ?? []),
          refWindow as ContextWindow,
        ];
        await writeThread(borrowerThread!);

        const out = await service.listThreads({ sessionId: "s-shares" });
        const ownerItem = out.items.find((i) => i.objectId === "owner");
        const borrowerItem = out.items.find((i) => i.objectId === "borrower");
        expect(ownerItem).toBeDefined();
        expect(borrowerItem).toBeDefined();

        expect(ownerItem!.shares.lentOut.length).toBe(1);
        expect(ownerItem!.shares.lentOut[0]!.windowId).toBe("w_plan_share_1");
        expect(ownerItem!.shares.lentOut[0]!.borrowerThreadId).toBe("root");
        // borrowerObjectId 未持久化 → undefined（design 预留位）
        expect(ownerItem!.shares.lentOut[0]!.borrowerObjectId).toBeUndefined();
        expect(ownerItem!.shares.holding).toEqual([]);

        expect(borrowerItem!.shares.holding.length).toBe(1);
        expect(borrowerItem!.shares.holding[0]!.windowId).toBe("w_plan_share_1");
        expect(borrowerItem!.shares.holding[0]!.kind).toBe("ref");
        expect(borrowerItem!.shares.holding[0]!.ownerThreadId).toBe("root");
        expect(borrowerItem!.shares.holding[0]!.ownerObjectId).toBeUndefined();
        expect(borrowerItem!.shares.lentOut).toEqual([]);
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });

    test("失败容错：损坏的 thread.json → status='failed'，listThreads 不抛", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "_test_collab_corrupt_"));
      try {
        const service = createFlowsService({
          baseDir,
          pauseStore: createPauseStore(),
          jobManager: createJobManager(),
        });
        await service.createSession({ sessionId: "s-corrupt" });
        await service.createFlowObject({
          sessionId: "s-corrupt",
          objectId: "broken",
        });
        // 直接写一个非法 JSON 进去
        const corruptDir = join(
          baseDir,
          "flows",
          "s-corrupt",
          "objects",
          "broken",
          "threads",
          "corrupt_thread",
        );
        await mkdir(corruptDir, { recursive: true });
        await writeFile(join(corruptDir, "thread.json"), "{not valid json", "utf8");

        // 不应抛错
        const out = await service.listThreads({ sessionId: "s-corrupt" });
        const corruptItem = out.items.find(
          (i) => i.objectId === "broken" && i.threadId === "corrupt_thread",
        );
        expect(corruptItem).toBeDefined();
        expect(corruptItem!.status).toBe("failed");
        expect(corruptItem!.parentThreadId).toBeUndefined();
        expect(corruptItem!.creatorThreadId).toBeUndefined();
        expect(corruptItem!.creatorObjectId).toBeUndefined();
        expect(corruptItem!.createdAt).toBeUndefined();
        expect(corruptItem!.childThreadIds).toEqual([]);
        expect(corruptItem!.talkPeers).toEqual([]);
        expect(corruptItem!.shares.holding).toEqual([]);
        expect(corruptItem!.shares.lentOut).toEqual([]);
        // 其它正常 thread 仍在
        const normalItem = out.items.find((i) => i.threadId === "root");
        expect(normalItem).toBeDefined();
        expect(normalItem!.status).toBe("running");
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });
  });
});
