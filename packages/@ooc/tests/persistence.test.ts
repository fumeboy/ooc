/**
 * persistence smoke test —— 验证 save / hydrate 跨进程恢复对象表。
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@ooc/core/runtime/object-register.builtins";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import { persistSession, hydrateSession } from "@ooc/core/persistable/runtime-object-io";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";

const SID = "persist-test-session";
let baseDir: string;

describe("persistence", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-persist-test-"));
  });
  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
    releaseSessionRegistry(SID);
  });

  it("persist + hydrate round-trip preserves thread data", async () => {
    // 1. create a thread + a todo
    const reg = getSessionRegistry(SID);
    const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
    const data = (await ctor.exec(
      { sessionId: SID, worldDir: baseDir, dir: "", args: {} },
      { calleeObjectId: "_builtin/supervisor", message: "hello-persist" },
    )) as ThreadContext;
    reg.setObject({ id: data.id, class: "_builtin/agent/thread", data });

    const todoCtor = reg.resolveConstructor("_builtin/agent/todo")!;
    const todoData = await todoCtor.exec(
      { sessionId: SID, worldDir: baseDir, dir: "", args: {} },
      { content: "write tests" },
    );
    reg.setObject({ id: "todo1", class: "_builtin/agent/todo", data: todoData });

    // 2. persist
    await persistSession(baseDir, SID);

    // 3. release in-memory + hydrate
    releaseSessionRegistry(SID);
    expect(getSessionRegistry(SID).getObject(data.id)).toBeUndefined();
    releaseSessionRegistry(SID);

    const reg2 = await hydrateSession(baseDir, SID);

    // 4. verify round-trip
    const restoredThread = reg2.getObject(data.id);
    expect(restoredThread).toBeDefined();
    expect(restoredThread?.class).toBe("_builtin/agent/thread");
    expect((restoredThread?.data as ThreadContext).messages.length).toBe(1);
    expect((restoredThread?.data as ThreadContext).messages[0]?.content).toBe("hello-persist");

    const restoredTodo = reg2.getObject("todo1");
    expect(restoredTodo).toBeDefined();
    expect(restoredTodo?.class).toBe("_builtin/agent/todo");
    expect((restoredTodo?.data as { content: string }).content).toBe("write tests");
  });
});
