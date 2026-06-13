import { describe, expect, it } from "bun:test";
import { execRootMethod } from "../windows";
import { WindowManager, builtinRegistry } from "../windows";
import { creatorWindowIdOf, type ContextWindow, type DoWindow } from "../windows/_shared/types";
import { makeThread } from "../../__tests__/make-thread";

/**
 * agency 方法（do）已从 root 迁到 `_builtin/agent` 类。
 * 经 openMethodExec 直接调 do 时须把 parentWindowId 指向一个 class 解析得到 `_builtin/agent` 的窗。
 * （execRootMethod 走 agency+misc 并集，仍可直接用，无需 agent 窗。）
 */
const AGENT_WIN = {
  id: "agent",
  class: "_builtin/agent",
  parentWindowId: "root",
  title: "agent",
  status: "open",
  createdAt: Date.now(),
  isMemberWindow: true,
  // class="_builtin/agent" 是继承类、非 ContextWindow union discriminant → 经 unknown 转。
} as unknown as ContextWindow;

/**
 * do method 的 ContextWindow 行为验证。
 *
 * 覆盖：
 * - fork：建 child + 父侧 do_window + child 内 creator do_window + 父 outbox + child inbox + 事件
 * - wait=true：父 status="waiting"
 * - 通过 do_window.continue 追加消息
 * - close 父侧 do_window 归档子线程
 */
describe("do method (ContextWindow model)", () => {
  it("fork: 创建 child thread、父侧 do_window、child 的 creator do_window，并写消息", async () => {
    const parent = makeThread({ id: "t_parent" });
    await execRootMethod("do", {
      thread: parent,
      args: { msg: "处理日志中的错误", wait: true },
    });

    expect(parent.childThreadIds).toHaveLength(1);
    const childId = parent.childThreadIds![0]!;
    const child = parent.childThreads![childId]!;

    // 父侧 do_window 指向 child
    const doWindow = parent.contextWindows.find(
      (w): w is DoWindow => w.class === "do" && !(w as DoWindow).isCreatorWindow,
    );
    expect(doWindow).toBeDefined();
    expect(doWindow!.targetThreadId).toBe(childId);

    // child 自己有 creator do_window 指向父
    const childCreatorWindow = child.contextWindows.find(
      (w): w is DoWindow => w.class === "do" && (w as DoWindow).isCreatorWindow === true,
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

  it("do_window.continue 通过 WindowManager.openMethodExec 调用，追加 child inbox + 父 outbox", async () => {
    const parent = makeThread({ id: "t_parent" });
    await execRootMethod("do", {
      thread: parent,
      args: { msg: "首条消息" },
    });
    const childId = parent.childThreadIds![0]!;
    const doWindowId = parent.contextWindows.find(
      (w) => w.class === "do" && !(w as DoWindow).isCreatorWindow,
    )!.id;

    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const opened = await mgr.openMethodExec({
      thread: parent,
      parentWindowId: doWindowId,
      method: "continue",
      title: "追加任务",
      args: { msg: "继续处理 WARN" },
    });
    parent.contextWindows = mgr.toData();

    // open 立即提交 form（args 完整 + 不引入新 knowledge）
    expect(opened.autoSubmitted).toBe(true);

    const child = parent.childThreads![childId]!;
    expect(child.inbox).toHaveLength(2);
    expect(child.inbox![1]?.content).toBe("继续处理 WARN");
    expect(parent.outbox).toHaveLength(2);
  });

  it("close 父侧 do_window 归档子线程（B=ii archive）", async () => {
    const parent = makeThread({ id: "t_parent" });
    await execRootMethod("do", {
      thread: parent,
      args: { msg: "test" },
    });
    const childId = parent.childThreadIds![0]!;
    const doWindowId = parent.contextWindows.find(
      (w) => w.class === "do" && !(w as DoWindow).isCreatorWindow,
    )!.id;

    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const closed = mgr.close(doWindowId, parent);
    parent.contextWindows = mgr.toData();
    expect(closed).toBe(true);

    expect(parent.contextWindows.find((w) => w.id === doWindowId)).toBeUndefined();
    expect(parent.childThreads![childId]!.status).toBe("paused");
  });

  it("open(do, args={msg, wait:true}) 一次调用即完成 fork+wait（args 给齐时 open 立即提交 form）", async () => {
    const parent = makeThread({ id: "t_parent", extraWindows: [AGENT_WIN] });
    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const opened = await mgr.openMethodExec({
      thread: parent,
      parentWindowId: "agent",
      method: "do",
      title: "fork 子线程并等待",
      args: { msg: "处理告警", wait: true },
    });
    parent.contextWindows = mgr.toData();

    expect(opened.autoSubmitted).toBe(true);
    expect(parent.childThreadIds).toHaveLength(1);
    expect(parent.status).toBe("waiting");
    expect(parent.inboxSnapshotAtWait).toBe(0);
    // form 成功后应已自动消失，仅留 do_window 与 creator window
    expect(parent.contextWindows.find((w) => w.class === "method_exec")).toBeUndefined();
    expect(parent.contextWindows.some((w) => w.class === "do" && !(w as DoWindow).isCreatorWindow)).toBe(true);
  });
});
