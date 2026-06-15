/**
 * sharing.test — talk_window.share + sharing 状态守门测试（旧 do_window.move 并入 talk）。
 *
 * 覆盖：
 * - talk.share_windows: readonly-ref / move 模式的初始传递
 * - talk_window.share 命令: readonly-ref / move / 归还路径
 * - manager 守门：sharing 状态 window 上 exec 拒绝
 * - archiveForkChild 自动归还 borrowed owners
 */

import { describe, expect, it } from "bun:test";
import { execRootMethod } from "@ooc/core/executable/manager.js";
import { dispatchToolCall } from "../../tools";
import { WindowManager, builtinRegistry } from "@ooc/core/executable/manager.js";
import { makeThread } from "../../../__tests__/make-thread";
import type { ThreadContext } from "../../../thinkable/context";
import type { ThreadPersistenceRef } from "../../../persistable/common";
import type { ContextWindow, TalkWindow, FileWindow } from "@ooc/core/_shared/types/context-window.js";

const SELF = "alice";
const persistenceOf = (threadId: string): ThreadPersistenceRef => ({
  baseDir: "/tmp/__test__",
  sessionId: "s_test",
  objectId: SELF,
  threadId,
});

/** fork 形态 talk 入参（target=自己）。 */
const forkArgs = (msg: string, extra: Record<string, unknown> = {}) => ({
  target: SELF,
  msg,
  ...extra,
});

function makeParent(id: string): ThreadContext {
  return makeThread({ id, persistence: persistenceOf(id) });
}

function findChild(parent: ThreadContext): ThreadContext {
  const childId = (parent.childThreadIds ?? [])[0];
  if (!childId) throw new Error("expected child thread");
  return (parent.childThreads ?? {})[childId]!;
}

function findForkWindow(thread: ThreadContext): { id: string } {
  const win = (thread.contextWindows ?? []).find(
    (w) => w.class === "talk" && (w as TalkWindow).isForkWindow && !(w as TalkWindow).isCreatorWindow,
  );
  if (!win) throw new Error("expected fork window in parent");
  return { id: win.id };
}

function makeFileWindowFixture(thread: ThreadContext, id: string, path: string): void {
  const fileWindow: ContextWindow = {
    id,
    class: "file",
    title: `file: ${path}`,
    status: "open",
    createdAt: Date.now(),
    path,
  };
  thread.contextWindows = [...(thread.contextWindows ?? []), fileWindow];
}

describe("talk.share_windows", () => {
  it("readonly-ref mode: 子获得 sharing.kind=readonly-ref placeholder + snapshot；父保留 owner", async () => {
    const parent = makeParent("parent");
    makeFileWindowFixture(parent, "w_file_1", "/tmp/a.txt");

    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("看 /tmp/a.txt", {
        share_windows: [{ window_id: "w_file_1", mode: "readonly-ref" }],
      }),
    });

    // 父保留 owner（无 sharing 字段）
    const parentFile = (parent.contextWindows ?? []).find((w) => w.id === "w_file_1");
    expect(parentFile).toBeDefined();
    expect(parentFile?.sharing).toBeUndefined();

    // 子拿到 readonly-ref placeholder + snapshot
    const child = findChild(parent);
    const childFile = (child.contextWindows ?? []).find((w) => w.id === "w_file_1");
    expect(childFile).toBeDefined();
    expect(childFile?.sharing?.kind).toBe("readonly-ref");
    if (childFile?.sharing?.kind === "readonly-ref") {
      expect(childFile.sharing.ownerThreadId).toBe(parent.id);
      expect(childFile.sharing.snapshot.id).toBe("w_file_1");
      expect(childFile.sharing.snapshot.sharing).toBeUndefined();
    }
  });

  it("move mode: 父降 mutable-ref shadow（含 snapshot）；子获得完整 owner", async () => {
    const parent = makeParent("parent");
    makeFileWindowFixture(parent, "w_file_2", "/tmp/b.txt");

    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("改 /tmp/b.txt", {
        share_windows: [{ window_id: "w_file_2", mode: "move" }],
      }),
    });

    // 父变 mutable-ref shadow
    const parentFile = (parent.contextWindows ?? []).find((w) => w.id === "w_file_2");
    expect(parentFile?.sharing?.kind).toBe("mutable-ref");

    // 子拿到完整 owner（无 sharing）
    const child = findChild(parent);
    const childFile = (child.contextWindows ?? []).find((w) => w.id === "w_file_2");
    expect(childFile).toBeDefined();
    expect(childFile?.sharing).toBeUndefined();
    expect(childFile?.class).toBe("file");
  });
});

