/**
 * thread readable 三视角投影测试（issue I）。
 *
 * 覆盖裁决 9：
 *  - case A: thread.construct 后 contextWindows 含 self-view ref，id = `w_creator_<threadId>`。
 *  - case B: computeProjectionClass 三档（default / self / super）分别命中。
 *  - case C: refcount self-ref guard —— self-view ref 不计入 refcount，外部引用计入。
 *  - case D: dispatch reply 经 self-view ref id → resolveObjectMethod 命中 → exec 通。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { computeRefcount } from "@ooc/core/runtime/refcount";
import { threadWindowIdOf } from "@ooc/core/types/context-window";
import { SUPER_SESSION_ID } from "@ooc/core/types/constants";
import { computeProjectionClass } from "@ooc/builtins/agent/children/thread/readable/index";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class";

const SESSION = "test-thread-readable-views";
const SUPER = SUPER_SESSION_ID;

async function makeThread(sessionId: string): Promise<ThreadContext> {
  const reg = getSessionRegistry(sessionId);
  const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
  const data = (await ctor.exec(
    { sessionId, worldDir: "", dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
    { calleeObjectId: "_builtin/supervisor", message: "hi" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: "_builtin/agent/thread", data });
  return data;
}

describe("thread readable three-views (issue I)", () => {
  beforeEach(() => {
    releaseSessionRegistry(SESSION);
    releaseSessionRegistry(SUPER);
  });
  afterEach(() => {
    releaseSessionRegistry(SESSION);
    releaseSessionRegistry(SUPER);
  });

  describe("case A: thread.construct contextWindows 含 self-view ref", () => {
    it("self-view ref 存在且 id = threadWindowIdOf(threadId)", async () => {
      const t = await makeThread(SESSION);
      const expectedId = threadWindowIdOf(t.id);
      const selfRef = t.contextWindows.find((w) => w.id === expectedId);
      expect(selfRef).toBeDefined();
      expect(selfRef!.class).toBe("_builtin/agent/thread");
      expect(selfRef!.closable).toBe(false);
    });

    it("self-view ref id 形如 `w_creator_<threadId>`", async () => {
      const t = await makeThread(SESSION);
      const selfRef = t.contextWindows.find(
        (w) => w.id === threadWindowIdOf(t.id),
      );
      expect(selfRef!.id.startsWith("w_creator_")).toBe(true);
      expect(selfRef!.id.endsWith(t.id)).toBe(true);
    });

    it("callee agent ref class 不再为字面 \"self\"（class:\"self\" bug 修复）", async () => {
      const t = await makeThread(SESSION);
      const calleeRef = t.contextWindows.find(
        (w) => w.id === "_builtin/supervisor",
      );
      expect(calleeRef).toBeDefined();
      expect(calleeRef!.class).toBe("_builtin/agent");
    });
  });

  describe("case B: computeProjectionClass 三档命中", () => {
    function mkRef(id: string): OocObjectRef {
      return { id, class: "_builtin/agent/thread", createdAt: Date.now() };
    }

    it("self-view ref + 普通 session → self", () => {
      const td: ThreadContext = {
        id: "t1",
        calleeObjectId: "c",
        sessionId: "biz-1",
        status: "running",
        messages: [],
        events: [],
        contextWindows: [],
      };
      const ref = mkRef(threadWindowIdOf("t1"));
      expect(computeProjectionClass(td, ref)).toBe("self");
    });

    it("self-view ref + super session → super", () => {
      const td: ThreadContext = {
        id: "t2",
        calleeObjectId: "c",
        sessionId: SUPER,
        status: "running",
        messages: [],
        events: [],
        contextWindows: [],
      };
      const ref = mkRef(threadWindowIdOf("t2"));
      expect(computeProjectionClass(td, ref)).toBe("super");
    });

    it("peer-view ref（id 不是 self-view id）→ default", () => {
      const td: ThreadContext = {
        id: "t3",
        calleeObjectId: "c",
        sessionId: "biz-1",
        status: "running",
        messages: [],
        events: [],
        contextWindows: [],
      };
      const ref = mkRef("some_other_window_id");
      expect(computeProjectionClass(td, ref)).toBe("default");
    });

    it("peer-view ref 即使在 super session 仍 → default（视角优先）", () => {
      const td: ThreadContext = {
        id: "t4",
        calleeObjectId: "c",
        sessionId: SUPER,
        status: "running",
        messages: [],
        events: [],
        contextWindows: [],
      };
      const ref = mkRef("some_other_window_id");
      expect(computeProjectionClass(td, ref)).toBe("default");
    });
  });

  describe("case C: refcount self-ref guard（issue I）", () => {
    it("inst 自指（contextWindows 引用自身 inst.id）不计入 refcount", async () => {
      const t = await makeThread(SESSION);
      const reg = getSessionRegistry(SESSION);
      // 人造一条对自身 inst.id 的引用——guard 必须跳过自指边
      t.contextWindows.push({
        id: t.id,
        class: "_builtin/agent/thread",
        createdAt: Date.now(),
      });
      reg.setObject({ id: t.id, class: "_builtin/agent/thread", data: t });
      const rc = computeRefcount(SESSION, t.id, reg);
      // 无外部引用 → guard 跳过自指 → refcount === 0
      expect(rc).toBe(0);
    });

    it("外部 inst 引用同一 id 仍计入（self-ref guard 仅对自指边生效）", async () => {
      const t = await makeThread(SESSION);
      const reg = getSessionRegistry(SESSION);
      // t 自己持自指
      t.contextWindows.push({
        id: t.id,
        class: "_builtin/agent/thread",
        createdAt: Date.now(),
      });
      // 第二条 thread 引用 t.id
      const t2 = await makeThread(SESSION);
      t2.contextWindows.push({
        id: t.id,
        class: "_builtin/agent/thread",
        createdAt: Date.now(),
      });
      reg.setObject({ id: t.id, class: "_builtin/agent/thread", data: t });
      reg.setObject({ id: t2.id, class: "_builtin/agent/thread", data: t2 });
      const rc = computeRefcount(SESSION, t.id, reg);
      // t 的自指被跳过；t2 的外部引用计入 → refcount === 1
      expect(rc).toBe(1);
    });

    it("thread self-view ref（id=threadWindowIdOf(threadId)）不影响 thread.id 的 refcount 计算", async () => {
      const t = await makeThread(SESSION);
      const reg = getSessionRegistry(SESSION);
      // construct 已 push self-view ref（id=`w_creator_<threadId>`）+ callee ref + 工具窗
      // 但这些 ref.id 都不是 t.id 本身 → computeRefcount(t.id) === 0（无外部引用）
      const rc = computeRefcount(SESSION, t.id, reg);
      expect(rc).toBe(0);
    });
  });

  describe("case D: dispatch reply 经 self-view ref id 命中（issue I）", () => {
    it("ThreadRuntime.exec(selfViewId, 'reply') → reply method 执行 + transcript 推进 +1", async () => {
      const { ThreadRuntime } = await import(
        "@ooc/builtins/agent/children/thread/runtime/thread-runtime"
      );
      const t = await makeThread(SESSION);
      const selfViewId = threadWindowIdOf(t.id);

      // self-view ref 已在 construct 时 push 进 contextWindows
      const selfRef = t.contextWindows.find((w) => w.id === selfViewId);
      expect(selfRef).toBeDefined();

      // ThreadRuntime.exec 内部 resolveObjectMethod(ref.class, "reply") 应命中
      // （ref.class = "_builtin/agent/thread"; reply method 在 class executable 中注册）
      const runtime = ThreadRuntime.fromThread(t);
      const lenBefore = t.messages.length;

      const result = await runtime.exec(selfViewId, "reply", { msg: "self-view reply works" });
      expect((result as { message?: string }).message).toContain("delivered");
      expect(t.messages.length).toBe(lenBefore + 1);
      const last = t.messages[t.messages.length - 1]!;
      expect(last.content).toBe("self-view reply works");
      expect(last.from).toBe("callee");
    });
  });
});
