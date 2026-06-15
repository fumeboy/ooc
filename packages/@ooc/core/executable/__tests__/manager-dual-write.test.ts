/**
 * WindowManager 写：扁平 state.json + thread context.json registry。
 * todo 改为 builtin feature；本测试改用 plan（independent flow object），
 * 验证独立 flow object 的写盘 + thread context registry 维护行为。
 *
 * 验证：
 * 1. insertTypedWindow 触发 flat runtime object state.json 写入 + 注册到 thread context.json
 * 2. close()（→ removeWindow）从 thread context.json 摘除 member + rm 扁平 object 目录
 * 3. P5'.3 起：嵌套 context/ 写已下线
 * 4. ROOT_WINDOW_ID 不被持久化（隐含 root）
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowManager } from "../manager";
import { builtinRegistry } from "../registry";
import { makeThread } from "../../../../__tests__/make-thread";
import { ROOT_WINDOW_ID } from "../types";
import type { PlanWindow } from "@ooc/builtins/agent/plan/types.js";
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

function makePlan(id: string, title: string, content: string, createdAt: number): PlanWindow {
  return {
    id,
    class: "plan",
    parentWindowId: ROOT_WINDOW_ID,
    title,
    status: "active",
    createdAt,
    content,
    steps: [],
  } as PlanWindow;
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
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const plan = makePlan("plan_dual_1", "demo", "dual write", 1717000000000);
    mgr.insertTypedWindow(plan, thread);

    // 等待 enqueueSessionWrite 链式 flush（writeRuntimeObjectState + writeContextRegistry）
    // 通过随便再写一次 / 读一次同 session key 来等到队列清空。
    // 这里直接 polling 路径就绪。
    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: "sess_dual",
      objectId: "plan_dual_1",
    });
    const regFile = contextRegistryFile(persistence);
    for (let i = 0; i < 20; i++) {
      if ((await exists(stateFile)) && (await exists(regFile))) break;
      await Bun.sleep(20);
    }

    // 1. 扁平 state.json 内容 = 整个 ContextWindow
    const stateRaw = await readFile(stateFile, "utf8");
    expect(JSON.parse(stateRaw)).toMatchObject({ id: "plan_dual_1", class: "plan", title: "demo" });

    // 2. thread context.json 包含该 member
    const reg = await readContextRegistry(persistence);
    expect(reg.version).toBe(1);
    expect(reg.members.length).toBe(1);
    expect(reg.members[0]?.objectId).toBe("plan_dual_1");
    expect(reg.members[0]?.params.order).toBe(0);

    // 3. P5'.3 起：嵌套 context/<id>/window.json 路径已删除，扁平 state.json 是唯一路径
    const nestedFile = join(
      baseDir,
      "flows",
      "sess_dual",
      "agent_x",
      "context",
      "plan_dual_1",
      "window.json",
    );
    expect(await exists(nestedFile)).toBe(false);
  });

  it("close: 从 thread context.json 摘 member + 删除扁平 object 目录", async () => {
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const plan = makePlan("plan_dual_2", "to be closed", "close path", 1717000000001);
    mgr.insertTypedWindow(plan, thread);

    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: "sess_dual",
      objectId: "plan_dual_2",
    });
    const regFile = contextRegistryFile(persistence);
    for (let i = 0; i < 20; i++) {
      if ((await exists(stateFile)) && (await exists(regFile))) break;
      await Bun.sleep(20);
    }

    expect(await exists(stateFile)).toBe(true);
    let reg = await readContextRegistry(persistence);
    expect(reg.members.map((m) => m.objectId)).toEqual(["plan_dual_2"]);

    // close 会触发级联 onClose + removeWindow → 写 registry 删 + rm 扁平目录
    mgr.close("plan_dual_2", thread);

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
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const root = makePlan(ROOT_WINDOW_ID, "root proxy", "should not be persisted", 1717000000002);
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
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const w1 = makePlan("plan_a", "a", "a", 1);
    const w2 = makePlan("plan_b", "b", "b", 2);
    mgr.insertTypedWindow(w1, thread);
    // 等第一次 registry flush 完成（order 才能拿到正确值）
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
    expect(reg.members.map((m) => m.objectId)).toEqual(["plan_a", "plan_b"]);
    expect(reg.members.map((m) => m.params.order)).toEqual([0, 1]);
  });
});