describe("WindowManager sharing 守门", () => {
  it("拒绝在 readonly-ref 状态 window 上 exec 命令（除 close）", async () => {
    const parent = makeParent("parent");
    makeFileWindowFixture(parent, "w_file_3", "/tmp/c.txt");
    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("看", { share_windows: [{ window_id: "w_file_3", mode: "readonly-ref" }] }),
    });

    const child = findChild(parent);
    const mgr = WindowManager.fromThread(child, builtinRegistry);
    await expect(
      mgr.openMethodExec({
        thread: child,
        parentWindowId: "w_file_3",
        method: "edit",
        title: "尝试编辑",
      }),
    ).rejects.toThrow(/readonly-ref/);
  });

  it("拒绝在 mutable-ref shadow 状态 window 上 exec 任何命令", async () => {
    const parent = makeParent("parent");
    makeFileWindowFixture(parent, "w_file_4", "/tmp/d.txt");
    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("拿走", { share_windows: [{ window_id: "w_file_4", mode: "move" }] }),
    });

    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    await expect(
      mgr.openMethodExec({
        thread: parent,
        parentWindowId: "w_file_4",
        method: "edit",
        title: "尝试编辑",
      }),
    ).rejects.toThrow(/已 move/);
  });
});

describe("talk_window.share 归还路径", () => {
  it("子在 creator fork 窗上 mode=move → 触发归还，父恢复 owner", async () => {
    const parent = makeParent("parent");
    makeFileWindowFixture(parent, "w_file_5", "/tmp/e.txt");
    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("处理", { share_windows: [{ window_id: "w_file_5", mode: "move" }] }),
    });
    const child = findChild(parent);
    // 子要修改 file path 模拟 latest 内容（实际场景是 file_window.edit 之类）
    const childFile = (child.contextWindows ?? []).find((w) => w.id === "w_file_5");
    if (childFile && childFile.class === "file") {
      (childFile as FileWindow).path = "/tmp/e-modified.txt";
    }
    // 子在 creator fork 窗上发起归还
    const creator = (child.contextWindows ?? []).find(
      (w) => w.class === "talk" && (w as TalkWindow).isCreatorWindow,
    );
    expect(creator).toBeDefined();

    const out = await dispatchToolCall(child, {
      id: "call_return",
      name: "exec",
      arguments: {
        title: "归还 file",
        window_id: creator!.id,
        method: "share",
        args: { window_id: "w_file_5", mode: "move" },
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);

    // 父侧：恢复 owner，吸收子的 latest path
    const parentFile = (parent.contextWindows ?? []).find((w) => w.id === "w_file_5");
    expect(parentFile?.sharing).toBeUndefined();
    if (parentFile && parentFile.class === "file") {
      expect((parentFile as FileWindow).path).toBe("/tmp/e-modified.txt");
    }
    // 子侧：副本被移除
    const childFileAfter = (child.contextWindows ?? []).find((w) => w.id === "w_file_5");
    expect(childFileAfter).toBeUndefined();
  });
});

describe("archiveForkChild 自动归还", () => {
  it("close 父 fork 子窗时自动归还所有 borrowed owners", async () => {
    const parent = makeParent("parent");
    makeFileWindowFixture(parent, "w_file_6", "/tmp/f.txt");
    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("处理", { share_windows: [{ window_id: "w_file_6", mode: "move" }] }),
    });
    const forkWindowId = findForkWindow(parent).id;
    const child = findChild(parent);

    // 模拟 archive：直接调 archive helper（绕开 mgr 缓存层）
    const { archiveForkChild } = await import("@ooc/builtins/thread/executable/talk-fork.js");
    const forkWindow = (parent.contextWindows ?? []).find((w) => w.id === forkWindowId);
    expect(forkWindow?.class).toBe("talk");
    if (forkWindow?.class === "talk") {
      archiveForkChild(parent, forkWindow as TalkWindow);
    }

    // 父侧 file 恢复 owner（直接看 parent.contextWindows，不经 mgr）
    const parentFile = (parent.contextWindows ?? []).find((w) => w.id === "w_file_6");
    expect(parentFile).toBeDefined();
    expect(parentFile?.sharing).toBeUndefined();

    // 子线程被切到 paused
    expect(child.status).toBe("paused");
  });
});
