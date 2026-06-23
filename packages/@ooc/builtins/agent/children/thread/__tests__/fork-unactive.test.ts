import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// side-effect：注册 thread class（含 unactive 生命周期钩子）。
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { generateWindowId, ROOT_WINDOW_ID } from "@ooc/core/_shared/types/context-window.js";
import { materializeWindow } from "@ooc/core/runtime/session-object-table.js";
import { openForkChild } from "@ooc/builtins/agent/thread/executable/fork.js";
import { handleCloseTool } from "@ooc/core/executable/tools/close.js";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import { saveObject, loadObject } from "@ooc/core/persistable/runtime-object-io.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

/**
 * 生命周期 e2e（经 close 原语真实 wiring）：关掉指向 fork 子线程的 fork 窗 → 该子线程
 * refcount 归 0 → close 原语派发 thread 的 **真实** unactive 钩子 → **通知语义**：
 * non-terminal 子线程收一条「无消息订阅者」inbox 系统通知、**保持 non-terminal（不切 canceled）、不级联**，
 * 由其自决是否 end。验证 close-tool → dispatchUnactiveIfZero → 真 thread.unactive（通知）整条链路。
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

function lastSystemNotice(t: ThreadContext) {
  return (t.inbox ?? []).filter((m) => m.source === "system").at(-1);
}

/**
 * fork 一条同对象子线程并在父侧建 fork 会话窗（复刻 agent.talk 的 fork wiring）：
 * openForkChild 挂 childThreads + 投 msg；materializeWindow 在父侧建指向子的 fork 窗。
 */
function forkWithWindow(parent: ThreadContext, selfObjectId: string, msg: string) {
  const child = openForkChild(parent, { selfObjectId, msg });
  const forkId = generateWindowId("talk");
  const forkWin = materializeWindow(parent, {
    id: forkId,
    class: THREAD_CLASS_ID,
    data: { target: selfObjectId, targetThreadId: child.id, isForkWindow: true },
    parentWindowId: ROOT_WINDOW_ID,
    title: "fork",
    status: "open",
    createdAt: Date.now(),
  });
  parent.contextWindows = [...(parent.contextWindows ?? []), forkWin];
  return { childId: child.id, forkId, child };
}

describe("thread.unactive（关 fork 窗 → 子线程收无订阅者通知、不 cancel，经 close 原语）", () => {
  it("关 fork 窗 → 子线程收 system 通知 + 保持 running（不 canceled、不级联）", async () => {
    const SELF = "alice";
    const baseDir = await tmpBase();
    const persistence: ThreadPersistenceRef = { baseDir, sessionId: "s", objectId: SELF, threadId: "t_parent" };
    const parent = makeThread({ id: "t_parent", objectId: SELF, persistence });

    // fork 一条同对象子线程（talk(target=自己) ⇒ 父侧 fork 子窗 + child 进 childThreads）。
    const { forkId, child } = forkWithWindow(parent, SELF, "子任务");
    expect(child.status).toBe("running");

    // 关 fork 窗（经真实 close 原语）→ 触发 thread.unactive → 子线程收通知、仍 running。
    const out = await handleCloseTool(parent, { window_id: forkId, reason: "子任务弃" }, builtinRegistry);
    expect(JSON.parse(out).ok).toBe(true);
    expect(child.status).toBe("running"); // 不强制终结
    const notice = lastSystemNotice(child);
    expect(notice).toBeDefined();
    expect(notice!.content).toContain("无消息订阅者");
    // fork 窗已移除。
    expect((parent.contextWindows ?? []).find((w) => w.id === forkId)).toBeUndefined();
  });

  it("嵌套 fork → 关父 fork 窗 → 子收通知保持 running、孙不受影响（不级联）", async () => {
    const SELF = "bob";
    const baseDir = await tmpBase();
    const persistence: ThreadPersistenceRef = { baseDir, sessionId: "s", objectId: SELF, threadId: "t_p" };
    const parent = makeThread({ id: "t_p", objectId: SELF, persistence });

    const { childId, forkId, child } = forkWithWindow(parent, SELF, "子");

    // 给 child 手挂一条孙线程 + child 持有指向它的 fork 窗（模拟 child 自己 fork 过）。
    const grandId = "t_grand";
    const grand: ThreadContext = {
      id: grandId, class: "_builtin/agent/thread", status: "running", events: [], contextWindows: [],
      parentThreadId: childId, creatorThreadId: childId, creatorObjectId: SELF,
    };
    child.childThreads = { [grandId]: grand };
    child.childThreadIds = [grandId];
    // 对象/窗拆分：fork 窗 = OocObjectRef（视角态顶层）；fork 业务字段（isForkWindow/targetThreadId）
    // 入 session 对象表，referencedObjectId 经表解析 → 级联停用孙线程。
    child.contextWindows = [
      materializeWindow(child, {
        id: "w_fork_grand",
        title: "孙",
        status: "open",
        createdAt: 0,
        class: THREAD_CLASS_ID,
        data: { isForkWindow: true, targetThreadId: grandId },
      }),
    ];

    await handleCloseTool(parent, { window_id: forkId, reason: "整棵弃" }, builtinRegistry);
    expect(child.status).toBe("running");           // 子收通知、不 cancel
    expect(lastSystemNotice(child)).toBeDefined();
    expect(grand.status).toBe("running");           // 不级联：child 未 cancel → 孙不受影响
  });

  it("跨 reload：子收通知刷盘 → readThread 仍 running + 留有通知（不被强制终结）", async () => {
    const SELF = "carol";
    const baseDir = await tmpBase();
    const persistence: ThreadPersistenceRef = { baseDir, sessionId: "s", objectId: SELF, threadId: "t_p" };
    const parent = makeThread({ id: "t_p", objectId: SELF, persistence });

    const { childId, forkId, child } = forkWithWindow(parent, SELF, "子");

    // 模拟子线程跑过 ≥1 tick：其独立 thread.json 落盘为 running。
    await saveObject(child);
    // 关 fork 窗 → unactive 给 child 发通知 + 即时刷盘。
    await handleCloseTool(parent, { window_id: forkId, reason: "弃" }, builtinRegistry);
    expect(child.status).toBe("running");

    // reload：从盘读回 child → 仍 running + inbox 留有 system 通知。
    const reloaded = await loadObject(THREAD_CLASS_ID, { baseDir, sessionId: "s", objectId: SELF }, childId);
    expect(reloaded?.status).toBe("running");
    expect((reloaded?.inbox ?? []).some((m) => m.source === "system" && m.content.includes("无消息订阅者"))).toBe(true);
  });
});
