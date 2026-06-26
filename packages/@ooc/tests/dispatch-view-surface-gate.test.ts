/**
 * dispatch surface 闸测试（issue M）。
 *
 * 兑现 issue E `method.public` 退役契约「未列入 readable.window decl 即不可调」——
 * thread-runtime.exec 在 object/guide method 命中后按 ref.window_view 解析 WindowViewDecl，
 * method 不在 surface 内则 throw（fail-loud）。
 *
 * 覆盖裁决 3：
 *  - case A: default-view thread ref 调 reply（仅 self surface）→ throw。
 *  - case B: default-view thread ref 调 say（在 default surface）→ surface 闸过（不抛 not-in-surface）。
 *  - case C: 业务 session default-view thread ref 调 scan_changes（仅 super surface）→ throw（surface 闸先于 requireSuperSession）。
 *  - case D: super-view thread ref 调 set_transcript_window（window method）—— issue K + M 联合守门。
 *
 * case E（caller 持 super-view ref 业务 sessionId 调 reflect → surface 通过 + requireSuperSession fail）
 *   拆 reflectable followup、不在本 issue scope。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { ThreadRuntime } from "@ooc/builtins/agent/children/thread/runtime/thread-runtime";
import { SUPER_SESSION_ID } from "@ooc/core/types/constants";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class";

const SESSION = "test-issue-m-dispatch-surface";

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

function attachPeerThreadRef(t: ThreadContext, peerId: string, sessionId: string, windowView?: string) {
  const peerRef: OocObjectRef = {
    id: peerId,
    class: "_builtin/agent/thread",
    createdAt: Date.now(),
    ...(windowView ? { window_view: windowView } : {}),
  };
  const reg = getSessionRegistry(sessionId);
  reg.setObject({
    id: peerId,
    class: "_builtin/agent/thread",
    data: {
      id: peerId,
      calleeObjectId: "test-callee",
      sessionId,
      status: "running",
      messages: [],
      events: [],
      contextWindows: [],
    } as ThreadContext,
  });
  t.contextWindows.push(peerRef);
  return peerRef;
}

describe("dispatch surface gate (issue M)", () => {
  beforeEach(() => {
    releaseSessionRegistry(SESSION);
    releaseSessionRegistry(SUPER_SESSION_ID);
  });
  afterEach(() => {
    releaseSessionRegistry(SESSION);
    releaseSessionRegistry(SUPER_SESSION_ID);
  });

  describe("case A: default-view ref 调 reply（仅 self surface）→ throw", () => {
    it("caller 持 default-view thread ref 调 reply 报 not-in-surface", async () => {
      const t = await makeThread(SESSION);
      attachPeerThreadRef(t, "peer-thread-A", SESSION);
      const runtime = ThreadRuntime.fromThread(t, { worldDir: "" });
      await expect(
        runtime.exec("peer-thread-A", "reply", { content: "test" }),
      ).rejects.toThrow(/not in surface of view "default"/);
    });
  });

  describe("case B: default-view ref 调 say（在 default surface）→ surface 闸过", () => {
    it("调 say 不抛 not-in-surface（业务底层可能抛其它，但 surface 闸先放行）", async () => {
      const t = await makeThread(SESSION);
      attachPeerThreadRef(t, "peer-thread-B", SESSION);
      const runtime = ThreadRuntime.fromThread(t, { worldDir: "" });
      try {
        await runtime.exec("peer-thread-B", "say", { content: "hello" });
      } catch (e) {
        const msg = (e as Error).message;
        // surface 闸不抛 → 业务底层错误允许（如 wakeSession 缺失等），但绝不能是 not in surface
        expect(msg).not.toMatch(/not in surface/);
      }
    });
  });

  describe("case C: default-view ref 调 scan_changes（仅 super surface）→ throw", () => {
    it("业务 session default-view 调 scan_changes 报 not-in-surface（先于 requireSuperSession）", async () => {
      const t = await makeThread(SESSION);
      attachPeerThreadRef(t, "peer-thread-C", SESSION);
      const runtime = ThreadRuntime.fromThread(t, { worldDir: "" });
      await expect(
        runtime.exec("peer-thread-C", "scan_changes", {}),
      ).rejects.toThrow(/not in surface of view "default"/);
    });
  });

  describe("case D: super-view ref 调 set_transcript_window —— issue K+M 联合守门", () => {
    it("super-view ref 调 window method 经 issue K view-aware lookup + issue M surface 通过", async () => {
      const t = await makeThread(SESSION);
      // 手动 super-view ref —— set_transcript_window 是 window method、在三视角 window_methods 都注册
      attachPeerThreadRef(t, "peer-thread-D", SESSION, "super");
      const runtime = ThreadRuntime.fromThread(t, { worldDir: "" });
      // window method 不走 assertInSurface（surface 闸只对 object/guide method），
      // 走 resolveWindowMethod（issue K）—— 验 super decl 含 set_transcript_window window_method
      const result = await runtime.exec("peer-thread-D", "set_transcript_window", { tail: 5 });
      expect(result).toBeDefined();
      const refAfter = t.contextWindows.find((w) => w.id === "peer-thread-D")!;
      const vp = (refAfter.data as { transcriptViewport?: { tail?: number } } | undefined)?.transcriptViewport;
      expect(vp?.tail).toBe(5);
    });
  });
});
