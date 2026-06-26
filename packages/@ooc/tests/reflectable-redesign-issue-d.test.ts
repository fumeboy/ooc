/**
 * reflectable redesign — issue D e2e tests.
 *
 * 4 tests:
 *  - reflect-direct-main-fail-loud：业务 session 直写 stones/main → SuperSessionRequiredError throw
 *  - reflect-idempotent：同 caller object 两次 talk(super) → 复用同一 super thread
 *  - reflect-happy-path：scan_changes → create_pr_for_versioned → mergeFeatBranch path（PR-Issue 落账 + reviewer approve → ready-to-merge）
 *  - reflect-reject：reviewer reject → PR-Issue 状态 rejected + author 收到通知
 *
 * 测试 pattern：直接驱动 method exec / persistable 原语，不走 LLM。
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveStoneIdentityRef,
  createPrIssue,
  loadPrIssue,
  updatePrIssue,
  aggregatePrApproval,
  SuperSessionRequiredError,
  type PrRecord,
} from "@ooc/core/persistable";
import { onReviewerAction } from "@ooc/builtins/agent/children/pr/approval-flow.js";
import {
  SUPER_SESSION_ID,
  SUPER_ALIAS_TARGET,
} from "@ooc/core/types/constants.js";

/**
 * 提前建 stones/.stones_repo 目录骨架（绕开 git --bare -b main 在 git 2.20 不支持的问题）。
 * 仅用于 PR-Issue 落账测试（不依赖真实 git）。
 */
async function ensureBareSkeleton(baseDir: string): Promise<void> {
  await mkdir(join(baseDir, "stones", ".stones_repo"), { recursive: true });
}

