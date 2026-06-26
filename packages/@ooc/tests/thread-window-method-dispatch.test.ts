/**
 * thread runtime window method dispatch 测试（issue K）。
 *
 * 修复 thread-runtime.ts:132 lookup key bug——issue J 前 `resolveWindowMethod(ref.class, ref.class, methodName)`
 * 第二参误传 class id 当 windowView，永远 miss；issue K 改 `ref.window_view ?? DEFAULT_WINDOW_VIEW`。
 *
 * 覆盖裁决 3：
 *  - case A: self-view thread ref（window_view="self"）→ set_transcript_window {tail:5} → 真改 ref.data.transcriptViewport。
 *  - case C: file ref（window_view 缺省 → DEFAULT_WINDOW_VIEW）→ set_viewport → 真改 viewport。
 *  - case D: super flow self-view ref（window_view="super"）→ set_transcript_window 同名 method 仍命中（三视角注册同 3 method）。
 *
 * 跳过 case B（miss throw）—— issue K 裁决：catch path 不是本 issue 引入、不必夹带。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionRegistry,
  releaseSessionRegistry,
  DEFAULT_WINDOW_VIEW,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { ThreadRuntime } from "@ooc/builtins/agent/children/thread/runtime/thread-runtime";
import { threadWindowIdOf } from "@ooc/core/types/context-window";
import { SUPER_SESSION_ID } from "@ooc/core/types/constants";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class";

const SESSION = "test-issue-k-window-dispatch";
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

describe("thread runtime window method dispatch (issue K)", () => {
  beforeEach(() => {
    releaseSessionRegistry(SESSION);
    releaseSessionRegistry(SUPER);
  });
  afterEach(() => {
    releaseSessionRegistry(SESSION);
    releaseSessionRegistry(SUPER);
  });

  describe("case A: self-view thread ref → set_transcript_window 真改 win", () => {
    it("dispatch set_transcript_window {tail:5} 真写入 ref.data.transcriptViewport", async () => {
      const t = await makeThread(SESSION);
      const selfRefIdx = t.contextWindows.findIndex(
        (w) => w.id === threadWindowIdOf(t.id),
      );
      expect(selfRefIdx).toBeGreaterThanOrEqual(0);
      const selfRef = t.contextWindows[selfRefIdx]!;
      expect(selfRef.window_view).toBe("self");

      const runtime = ThreadRuntime.fromThread(t, {
        worldDir: "",
      });
      const result = await runtime.exec(selfRef.id, "set_transcript_window", { tail: 5 });

      // window method 返 void → ObjectMethodResult{}
      expect(result).toBeDefined();
      // 真改 ref.data（即 win 投影态）
      const refAfter = t.contextWindows[selfRefIdx]!;
      const vp = (refAfter.data as { transcriptViewport?: { tail?: number } } | undefined)?.transcriptViewport;
      expect(vp?.tail).toBe(5);
    });
  });

  describe("case C: file ref（window_view 缺省）→ set_viewport 真改", () => {
    it("file ref window_view 缺省走 DEFAULT_WINDOW_VIEW 命中 set_viewport", async () => {
      const t = await makeThread(SESSION);
      const reg = getSessionRegistry(SESSION);
      // 模拟一个 file ref（window_view 缺省，对应 DEFAULT_WINDOW_VIEW="default"）
      const fileObjId = "test-file-1";
      reg.setObject({
        id: fileObjId,
        class: "_builtin/filesystem/file",
        data: {
          path: "/tmp/test.txt",
          content: "line1\nline2\nline3\nline4\nline5",
          totalLines: 5,
        },
      });
      const fileRef: OocObjectRef = {
        id: fileObjId,
        class: "_builtin/filesystem/file",
        createdAt: Date.now(),
        // window_view 缺省 — 此处验证 dispatch fallback DEFAULT_WINDOW_VIEW
      };
      t.contextWindows.push(fileRef);

      // sanity：DEFAULT_WINDOW_VIEW 是 "default"
      expect(DEFAULT_WINDOW_VIEW).toBe("default");

      const runtime = ThreadRuntime.fromThread(t, { worldDir: "" });
      const result = await runtime.exec(fileObjId, "set_viewport", {
        line_start: 2,
        line_end: 4,
      });

      expect(result).toBeDefined();
      // file viewport 应真改：ref.data.viewport 写入（schema 字段 lineStart/lineEnd，camelCase）
      const refAfter = t.contextWindows.find((w) => w.id === fileObjId)!;
      const viewport = (refAfter.data as { viewport?: { lineStart?: number; lineEnd?: number } } | undefined)?.viewport;
      expect(viewport?.lineStart).toBe(2);
      expect(viewport?.lineEnd).toBe(4);
    });
  });

  describe("case D: super flow self-view ref → set_transcript_window 命中（三视角分发）", () => {
    it("super-view ref（window_view='super'）调 set_transcript_window 仍命中", async () => {
      const t = await makeThread(SUPER);
      const selfRefIdx = t.contextWindows.findIndex(
        (w) => w.id === threadWindowIdOf(t.id),
      );
      const selfRef = t.contextWindows[selfRefIdx]!;
      // super flow 内 thread.construct 应写 window_view: "super"（method.talk createSuperThread 同）
      // 注意：thread.construct 不区分 sessionId，恒写 "self"；super 路径由 method.talk createSuperThread 写 "super"。
      // 此 test 走 thread.construct 直接（不经 method.talk），所以 window_view 仍是 "self"。
      // 重点验：即便 window_view="self"，三视角 readable 均注册 set_transcript_window —— dispatch 命中。
      expect(selfRef.window_view).toBe("self");

      const runtime = ThreadRuntime.fromThread(t, {
        worldDir: "",
      });
      const result = await runtime.exec(selfRef.id, "set_transcript_window", { tail: 10 });
      expect(result).toBeDefined();
      const refAfter = t.contextWindows[selfRefIdx]!;
      const vp = (refAfter.data as { transcriptViewport?: { tail?: number } } | undefined)?.transcriptViewport;
      expect(vp?.tail).toBe(10);

      // 进一步：手动模拟 super-view ref（window_view="super"）—— 三视角同 method 仍命中
      const superRef: OocObjectRef = {
        id: t.id, // thread 自身 id（非 threadWindowIdOf）→ 跨视角调
        class: "_builtin/agent/thread",
        window_view: "super",
        createdAt: Date.now(),
      };
      t.contextWindows.push(superRef);
      const result2 = await runtime.exec(t.id, "set_transcript_window", { tail: 7 });
      expect(result2).toBeDefined();
      const superRefAfter = t.contextWindows.find((w) => w.id === t.id)!;
      const vp2 = (superRefAfter.data as { transcriptViewport?: { tail?: number } } | undefined)?.transcriptViewport;
      expect(vp2?.tail).toBe(7);
    });
  });
});
