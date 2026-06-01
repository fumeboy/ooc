/**
 * ooc-6 P5'.1 — WindowManager dual-write 测试
 *
 * 验证：
 * 1. insertTypedWindow 触发 flat runtime object state.json 写入 + 注册到 thread context.json
 * 2. close()（→ removeWindow）从 thread context.json 摘除 member + rm 扁平 object 目录
 * 3. 嵌套 context/ 写也仍然存在（dual-write 期内不破坏原路径）
 * 4. ROOT_WINDOW_ID 不被持久化（隐含 root）
 *
 * Phase 5'.1 不实现跨 thread 引用计数；本测试只覆盖单 thread 场景。
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowManager } from "../manager";
import { makeThread } from "../../../../__tests__/make-thread";
import { ROOT_WINDOW_ID, type TodoWindow } from "../types";
import {
  contextRegistryFile,
  readContextRegistry,
  runtimeObjectStateFile,
  __resetSerialQueueForTests,
} from "../../../../persistable";
import type { ThreadPersistenceRef } from "../../../../persistable/common";
import type { ThreadContext } from "../../../../thinkable/context";

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

describe("WindowManager dual-write — flat runtime object + thread context registry", () => {
  let baseDir: string;
  let persistence: ThreadPersistenceRef;
  let thread: ThreadContext;

  beforeEach(async () => {
    __resetSerialQueueForTests();
    baseDir = await mkdtemp(join(tmpdir(), "ooc-mgr-dualwrite-"));
    persistence = {
      baseDir,
      sessionId: "sess_dual",
      objectId: "agent_x",
      threadId: "t_main",
    };
    thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("insertTypedWindow: 同时写扁平 state.json 和 thread context.json", async () => {
    const mgr = WindowManager.fromThread(thread);
    const todo: TodoWindow = {
      id: "todo_dual_1",
      type: "todo",
      parentWindowId: ROOT_WINDOW_ID,
      title: "demo",
      status: "open",
      createdAt: 1717000000000,
      content: "dual write",
    };
    mgr.insertTypedWindow(todo, thread);

    // 等待 enqueueSessionWrite 链式 flush（writeRuntimeObjectState + writeContextRegistry）
    // 通过随便再写一次 / 读一次同 session key 来等到队列清空。
    // 这里直接 polling 路径就绪。
    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: "sess_dual",
      objectId: "todo_dual_1",
    });
    const regFile = contextRegistryFile(persistence);
    for (let i = 0; i < 20; i++) {
      if ((await exists(stateFile)) && (await exists(regFile))) break;
      await Bun.sleep(20);
    }

    // 1. 扁平 state.json 内容 = 整个 ContextWindow
    const stateRaw = await readFile(stateFile, "utf8");
    expect(JSON.parse(stateRaw)).toMatchObject({ id: "todo_dual_1", type: "todo", title: "demo" });

    // 2. thread context.json 包含该 member
    const reg = await readContextRegistry(persistence);
    expect(reg.version).toBe(1);
    expect(reg.members.length).toBe(1);
    expect(reg.members[0]?.objectId).toBe("todo_dual_1");
    expect(reg.members[0]?.params.order).toBe(0);

    // 3. 嵌套 context/ 写也存在（dual-write 兼容路径）
    const nestedFile = join(
      baseDir,
      "flows",
      "sess_dual",
      "agent_x",
      "context",
      "todo_dual_1",
      "window.json",
    );
    expect(await exists(nestedFile)).toBe(true);
  });

  it("close: 从 thread context.json 摘 member + 删除扁平 object 目录", async () => {
    const mgr = WindowManager.fromThread(thread);
    const todo: TodoWindow = {
      id: "todo_dual_2",
      type: "todo",
      parentWindowId: ROOT_WINDOW_ID,
      title: "to be closed",
      status: "open",
      createdAt: 1717000000001,
      content: "close path",
    };
    mgr.insertTypedWindow(todo, thread);

    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: "sess_dual",
      objectId: "todo_dual_2",
    });
    const regFile = contextRegistryFile(persistence);
    for (let i = 0; i < 20; i++) {
      if ((await exists(stateFile)) && (await exists(regFile))) break;
      await Bun.sleep(20);
    }

    expect(await exists(stateFile)).toBe(true);
    let reg = await readContextRegistry(persistence);
    expect(reg.members.map((m) => m.objectId)).toEqual(["todo_dual_2"]);

    // close 会触发级联 onClose + removeWindow → 写 registry 删 + rm 扁平目录
    mgr.close("todo_dual_2", thread);

    for (let i = 0; i < 20; i++) {
      const stillThere = await exists(stateFile);
      reg = await readContextRegistry(persistence);
      if (!stillThere && reg.members.length === 0) break;
      await Bun.sleep(20);
    }

    expect(await exists(stateFile)).toBe(false);
    expect(reg.members).toEqual([]);
  });

  it("ROOT_WINDOW_ID 不被持久化（隐含 root，跳过双写）", async () => {
    const mgr = WindowManager.fromThread(thread);
    const root: TodoWindow = {
      id: ROOT_WINDOW_ID,
      type: "todo",
      title: "root proxy",
      status: "open",
      createdAt: 1717000000002,
      content: "should not be persisted",
    };
    // 把伪 root window 插进去，但因 id === ROOT_WINDOW_ID 不应触发任何持久化
    mgr.upsertWindow(root, thread);
    await Bun.sleep(80);

    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: "sess_dual",
      objectId: ROOT_WINDOW_ID,
    });
    expect(await exists(stateFile)).toBe(false);

    const reg = await readContextRegistry(persistence);
    expect(reg.members.find((m) => m.objectId === ROOT_WINDOW_ID)).toBeUndefined();
  });

  it("两个 typed window 顺序 insert：order 递增", async () => {
    const mgr = WindowManager.fromThread(thread);
    const w1: TodoWindow = {
      id: "todo_a",
      type: "todo",
      parentWindowId: ROOT_WINDOW_ID,
      title: "a",
      status: "open",
      createdAt: 1,
      content: "a",
    };
    const w2: TodoWindow = {
      id: "todo_b",
      type: "todo",
      parentWindowId: ROOT_WINDOW_ID,
      title: "b",
      status: "open",
      createdAt: 2,
      content: "b",
    };
    mgr.insertTypedWindow(w1, thread);
    // 等第一次 registry flush 完成（order 才能拿到正确值）
    const regFile = contextRegistryFile(persistence);
    for (let i = 0; i < 20; i++) {
      const reg = await readContextRegistry(persistence);
      if (reg.members.length === 1) break;
      await Bun.sleep(20);
    }
    mgr.insertTypedWindow(w2, thread);
    for (let i = 0; i < 20; i++) {
      const reg = await readContextRegistry(persistence);
      if (reg.members.length === 2) break;
      await Bun.sleep(20);
    }

    const reg = await readContextRegistry(persistence);
    expect(reg.members.map((m) => m.objectId)).toEqual(["todo_a", "todo_b"]);
    expect(reg.members.map((m) => m.params.order)).toEqual([0, 1]);
  });
});