describe("issue D reflectable redesign", () => {
  describe("reflect-direct-main-fail-loud", () => {
    let baseDir: string;
    beforeAll(async () => {
      baseDir = await mkdtemp(join(tmpdir(), "ooc-reflect-failloud-"));
      await ensureBareSkeleton(baseDir);
    });
    afterAll(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    it("write mode + main canonical ref throws SuperSessionRequiredError", async () => {
      let thrown: unknown = undefined;
      try {
        await resolveStoneIdentityRef(
          { baseDir, objectId: "foo" /* no sessionId, no stonesBranch → main canonical */ },
          "write",
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SuperSessionRequiredError);
      expect((thrown as Error).message).toContain("direct main write forbidden");
    });

    it("super session + write mode still throws (without symbol bypass)", async () => {
      let thrown: unknown = undefined;
      try {
        await resolveStoneIdentityRef(
          { baseDir, sessionId: SUPER_SESSION_ID, objectId: "foo" },
          "write",
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SuperSessionRequiredError);
    });

    it("read mode + main canonical does NOT throw", async () => {
      const ref = await resolveStoneIdentityRef(
        { baseDir, objectId: "foo" },
        "read",
      );
      expect(ref).toBeDefined();
      expect(ref.baseDir).toBe(baseDir);
    });
  });

  describe("reflect-idempotent (talk super reuses thread via superThreadRef)", () => {
    let baseDir: string;
    beforeAll(async () => {
      baseDir = await mkdtemp(join(tmpdir(), "ooc-reflect-idem-"));
      await ensureBareSkeleton(baseDir);
    });
    afterAll(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    it("constant SUPER_ALIAS_TARGET == 'super'", () => {
      expect(SUPER_ALIAS_TARGET).toBe("super");
    });

    it("talk method (super alias) creates super flow thread + writes ref; reuse on 2nd call", async () => {
      // Drive talkMethod.exec directly with a faked ctx.
      const { talkMethod } = await import("@ooc/builtins/agent/executable/method.talk.js");
      const callerObjectId = "test_agent_idem";
      const callerData: { self: string; superThreadRef?: { threadId: string; sessionId: string } } = {
        self: "test agent",
      };

      let edits = 0;
      const ctx = {
        object: { id: callerObjectId, class: "_builtin/agent" },
        runtime: {
          instantiate: async () => {
            throw new Error("should not be called for super alias path");
          },
        },
        reportDataEdit: async () => {
          edits++;
        },
        args: {},
        dir: join(baseDir, "flows", "biz", "objects", callerObjectId),
        worldDir: baseDir,
        sessionId: "biz",
      } as any;
      const self = { data: callerData } as any;

      // 1st call → creates super thread
      const r1 = await talkMethod.exec(ctx, self, { target: "super", msg: "hello super" });
      expect(r1).toBeDefined();
      expect((r1 as any).refs).toBeDefined();
      expect((r1 as any).refs[0].id).toBeDefined();
      const threadId1 = (r1 as any).refs[0].id;
      expect(callerData.superThreadRef?.threadId).toBe(threadId1);
      expect(callerData.superThreadRef?.sessionId).toBe(SUPER_SESSION_ID);
      expect(edits).toBeGreaterThan(0);

      // thread.json exists
      const threadDir = join(
        baseDir,
        "flows",
        SUPER_SESSION_ID,
        "objects",
        callerObjectId,
        "threads",
        threadId1,
      );
      const s = await stat(join(threadDir, "thread.json"));
      expect(s.isFile()).toBe(true);

      // 2nd call → reuses same thread
      const r2 = await talkMethod.exec(ctx, self, { target: "super", msg: "follow up" });
      expect((r2 as any).refs[0].id).toBe(threadId1);
      expect((r2 as any).message).toContain("reused");

      // thread.json now has 2 messages
      const thread = JSON.parse(await readFile(join(threadDir, "thread.json"), "utf8"));
      expect(thread.messages.length).toBe(2);
      expect(thread.messages[0].content).toBe("hello super");
      expect(thread.messages[1].content).toBe("follow up");
    });

    it("trim+lowercase normalization: 'SUPER' / ' super ' alias still routes", async () => {
      const { talkMethod } = await import("@ooc/builtins/agent/executable/method.talk.js");
      const callerObjectId = "test_agent_norm";
      const callerData: { self: string; superThreadRef?: any } = { self: "test agent" };
      const ctx = {
        object: { id: callerObjectId, class: "_builtin/agent" },
        runtime: { instantiate: async () => { throw new Error("not super path"); } },
        reportDataEdit: async () => {},
        args: {},
        dir: "",
        worldDir: baseDir,
        sessionId: "biz",
      } as any;
      const self = { data: callerData } as any;

      const r1 = await talkMethod.exec(ctx, self, { target: " SUPER ", msg: "case-folded" });
      expect((r1 as any).refs[0].id).toBeDefined();
      expect(callerData.superThreadRef?.sessionId).toBe(SUPER_SESSION_ID);
    });
  });

  describe("reflect-happy-path (PR-Issue creation + reviewer approve → ready-to-merge)", () => {
    let baseDir: string;
    beforeAll(async () => {
      baseDir = await mkdtemp(join(tmpdir(), "ooc-reflect-happy-"));
      await ensureBareSkeleton(baseDir);
      // Disable auto-merge so we test ready-to-merge state (prAutoMerge default false anyway)
      await writeFile(join(baseDir, ".world.json"), JSON.stringify({ prAutoMerge: false }), "utf8");
    });
    afterAll(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    it("createPrIssue + aggregatePrApproval state machine", async () => {
      const record: Omit<PrRecord, "createdAt" | "updatedAt" | "reviews" | "status"> = {
        id: "test_pr_001",
        featBranch: "feat/test",
        authorThreadId: "thread_author",
        authorObjectId: "alice",
        baseDir,
        title: "test PR",
        paths: ["objects/bob/self.md"],
        reviewers: ["bob", "supervisor"],
      };
      const prId = await createPrIssue(baseDir, record);
      expect(prId).toBe("test_pr_001");
      let loaded = await loadPrIssue(baseDir, prId);
      expect(loaded).toBeDefined();
      expect(loaded!.status).toBe("pending");
      expect(loaded!.reviewers).toEqual(["bob", "supervisor"]);

      // 1 reviewer approves → still missing supervisor
      let agg = aggregatePrApproval(loaded!);
      expect(agg.approved).toBe(false);
      expect(agg.missing).toEqual(["bob", "supervisor"]);

      // bob approves
      const after1 = await updatePrIssue(baseDir, prId, {
        reviews: [{ reviewerId: "bob", action: "approve", ts: Date.now() }],
      });
      agg = aggregatePrApproval(after1);
      expect(agg.approved).toBe(false);
      expect(agg.missing).toEqual(["supervisor"]);

      // supervisor approves
      const after2 = await updatePrIssue(baseDir, prId, {
        reviews: [
          ...after1.reviews,
          { reviewerId: "supervisor", action: "approve", ts: Date.now() + 1 },
        ],
      });
      agg = aggregatePrApproval(after2);
      expect(agg.approved).toBe(true);
      expect(agg.rejected).toBe(false);
      expect(agg.missing).toEqual([]);
    });

    it("PR-Issue stored at stones/.stones_repo/.pr-issues/<id>.json (not git tracked)", async () => {
      const expectedPath = join(baseDir, "stones", ".stones_repo", ".pr-issues", "test_pr_001.json");
      const s = await stat(expectedPath);
      expect(s.isFile()).toBe(true);
    });

    it("onReviewerAction approve cascade → ready-to-merge (prAutoMerge=false)", async () => {
      // Fresh PR for this test
      const prId = "test_pr_002";
      await createPrIssue(baseDir, {
        id: prId,
        featBranch: "feat/cascade",
        authorThreadId: "thread_cascade",
        authorObjectId: "carol",
        baseDir,
        title: "cascade PR",
        paths: ["objects/dave/self.md"],
        reviewers: ["dave", "supervisor"],
      });

      // dave approves
      await onReviewerAction(baseDir, prId, "dave", "approve");
      let cur = await loadPrIssue(baseDir, prId);
      expect(cur!.status).toBe("pending"); // not all approved yet

      // supervisor approves → all approved → prAutoMerge=false → ready-to-merge
      await onReviewerAction(baseDir, prId, "supervisor", "approve");
      cur = await loadPrIssue(baseDir, prId);
      expect(cur!.status).toBe("ready-to-merge");
    });
  });

  describe("reflect-reject (PR-Issue rejected on first reject)", () => {
    let baseDir: string;
    beforeAll(async () => {
      baseDir = await mkdtemp(join(tmpdir(), "ooc-reflect-reject-"));
      await ensureBareSkeleton(baseDir);
    });
    afterAll(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    it("any reject vetoes → status=rejected immediately", async () => {
      const prId = "reject_pr";
      await createPrIssue(baseDir, {
        id: prId,
        featBranch: "feat/x",
        authorThreadId: "thread_x",
        authorObjectId: "ellen",
        baseDir,
        title: "rejected PR",
        paths: ["objects/frank/self.md"],
        reviewers: ["frank", "supervisor"],
      });
      // frank rejects
      await onReviewerAction(baseDir, prId, "frank", "reject", "nope, wrong direction");
      const cur = await loadPrIssue(baseDir, prId);
      expect(cur!.status).toBe("rejected");
      const agg = aggregatePrApproval(cur!);
      expect(agg.rejected).toBe(true);
    });

    it("aggregatePrApproval rejects override approves", () => {
      const record: PrRecord = {
        id: "agg",
        featBranch: "x",
        authorThreadId: "t",
        authorObjectId: "a",
        baseDir,
        title: "x",
        paths: [],
        reviewers: ["x", "y"],
        reviews: [
          { reviewerId: "x", action: "approve", ts: 1 },
          { reviewerId: "y", action: "reject", ts: 2 },
        ],
        status: "pending",
        createdAt: 0,
        updatedAt: 0,
      };
      const agg = aggregatePrApproval(record);
      expect(agg.rejected).toBe(true);
      expect(agg.approved).toBe(false);
    });
  });

  /**
   * Wiring assertion (issue F)：scan_changes method 经
   * `getSessionRegistry(sid).resolveVersionedFields(classId)` 解析 versionedFields 后
   * 调 `scanFlowChanges`——验证 wiring 真正接通（防 builtin copyFrom 时序问题致空、
   * 防 import 路径 typo），单测无法捕这层。
   *
   * 构造：agent 实例 in biz session 改 `.self` 字段（mock saveObjectData 经 flow data.json）。
   * 在 super session 内调 scan_changes method → 断言 `versioned_dirty` 桶非空且含 `self` 字段。
   */
  describe("reflect-wiring (issue F: scanChanges 经 registry.resolveVersionedFields 接通)", () => {
    let baseDir: string;
    beforeAll(async () => {
      baseDir = await mkdtemp(join(tmpdir(), "ooc-reflect-wiring-"));
      await ensureBareSkeleton(baseDir);
    });
    afterAll(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    it("scan_changes returns versioned_dirty containing self for agent classId", async () => {
      // 触发 builtin class registry 装配（_builtin/agent.versioned_fields = ["self"]）
      await import("@ooc/core/runtime/object-register.builtins");

      const callerObjectId = "agent_wiring_x";
      const bizSid = "biz-wiring";

      // 1. 业务 session flow：写 .flow.json (class=_builtin/agent) + data.json (改过 self)
      const flowObjDir = join(baseDir, "flows", bizSid, "objects", callerObjectId);
      await mkdir(flowObjDir, { recursive: true });
      await writeFile(
        join(flowObjDir, ".flow.json"),
        JSON.stringify({ class: "_builtin/agent" }),
        "utf8",
      );
      await writeFile(
        join(flowObjDir, "data.json"),
        JSON.stringify({ self: "NEW SELF VERSIONED", notes: "scratch" }),
        "utf8",
      );

      // 2. stones/main canonical：写 旧 self
      const stoneDir = join(baseDir, "stones", "main", "objects", callerObjectId);
      await mkdir(stoneDir, { recursive: true });
      await writeFile(
        join(stoneDir, "data.json"),
        JSON.stringify({ self: "OLD SELF" }),
        "utf8",
      );

      // 3. 在 super session 内调 scan_changes method
      const { reflectMethods } = await import(
        "@ooc/builtins/agent/children/thread/executable/method.reflect.js"
      );
      const scanChangesMethod = reflectMethods.find((m) => m.name === "scan_changes");
      expect(scanChangesMethod).toBeDefined();

      const ctx = {
        object: { id: "super-thread-1", class: "_builtin/agent/thread" },
        runtime: {},
        reportDataEdit: async () => {},
        args: {},
        dir: "",
        worldDir: baseDir,
        sessionId: SUPER_SESSION_ID,
      } as any;
      // thread.data.calleeObjectId = caller agent（super flow 内 thread 协议）
      const self = { data: { calleeObjectId: callerObjectId, id: "super-thread-1" } } as any;

      const result = await scanChangesMethod!.exec(ctx, self, {});

      // 断言：versioned_dirty 桶非空且含 self 字段
      const versionedDirty = (result as any).data.versioned_dirty as Array<{
        sessionId: string;
        field: string;
      }>;
      expect(versionedDirty.length).toBeGreaterThan(0);
      const selfEntry = versionedDirty.find((d) => d.field === "self");
      expect(selfEntry).toBeDefined();
      expect(selfEntry!.sessionId).toBe(bizSid);

      // notes 是非版本化字段 → unversioned_dirty 应含 notes
      const unversionedDirty = (result as any).data.unversioned_dirty as Array<{
        sessionId: string;
        field: string;
      }>;
      const notesEntry = unversionedDirty.find((d) => d.field === "notes");
      expect(notesEntry).toBeDefined();
    });
  });
});
