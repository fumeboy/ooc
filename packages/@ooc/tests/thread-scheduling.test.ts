/**
 * thread cross-session scheduling — issue G e2e tests.
 *
 * 4 cases:
 *  - case 1: peer say → wakeSession 被调（同 session sid）+ self.data.messages 推进
 *  - case 2: super alias talk → super thread.json 含 callerSessionId + wakeSession("super") 被调
 *  - case 3: super reflect findCallerSessionId 直读 self.data.callerSessionId
 *  - case 4: super reply 反向 → wakeSession(callerSessionId) 被调
 *
 * 测试 pattern：直接驱动 method.exec / 构造 fake ctx 注入 mock wakeSession spy。
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SUPER_SESSION_ID,
  THREAD_CLASS_ID,
} from "@ooc/core/types/constants.js";
import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/children/thread/types.js";

/**
 * 构造一个 fake ExecutableContext：runtime.scheduleSession 用 spy 记录调用、其它 RuntimeHandle 方法
 * 在本组 test 用不到时抛错（守护：避免误用走真实 runtime 路径）。
 */
function makeFakeCtx(opts: {
  objectId: string;
  worldDir: string;
  sessionId: string;
}): {
  ctx: any;
  wakeCalls: string[];
  dataEdits: number;
} {
  const wakeCalls: string[] = [];
  let dataEdits = 0;
  const ctx = {
    object: { id: opts.objectId, class: THREAD_CLASS_ID },
    runtime: {
      instantiate: async () => {
        throw new Error("instantiate should not be called in cross-session scheduling tests");
      },
      scheduleSession: (sid: string) => {
        wakeCalls.push(sid);
      },
    },
    reportDataEdit: async () => {
      dataEdits++;
    },
    args: {},
    dir: "",
    worldDir: opts.worldDir,
    sessionId: opts.sessionId,
  };
  return {
    ctx,
    wakeCalls,
    get dataEdits() {
      return dataEdits;
    },
  } as any;
}

