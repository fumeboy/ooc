/**
 * sharing.test — do_window.move + sharing 状态守门测试（plan §do_window.move）。
 *
 * 覆盖：
 * - root.do.share_windows: ref / move 模式的初始分享
 * - do_window.move 命令: ref / move / 归还路径
 * - manager 守门：sharing 状态 window 上 exec 拒绝
 * - archiveDoWindowChild 自动归还 borrowed owners
 */

import { describe, expect, it } from "bun:test";
import { execRootMethod } from "../../windows";
import { dispatchToolCall } from "../../tools";
import { WindowManager } from "../../windows";
import { makeThread } from "../../../__tests__/make-thread";
import type { ThreadContext } from "../../../thinkable/context";
import type { ContextWindow } from "../_shared/types";

function findChild(parent: ThreadContext): ThreadContext {
  const childId = (parent.childThreadIds ?? [])[0];
  if (!childId) throw new Error("expected child thread");
  return (parent.childThreads ?? {})[childId]!;
}

function findDoWindow(thread: ThreadContext): { id: string } {
  const win = (thread.contextWindows ?? []).find((w) => w.type === "do" && !w.isCreatorWindow);
  if (!win) throw new Error("expected do_window in parent");
  return { id: win.id };
}

function makeFileWindowFixture(thread: ThreadContext, id: string, path: string): void {
  const fileWindow: ContextWindow = {
    id,
    type: "file",
    title: `file: ${path}`,
    status: "open",
    createdAt: Date.now(),
    path,
  };
  thread.contextWindows = [...(thread.contextWindows ?? []), fileWindow];
}

describe("root.do.share_windows", () => {
  it("ref mode: 子获得 sharing.kind=ref placeholder + snapshot；父保留 owner", async () => {
    const parent = makeThread({ id: "parent" });
    makeFileWindowFixture(parent, "w_file_1", "/tmp/a.txt");

    await execRootMethod("do", {
      thread: parent,
      args: {
        msg: "看 /tmp/a.txt",
        share_windows: [{ window_id: "w_file_1", mode: "ref" }],
      },
    });

    // 父保留 owner（无 sharing 字段）
    const parentFile = (parent.contextWindows ?? []).find((w) => w.id === "w_file_1");
    expect(parentFile).toBeDefined();
    expect(parentFile?.sharing).toBeUndefined();

    // 子拿到 ref placeholder + snapshot
    const child = findChild(parent);
    const childFile = (child.contextWindows ?? []).find((w) => w.id === "w_file_1");
    expect(childFile).toBeDefined();
    expect(childFile?.sharing?.kind).toBe("ref");
    if (childFile?.sharing?.kind === "ref") {
      expect(childFile.sharing.ownerThreadId).toBe(parent.id);
      expect(childFile.sharing.snapshot.id).toBe("w_file_1");
      expect(childFile.sharing.snapshot.sharing).toBeUndefined();
    }
  });

  it("move mode: 父变 lent_out（含 snapshot）；子获得完整 owner", async () => {
    const parent = makeThread({ id: "parent" });
    makeFileWindowFixture(parent, "w_file_2", "/tmp/b.txt");

    await execRootMethod("do", {
      thread: parent,
      args: {
        msg: "改 /tmp/b.txt",
        share_windows: [{ window_id: "w_file_2", mode: "move" }],
      },
    });

    // 父变 lent_out
    const parentFile = (parent.contextWindows ?? []).find((w) => w.id === "w_file_2");
    expect(parentFile?.sharing?.kind).toBe("lent_out");

    // 子拿到完整 owner（无 sharing）
    const child = findChild(parent);
    const childFile = (child.contextWindows ?? []).find((w) => w.id === "w_file_2");
    expect(childFile).toBeDefined();
    expect(childFile?.sharing).toBeUndefined();
    expect(childFile?.type).toBe("file");
  });
});

