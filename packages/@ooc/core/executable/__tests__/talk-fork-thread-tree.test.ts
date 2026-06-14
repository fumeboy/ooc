import { describe, expect, it } from "bun:test";
import { execRootMethod } from "../windows";
import { WindowManager, builtinRegistry } from "../windows";
import { creatorWindowIdOf, type BaseContextWindow, type ContextWindow, type TalkWindow } from "../windows/_shared/types";
import { makeThread } from "../../__tests__/make-thread";
import type { ThreadPersistenceRef } from "../../persistable/common";

/**
 * agency 方法（talk）已从 root 迁到 `_builtin/agent` 类。
 * talk 统一两形态：target=自己 objectId ⇒ fork 一条同对象子线程（旧 do）；target=别的对象 ⇒ peer 会话。
 * 经 openMethodExec 直接调 talk 时须把 parentWindowId 指向一个 class 解析得到 `_builtin/agent` 的窗。
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

/** 取父侧 fork 子窗（非 creator）。 */
function findForkWindow(windows: BaseContextWindow[]): TalkWindow {
  const win = windows.find(
    (w): w is TalkWindow => w.class === "talk" && (w as TalkWindow).isForkWindow === true && !(w as TalkWindow).isCreatorWindow,
  );
  if (!win) throw new Error("expected fork window in parent");
  return win;
}

/**
 * talk fork 形态的 ContextWindow 行为验证（旧 do 并入）。
 */
describe("talk fork (ContextWindow model)", () => {
  it("fork: 创建 child thread、父侧 fork 子窗、child 的 creator fork 窗，并写消息", async () => {
    const parent = makeThread({ id: "t_parent", persistence: persistenceOf("t_parent") });
    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("处理日志中的错误", { wait: true }),
    });

    expect(parent.childThreadIds).toHaveLength(1);
    const childId = parent.childThreadIds![0]!;
    const child = parent.childThreads![childId]!;

    // 父侧 fork 子窗指向 child
    const forkWindow = findForkWindow(parent.contextWindows);
    expect(forkWindow.targetThreadId).toBe(childId);

    // child 自己有 creator fork 窗指向父
    const childCreatorWindow = child.contextWindows.find(
      (w): w is TalkWindow => w.class === "talk" && (w as TalkWindow).isCreatorWindow === true,
    );
    expect(childCreatorWindow).toBeDefined();
    expect(childCreatorWindow!.id).toBe(creatorWindowIdOf(childId));
    expect(childCreatorWindow!.isForkWindow).toBe(true);
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

  it("fork 子窗 say 通过 WindowManager.openMethodExec 调用，追加 child inbox + 父 outbox", async () => {
    const parent = makeThread({ id: "t_parent", persistence: persistenceOf("t_parent") });
    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("首条消息"),
    });
    const childId = parent.childThreadIds![0]!;
    const forkWindowId = findForkWindow(parent.contextWindows).id;

    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const opened = await mgr.openMethodExec({
      thread: parent,
      parentWindowId: forkWindowId,
      method: "say",
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

  it("close 父侧 fork 子窗归档子线程（archive）", async () => {
    const parent = makeThread({ id: "t_parent", persistence: persistenceOf("t_parent") });
    await execRootMethod("talk", {
      thread: parent,
      args: forkArgs("test"),
    });
    const childId = parent.childThreadIds![0]!;
    const forkWindowId = findForkWindow(parent.contextWindows).id;

    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const closed = mgr.close(forkWindowId, parent);
    parent.contextWindows = mgr.toData();
    expect(closed).toBe(true);

    expect(parent.contextWindows.find((w) => w.id === forkWindowId)).toBeUndefined();
    expect(parent.childThreads![childId]!.status).toBe("paused");
  });

  it("open(talk, args={target:self, msg, wait:true}) 一次调用即完成 fork+wait", async () => {
    const parent = makeThread({
      id: "t_parent",
      persistence: persistenceOf("t_parent"),
      extraWindows: [AGENT_WIN],
    });
    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const opened = await mgr.openMethodExec({
      thread: parent,
      parentWindowId: "agent",
      method: "talk",
      title: "fork 子线程并等待",
      args: forkArgs("处理告警", { wait: true }),
    });
    parent.contextWindows = mgr.toData();

    expect(opened.autoSubmitted).toBe(true);
    expect(parent.childThreadIds).toHaveLength(1);
    expect(parent.status).toBe("waiting");
    expect(parent.inboxSnapshotAtWait).toBe(0);
    // form 成功后应已自动消失，仅留 fork 子窗与 creator window
    expect(parent.contextWindows.find((w) => w.class === "method_exec")).toBeUndefined();
    expect(
      parent.contextWindows.some(
        (w) => w.class === "talk" && (w as TalkWindow).isForkWindow && !(w as TalkWindow).isCreatorWindow,
      ),
    ).toBe(true);
  });
});