describe("issue G thread cross-session scheduling", () => {
  describe("case 1: peer say → 同 session wakeSession 被调 + transcript 推进一轮", () => {
    let baseDir: string;
    beforeAll(async () => {
      baseDir = await mkdtemp(join(tmpdir(), "ooc-issueg-case1-"));
    });
    afterAll(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    it("普通 thread.say → scheduleSession(self.sessionId) 调 + messages 数组 +1", async () => {
      const { sayMethod } = await import(
        "@ooc/builtins/agent/children/thread/executable/method.say.js"
      );
      const fake = makeFakeCtx({
        objectId: "thread_peer_1",
        worldDir: baseDir,
        sessionId: "biz-1",
      });

      // 普通 thread：sessionId="biz-1"，callerSessionId 必须 undefined
      const threadData: ThreadContext = {
        id: "thread_peer_1",
        calleeObjectId: "callee_obj",
        sessionId: "biz-1",
        status: "running",
        messages: [],
        events: [],
        contextWindows: [],
      };
      const self = { data: threadData } as any;

      const lengthBefore = threadData.messages.length;
      await sayMethod.exec(fake.ctx, self, { msg: "hello peer" });

      // 1. transcript 真被推进一轮（messages 数组 +1）
      expect(threadData.messages.length).toBe(lengthBefore + 1);
      const last = threadData.messages[threadData.messages.length - 1] as ThreadMessage;
      expect(last.content).toBe("hello peer");
      expect(last.from).toBe("caller");

      // 2. wakeSession 被调用，目标 sid = 自身 sessionId（普通 thread 无 callerSessionId）
      expect(fake.wakeCalls).toEqual(["biz-1"]);

      // 3. reportDataEdit 至少 1 次
      expect(fake.dataEdits).toBeGreaterThan(0);
    });
  });

  describe("case 2: super alias talk → callerSessionId 写盘 + wakeSession('super')", () => {
    let baseDir: string;
    beforeAll(async () => {
      baseDir = await mkdtemp(join(tmpdir(), "ooc-issueg-case2-"));
    });
    afterAll(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    it("talk(target='super') 写盘 super thread.json 含 callerSessionId + wake super", async () => {
      const { talkMethod } = await import(
        "@ooc/builtins/agent/executable/method.talk.js"
      );

      const callerObjectId = "agent_caller_g";
      const callerSessionId = "biz-2";

      const fake = makeFakeCtx({
        objectId: callerObjectId,
        worldDir: baseDir,
        sessionId: callerSessionId,
      });

      const callerData: {
        self: string;
        superThreadRef?: { threadId: string; sessionId: string };
      } = { self: "issueg agent" };
      const self = { data: callerData } as any;

      const r1 = await talkMethod.exec(fake.ctx, self, {
        target: "super",
        msg: "hello super",
      });
      const refs = (r1 as any).refs as { id: string }[];
      expect(refs).toBeDefined();
      const threadId = refs[0].id;

      // 1. wakeSession("super") 被调
      expect(fake.wakeCalls).toContain(SUPER_SESSION_ID);

      // 2. super thread.json 含 callerSessionId 字段 = caller business sid
      const threadJsonPath = join(
        baseDir,
        "flows",
        SUPER_SESSION_ID,
        "objects",
        callerObjectId,
        "threads",
        threadId,
        "thread.json",
      );
      const threadJson = JSON.parse(await readFile(threadJsonPath, "utf8"));
      expect(threadJson.callerSessionId).toBe(callerSessionId);
      expect(threadJson.sessionId).toBe(SUPER_SESSION_ID);
    });

    it("已 bound 复用路径（带 msg append）也调 wakeSession('super')", async () => {
      const { talkMethod } = await import(
        "@ooc/builtins/agent/executable/method.talk.js"
      );
      const callerObjectId = "agent_caller_g_reuse";
      const callerSessionId = "biz-2-reuse";

      const fake1 = makeFakeCtx({
        objectId: callerObjectId,
        worldDir: baseDir,
        sessionId: callerSessionId,
      });
      const callerData: { self: string; superThreadRef?: any } = { self: "x" };
      const selfRef = { data: callerData } as any;

      await talkMethod.exec(fake1.ctx, selfRef, { target: "super", msg: "first" });
      // 第二次复用（同一 callerData superThreadRef 已被写）
      const fake2 = makeFakeCtx({
        objectId: callerObjectId,
        worldDir: baseDir,
        sessionId: callerSessionId,
      });
      const r2 = await talkMethod.exec(fake2.ctx, selfRef, { target: "super", msg: "second" });
      expect((r2 as any).message).toContain("reused");
      expect(fake2.wakeCalls).toContain(SUPER_SESSION_ID);
    });
  });

  describe("case 3: super reflect 直读 self.data.callerSessionId", () => {
    let baseDir: string;
    beforeAll(async () => {
      baseDir = await mkdtemp(join(tmpdir(), "ooc-issueg-case3-"));
      // bare skeleton（reflect method 不直接需要 stones repo 但 scan 不会爆）
      await mkdir(join(baseDir, "stones", ".stones_repo"), { recursive: true });
    });
    afterAll(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    it("scan_changes 当 self.data.callerSessionId 存在 → 仅扫该 session、不退化扫表", async () => {
      // 触发 builtin class registry 装配（保证 agent.versioned_fields=["self"]）
      await import("@ooc/core/runtime/object-register.builtins");

      const callerObjectId = "agent_for_hint";
      const bizSid = "biz-3";
      const otherSid = "biz-3-other";

      // 业务 session1 (hint 指的)：dirty
      const flowObjDir = join(baseDir, "flows", bizSid, "objects", callerObjectId);
      await mkdir(flowObjDir, { recursive: true });
      await writeFile(
        join(flowObjDir, ".flow.json"),
        JSON.stringify({ class: "_builtin/agent" }),
        "utf8",
      );
      await writeFile(
        join(flowObjDir, "data.json"),
        JSON.stringify({ self: "DIRTY HINT SID" }),
        "utf8",
      );

      // 另一业务 session：也 dirty 但不应被扫到（hint 路径）
      const otherFlowDir = join(baseDir, "flows", otherSid, "objects", callerObjectId);
      await mkdir(otherFlowDir, { recursive: true });
      await writeFile(
        join(otherFlowDir, ".flow.json"),
        JSON.stringify({ class: "_builtin/agent" }),
        "utf8",
      );
      await writeFile(
        join(otherFlowDir, "data.json"),
        JSON.stringify({ self: "WRONG SID" }),
        "utf8",
      );

      // stones/main 旧 self
      const stoneDir = join(baseDir, "stones", "main", "objects", callerObjectId);
      await mkdir(stoneDir, { recursive: true });
      await writeFile(
        join(stoneDir, "data.json"),
        JSON.stringify({ self: "OLD" }),
        "utf8",
      );

      const { reflectMethods } = await import(
        "@ooc/builtins/agent/children/thread/executable/method.reflect.js"
      );
      const scanChangesMethod = reflectMethods.find((m) => m.name === "scan_changes")!;

      const ctx = {
        object: { id: "super-thread-hint", class: THREAD_CLASS_ID },
        runtime: {},
        reportDataEdit: async () => {},
        args: {},
        dir: "",
        worldDir: baseDir,
        sessionId: SUPER_SESSION_ID,
      } as any;
      // self.data.callerSessionId = bizSid (hint)
      const self = {
        data: {
          calleeObjectId: callerObjectId,
          id: "super-thread-hint",
          callerSessionId: bizSid,
        },
      } as any;

      const result = await scanChangesMethod.exec(ctx, self, {});
      const versionedDirty = (result as any).data.versioned_dirty as Array<{
        sessionId: string;
        field: string;
      }>;
      // 只有 hint session 被扫到——另一 session 也 dirty 但不应在结果中
      expect(versionedDirty.every((d) => d.sessionId === bizSid)).toBe(true);
      expect(versionedDirty.find((d) => d.sessionId === otherSid)).toBeUndefined();
    });

    it("scan_changes 当 callerSessionId 缺失 → 退化扫所有 + 命中后自愈写回 self.data", async () => {
      const callerObjectId = "agent_for_heal";
      const bizSid = "biz-3-heal";

      const flowObjDir = join(baseDir, "flows", bizSid, "objects", callerObjectId);
      await mkdir(flowObjDir, { recursive: true });
      await writeFile(
        join(flowObjDir, ".flow.json"),
        JSON.stringify({ class: "_builtin/agent" }),
        "utf8",
      );
      await writeFile(
        join(flowObjDir, "data.json"),
        JSON.stringify({ self: "HEAL TEST" }),
        "utf8",
      );

      const stoneDir = join(baseDir, "stones", "main", "objects", callerObjectId);
      await mkdir(stoneDir, { recursive: true });
      await writeFile(
        join(stoneDir, "data.json"),
        JSON.stringify({ self: "OLD" }),
        "utf8",
      );

      const { reflectMethods } = await import(
        "@ooc/builtins/agent/children/thread/executable/method.reflect.js"
      );
      const scanChangesMethod = reflectMethods.find((m) => m.name === "scan_changes")!;

      let edits = 0;
      const ctx = {
        object: { id: "super-thread-heal", class: THREAD_CLASS_ID },
        runtime: {},
        reportDataEdit: async () => {
          edits++;
        },
        args: {},
        dir: "",
        worldDir: baseDir,
        sessionId: SUPER_SESSION_ID,
      } as any;
      // 老 super thread：无 callerSessionId
      const self = {
        data: {
          calleeObjectId: callerObjectId,
          id: "super-thread-heal",
        },
      } as any;

      await scanChangesMethod.exec(ctx, self, {});
      // 自愈：self.data.callerSessionId 已被写回 bizSid + reportDataEdit 被调
      expect(self.data.callerSessionId).toBe(bizSid);
      expect(edits).toBeGreaterThan(0);
    });
  });

  describe("case 4: super thread.reply → wakeSession(self.callerSessionId) 反向唤醒", () => {
    it("replyMethod 反向 wake business session", async () => {
      const { replyMethod } = await import(
        "@ooc/builtins/agent/children/thread/executable/method.say.js"
      );
      const callerSid = "biz-4";
      const wakeCalls: string[] = [];
      const ctx = {
        object: { id: "super_thread_4", class: THREAD_CLASS_ID },
        runtime: {
          scheduleSession: (sid: string) => {
            wakeCalls.push(sid);
          },
        },
        reportDataEdit: async () => {},
        args: {},
        dir: "",
        worldDir: "",
        sessionId: SUPER_SESSION_ID,
      } as any;
      const threadData: ThreadContext = {
        id: "super_thread_4",
        calleeObjectId: "caller_obj_4",
        sessionId: SUPER_SESSION_ID,
        callerSessionId: callerSid,
        status: "running",
        messages: [],
        events: [],
        contextWindows: [],
      };
      const self = { data: threadData } as any;

      await replyMethod.exec(ctx, self, { msg: "reply payload" });

      // wakeSession 被调用、目标 sid = callerSessionId（业务 session 反向唤醒）
      expect(wakeCalls).toEqual([callerSid]);
      // transcript 推进
      expect(threadData.messages.length).toBe(1);
      expect(threadData.messages[0]!.content).toBe("reply payload");
      expect(threadData.messages[0]!.from).toBe("callee");
    });
  });
});
