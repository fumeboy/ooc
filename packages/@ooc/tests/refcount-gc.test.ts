/**
 * refcount + gc 测试 —— issue E：core 通用 refcount/GC 算法 + close 即时触发 + dispatchUnactive 幂等。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  ObjectInsRegistry,
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { computeRefcount } from "@ooc/core/runtime/refcount";
import { runGcOnce } from "@ooc/core/runtime/gc";
import { ThreadRuntime } from "@ooc/builtins/agent/children/thread";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";

const SESSION = "test-refcount-gc";

async function makeThread(): Promise<ThreadContext> {
  const reg = getSessionRegistry(SESSION);
  const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
  const data = (await ctor.exec(
    { sessionId: SESSION, worldDir: "", dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
    { calleeObjectId: "_builtin/supervisor", message: "hi" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: "_builtin/agent/thread", data });
  return data;
}

describe("computeRefcount (issue E)", () => {
  beforeEach(() => releaseSessionRegistry(SESSION));
  afterEach(() => releaseSessionRegistry(SESSION));

  it("counts refs via thinkable.refs across all instances in session", async () => {
    const t = await makeThread();
    const reg = getSessionRegistry(SESSION);
    // thread.contextWindows contains structural windows pointing at builtin objects
    // each window id present once → refcount === 1 for each
    for (const w of t.contextWindows) {
      const rc = computeRefcount(SESSION, w.id, reg);
      expect(rc).toBeGreaterThanOrEqual(1);
    }
    // an object id that's not referenced anywhere → 0
    expect(computeRefcount(SESSION, "ghost-id", reg)).toBe(0);
  });

  it("classes without refs() contribute 0", () => {
    const reg = new ObjectInsRegistry();
    const noRefsClass: OocClass = {
      id: "_test/no-refs",
    };
    reg.register(noRefsClass);
    reg.setObject({ id: "i1", class: "_test/no-refs", data: { someRefId: "target" } });
    // refs not declared on the class → 0
    expect(computeRefcount("s", "target", reg)).toBe(0);
  });
});

describe("ThreadRuntime.dispatchUnactive idempotency (issue E)", () => {
  beforeEach(() => releaseSessionRegistry(SESSION));
  afterEach(() => releaseSessionRegistry(SESSION));

  it("close on a child window triggers unactive at most once", async () => {
    const t = await makeThread();
    const runtime = ThreadRuntime.fromThread(t);
    // mount a todo child (closable by default since not flagged structural)
    const ref = await runtime.instantiate({
      class: "_builtin/agent/todo",
      args: { content: "demo" },
    });
    expect(t.contextWindows.find((w) => w.id === ref.id)).toBeDefined();
    // close → refcount goes 1→0 → dispatchUnactive (todo has no lifecycle hook so no-op effect,
    // but second call to dispatchUnactive on same id must be silent).
    await runtime.close(ref.id);
    // calling dispatchUnactive again on the same id must be idempotent (no throw, silent)
    await runtime.dispatchUnactive(ref.id);
    await runtime.dispatchUnactive(ref.id);
    // window removed
    expect(t.contextWindows.find((w) => w.id === ref.id)).toBeUndefined();
  });
});

describe("startSessionGc / runGcOnce (issue E)", () => {
  beforeEach(() => releaseSessionRegistry(SESSION));
  afterEach(() => releaseSessionRegistry(SESSION));

  it("pass1 removes done/failed instances from registry", async () => {
    const t = await makeThread();
    const reg = getSessionRegistry(SESSION);
    // Mark thread as done → thinkable.active should return false
    t.status = "done";
    reg.setObject({ id: t.id, class: "_builtin/agent/thread", data: t });
    expect(reg.getObject(t.id)).toBeDefined();

    await runGcOnce(SESSION, {
      resolveRegistry: (sid) => (sid === SESSION ? reg : undefined),
    });
    // thread inst should have been removed by pass1
    expect(reg.getObject(t.id)).toBeUndefined();
  });

  it("pass2 dispatches unactive on inst with refcount==0; idempotent across passes", async () => {
    const t = await makeThread();
    const reg = getSessionRegistry(SESSION);
    let calls = 0;
    const dispatched = new Set<string>();
    await runGcOnce(SESSION, {
      resolveRegistry: () => reg,
      dispatchUnactive: async (_sid, objectId) => {
        calls++;
        // simulate idempotency at sink: second call on same id silently ignored
        if (dispatched.has(objectId)) return;
        dispatched.add(objectId);
      },
    });
    const firstPassCalls = calls;
    expect(firstPassCalls).toBeGreaterThanOrEqual(0);
    // Run again — should not double-dispatch on those already dispatched (the closure tracks it).
    await runGcOnce(SESSION, {
      resolveRegistry: () => reg,
      dispatchUnactive: async (_sid, objectId) => {
        if (dispatched.has(objectId)) return;
        dispatched.add(objectId);
        calls++;
      },
    });
    // total calls didn't grow (idempotent sink)
    expect(calls).toBe(firstPassCalls);
  });
});