describe("WindowManager sharing 守门", () => {
  it("拒绝在 ref 状态 window 上 exec 命令（除 close）", async () => {
    const parent = makeThread({ id: "parent" });
    makeFileWindowFixture(parent, "w_file_3", "/tmp/c.txt");
    await execRootMethod("do", {
      thread: parent,
      args: { msg: "看", share_windows: [{ window_id: "w_file_3", mode: "ref" }] },
    });

    const child = findChild(parent);
    const mgr = WindowManager.fromThread(child);
    await expect(
      mgr.openCommandExec({
        thread: child,
        parentWindowId: "w_file_3",
        command: "edit",
        title: "尝试编辑",
      }),
    ).rejects.toThrow(/只读 ref/);
  });

  it("拒绝在 lent_out 状态 window 上 exec 任何命令", async () => {
    const parent = makeThread({ id: "parent" });
    makeFileWindowFixture(parent, "w_file_4", "/tmp/d.txt");
    await execRootMethod("do", {
      thread: parent,
      args: { msg: "拿走", share_windows: [{ window_id: "w_file_4", mode: "move" }] },
    });

    const mgr = WindowManager.fromThread(parent);
    await expect(
      mgr.openCommandExec({
        thread: parent,
        parentWindowId: "w_file_4",
        command: "edit",
        title: "尝试编辑",
      }),
    ).rejects.toThrow(/已借出/);
  });
});

describe("do_window.move 归还路径", () => {
  it("子在 creator do_window 上 mode=move → 触发归还，父恢复 owner", async () => {
    const parent = makeThread({ id: "parent" });
    makeFileWindowFixture(parent, "w_file_5", "/tmp/e.txt");
    await execRootMethod("do", {
      thread: parent,
      args: { msg: "处理", share_windows: [{ window_id: "w_file_5", mode: "move" }] },
    });
    const child = findChild(parent);
    // 子要修改 file path 模拟 latest 内容（实际场景是 file_window.edit 之类）
    const childFile = (child.contextWindows ?? []).find((w) => w.id === "w_file_5");
    if (childFile && childFile.type === "file") {
      childFile.path = "/tmp/e-modified.txt";
    }
    // 子在 creator do_window 上发起归还
    const creator = (child.contextWindows ?? []).find(
      (w) => w.type === "do" && w.isCreatorWindow,
    );
    expect(creator).toBeDefined();

    const out = await dispatchToolCall(child, {
      id: "call_return",
      name: "exec",
      arguments: {
        title: "归还 file",
        window_id: creator!.id,
        command: "move",
        args: { window_id: "w_file_5", mode: "move" },
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);

    // 父侧：恢复 owner，吸收子的 latest path
    const parentFile = (parent.contextWindows ?? []).find((w) => w.id === "w_file_5");
    expect(parentFile?.sharing).toBeUndefined();
    if (parentFile && parentFile.type === "file") {
      expect(parentFile.path).toBe("/tmp/e-modified.txt");
    }
    // 子侧：副本被移除
    const childFileAfter = (child.contextWindows ?? []).find((w) => w.id === "w_file_5");
    expect(childFileAfter).toBeUndefined();
  });
});

describe("archiveDoWindowChild 自动归还", () => {
  it("close 父 do_window 时自动归还所有 borrowed owners", async () => {
    const parent = makeThread({ id: "parent" });
    makeFileWindowFixture(parent, "w_file_6", "/tmp/f.txt");
    await execRootMethod("do", {
      thread: parent,
      args: { msg: "处理", share_windows: [{ window_id: "w_file_6", mode: "move" }] },
    });
    const doWindowId = findDoWindow(parent).id;
    const child = findChild(parent);

    // 模拟 archive：直接调 archive helper（绕开 mgr 缓存层）
    const { archiveDoWindowChild } = await import("../do/helpers");
    const doWindow = (parent.contextWindows ?? []).find((w) => w.id === doWindowId);
    expect(doWindow?.type).toBe("do");
    if (doWindow?.type === "do") {
      archiveDoWindowChild(parent, doWindow);
    }

    // 父侧 file 恢复 owner（直接看 parent.contextWindows，不经 mgr）
    const parentFile = (parent.contextWindows ?? []).find((w) => w.id === "w_file_6");
    expect(parentFile).toBeDefined();
    expect(parentFile?.sharing).toBeUndefined();

    // 子线程被切到 paused
    expect(child.status).toBe("paused");
  });
});
