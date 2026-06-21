import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// side-effect：注册 thread class（含 unactive 生命周期钩子）。
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { WindowManager } from "@ooc/core/runtime/window-manager.js";
import { handleCloseTool } from "@ooc/core/executable/tools/close.js";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import { writeThread, readThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";
import type { ThreadContext } from "@ooc/core/thinkable/context.js";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

/**
 * 生命周期 e2e（经 close 原语真实 wiring）：关掉指向 fork 子线程的 fork 窗 → 该子线程
 * refcount 归 0 → close 原语派发 thread 的 **真实** unactive 钩子 → 子线程切 canceled；
 * 且其「现已归零」的子树（孙线程）级联 canceled。验证 close-tool → dispatchUnactiveIfZero →
 * 真 thread.unactive(cancelSubtree) 整条链路（非 object-lifecycle.test.ts 的合成 unactive）。
 */
const tmps: string[] = [];
async function tmpBase(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "ooc-fork-unactive-"));
  tmps.push(d);
  return d;
}
afterAll(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

describe("thread.unactive（关 fork 窗 → 子线程 canceled，经 close 原语）", () => {
  it("关 fork 窗 → 子线程 canceled", async () => {
    const SELF = "alice";
    const baseDir = await tmpBase();
    const persistence: ThreadPersistenceRef = { baseDir, sessionId: "s", objectId: SELF, threadId: "t_parent" };
    const parent = makeThread({ id: "t_parent", objectId: SELF, persistence });

    // fork 一条同对象子线程（talk(target=自己) ⇒ 父侧 fork 子窗 + child 进 childThreads）。
    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const forkId = await mgr.instantiate(THREAD_CLASS_ID, { target: SELF, msg: "子任务" });
    parent.contextWindows = mgr.toData();
    const childId = parent.childThreadIds![0]!;
    const child = parent.childThreads![childId]!;
    expect(child.status).toBe("running");

    // 关 fork 窗（经真实 close 原语）→ 触发 thread.unactive → 子线程 canceled。
    const out = await handleCloseTool(parent, { window_id: forkId, reason: "子任务弃" }, builtinRegistry);
    expect(JSON.parse(out).ok).toBe(true);
    expect(child.status).toBe("canceled");
    // fork 窗已移除。
    expect((parent.contextWindows ?? []).find((w) => w.id === forkId)).toBeUndefined();
  });

  it("嵌套 fork → 关父 fork 窗 → 子 + 孙线程都 canceled（级联）", async () => {
    const SELF = "bob";
    const baseDir = await tmpBase();
    const persistence: ThreadPersistenceRef = { baseDir, sessionId: "s", objectId: SELF, threadId: "t_p" };
    const parent = makeThread({ id: "t_p", objectId: SELF, persistence });

    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const forkId = await mgr.instantiate(THREAD_CLASS_ID, { target: SELF, msg: "子" });
    parent.contextWindows = mgr.toData();
    const childId = parent.childThreadIds![0]!;
    const child = parent.childThreads![childId]!;

    // 给 child 手挂一条孙线程 + child 持有指向它的 fork 窗（模拟 child 自己 fork 过）。
    const grandId = "t_grand";
    const grand: ThreadContext = {
      id: grandId, status: "running", events: [], contextWindows: [],
      parentThreadId: childId, creatorThreadId: childId, creatorObjectId: SELF,
    };
    child.childThreads = { [grandId]: grand };
    child.childThreadIds = [grandId];
    child.contextWindows = [
      { id: "w_fork_grand", title: "孙", status: "open", createdAt: 0,
        object: { class: THREAD_CLASS_ID, data: { isForkWindow: true, targetThreadId: grandId } } },
    ];

    await handleCloseTool(parent, { window_id: forkId, reason: "整棵弃" }, builtinRegistry);
    expect(child.status).toBe("canceled");
    expect(grand.status).toBe("canceled"); // 级联：child canceled → 其窗不计数 → 孙归 0 → canceled
  });

  it("跨 reload：canceled fork 子刷盘 → readThread 仍 canceled（不被 bootstrap 复活）", async () => {
    const SELF = "carol";
    const baseDir = await tmpBase();
    const persistence: ThreadPersistenceRef = { baseDir, sessionId: "s", objectId: SELF, threadId: "t_p" };
    const parent = makeThread({ id: "t_p", objectId: SELF, persistence });

    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const forkId = await mgr.instantiate(THREAD_CLASS_ID, { target: SELF, msg: "子" });
    parent.contextWindows = mgr.toData();
    const childId = parent.childThreadIds![0]!;
    const child = parent.childThreads![childId]!;

    // 模拟子线程跑过 ≥1 tick：其独立 thread.json 落盘为 running（修复前 cancel 不会改它）。
    await writeThread(child);
    // 关 fork 窗 → cancelSubtree 把 child 切 canceled 并即时刷盘。
    await handleCloseTool(parent, { window_id: forkId, reason: "弃" }, builtinRegistry);
    expect(child.status).toBe("canceled");

    // reload：从盘读回 child → 仍 canceled（修复前会读到 running → 被 bootstrap 当 orphan 复活）。
    const reloaded = await readThread({ baseDir, sessionId: "s", objectId: SELF }, childId);
    expect(reloaded?.status).toBe("canceled");
  });
});
