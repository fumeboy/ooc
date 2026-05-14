import { describe, expect, it } from "bun:test";
import { executeCommand } from "../commands/index";
import { WindowManager } from "../windows";
import { creatorWindowIdOf, type DoWindow } from "../windows/types";
import { makeThread } from "../../__tests__/make-thread";

/**
 * do command 的 ContextWindow 行为验证。
 *
 * 覆盖：
 * - fork：建 child + 父侧 do_window + child 内 creator do_window + 父 outbox + child inbox + 事件
 * - wait=true：父 status="waiting"
 * - 通过 do_window.continue 追加消息
 * - close 父侧 do_window 归档子线程
 */
describe("do command (ContextWindow model)", () => {
  it("fork: 创建 child thread、父侧 do_window、child 的 creator do_window，并写消息", async () => {
    const parent = makeThread({ id: "t_parent" });
    await executeCommand("do", {
      thread: parent,
      args: { msg: "处理日志中的错误", wait: true },
    });

    expect(parent.childThreadIds).toHaveLength(1);
    const childId = parent.childThreadIds![0]!;
    const child = parent.childThreads![childId]!;

    // 父侧 do_window 指向 child
    const doWindow = parent.contextWindows.find(
      (w): w is DoWindow => w.type === "do" && !w.isCreatorWindow,
    );
    expect(doWindow).toBeDefined();
    expect(doWindow!.targetThreadId).toBe(childId);

    // child 自己有 creator do_window 指向父
    const childCreatorWindow = child.contextWindows.find(
      (w): w is DoWindow => w.type === "do" && w.isCreatorWindow === true,
    );
    expect(childCreatorWindow).toBeDefined();
    expect(childCreatorWindow!.id).toBe(creatorWindowIdOf(childId));
    expect(childCreatorWindow!.targetThreadId).toBe("t_parent");

    // 消息进 child inbox + 父 outbox + 子事件
    expect(child.inbox?.[0]?.content).toBe("处理日志中的错误");
    expect(parent.outbox?.[0]?.content).toBe("处理日志中的错误");
    expect(child.events).toEqual([
      { category: "context_change", kind: "inbox_message_arrived", msgId: child.inbox![0]!.id },
    ]);

    // wait=true → 父 status=waiting
    expect(parent.status).toBe("waiting");
    expect(parent.inboxSnapshotAtWait).toBe(0);
  });

  it("do_window.continue 通过 WindowManager.openCommandExec 调用，追加 child inbox + 父 outbox", async () => {
    const parent = makeThread({ id: "t_parent" });
    await executeCommand("do", {
      thread: parent,
      args: { msg: "首条消息" },
    });
    const childId = parent.childThreadIds![0]!;
    const doWindowId = parent.contextWindows.find(
      (w) => w.type === "do" && !(w as DoWindow).isCreatorWindow,
    )!.id;

    const mgr = WindowManager.fromThread(parent);
    const opened = await mgr.openCommandExec({
      thread: parent,
      parentWindowId: doWindowId,
      command: "continue",
      title: "追加任务",
      args: { msg: "继续处理 WARN" },
    });
    parent.contextWindows = mgr.toData();

    // C 规则触发自动 submit（args 完整 + 不引入新 knowledge）
    expect(opened.autoSubmitted).toBe(true);

    const child = parent.childThreads![childId]!;
    expect(child.inbox).toHaveLength(2);
    expect(child.inbox![1]?.content).toBe("继续处理 WARN");
    expect(parent.outbox).toHaveLength(2);
  });

  it("close 父侧 do_window 归档子线程（B=ii archive）", async () => {
    const parent = makeThread({ id: "t_parent" });
    await executeCommand("do", {
      thread: parent,
      args: { msg: "test" },
    });
    const childId = parent.childThreadIds![0]!;
    const doWindowId = parent.contextWindows.find(
      (w) => w.type === "do" && !(w as DoWindow).isCreatorWindow,
    )!.id;

    const mgr = WindowManager.fromThread(parent);
    const closed = mgr.close(doWindowId, parent);
    parent.contextWindows = mgr.toData();
    expect(closed).toBe(true);

    expect(parent.contextWindows.find((w) => w.id === doWindowId)).toBeUndefined();
    expect(parent.childThreads![childId]!.status).toBe("paused");
  });
});
