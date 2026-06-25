/**
 * WindowManager smoke test —— 验证 exec / close / instantiate 三原语行为。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { WindowManager } from "@ooc/builtins/agent/children/thread";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";

const SESSION = "test-window-manager";

async function makeThread(): Promise<ThreadContext> {
  const reg = getSessionRegistry(SESSION);
  const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
  const data = (await ctor.exec(
    { sessionId: SESSION, worldDir: "", dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
    { calleeObjectId: "_builtin/supervisor", message: "hello" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: "_builtin/agent/thread", data });
  return data;
}

describe("WindowManager", () => {
  beforeEach(() => {
    releaseSessionRegistry(SESSION);
  });
  afterEach(() => {
    releaseSessionRegistry(SESSION);
  });

  it("initial thread has structural windows (closable=false)", async () => {
    const t = await makeThread();
    expect(t.contextWindows.length).toBeGreaterThan(0);
    // every initial window is structural
    for (const w of t.contextWindows) {
      expect(w.closable).toBe(false);
    }
  });

  it("close on structural window throws", async () => {
    const t = await makeThread();
    const mgr = WindowManager.fromThread(t);
    expect(() => mgr.close("_builtin/filesystem")).toThrow(/not closable/);
  });

  it("instantiate creates child + appends to contextWindows", async () => {
    const t = await makeThread();
    const mgr = WindowManager.fromThread(t);
    const before = t.contextWindows.length;
    const ref = await mgr.instantiate({
      class: "_builtin/agent/todo",
      args: { content: "x" },
    });
    expect(ref.class).toBe("_builtin/agent/todo");
    expect(t.contextWindows.length).toBe(before + 1);
    expect(t.contextWindows[t.contextWindows.length - 1]?.id).toBe(ref.id);
  });

  it("exec object method changes data", async () => {
    const t = await makeThread();
    const mgr = WindowManager.fromThread(t);
    const ref = await mgr.instantiate({
      class: "_builtin/agent/todo",
      args: { content: "task1" },
    });
    const result = await mgr.exec(ref.id, "done", {});
    expect(result.message).toContain("done");
    const inst = getSessionRegistry(SESSION).getObject(ref.id);
    expect((inst?.data as { status: string }).status).toBe("done");
  });

  it("close non-structural window removes it", async () => {
    const t = await makeThread();
    const mgr = WindowManager.fromThread(t);
    const ref = await mgr.instantiate({
      class: "_builtin/agent/todo",
      args: { content: "x" },
    });
    expect(t.contextWindows.find((w) => w.id === ref.id)).toBeDefined();
    await mgr.close(ref.id);
    expect(t.contextWindows.find((w) => w.id === ref.id)).toBeUndefined();
  });
});
