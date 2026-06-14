import { describe, expect, it } from "bun:test";

// side-effects：注册 thread / talk / reflect_request 三个 class（say 是 thread 的行为，会话窗共享同一 method）。
import "@ooc/builtins/thread";
import "@ooc/builtins/reflect_request";
import "@ooc/core/executable/windows"; // 注册 talk class

import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { sayMethod } from "@ooc/builtins/thread/executable/method.say.js";
import { executeSay } from "@ooc/builtins/thread/executable/say.js";
import { execRootMethod, WindowManager } from "@ooc/core/executable/windows";
import type { TalkWindow } from "@ooc/core/executable/windows/_shared/types";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

/**
 * S3.2 —— say 归位到 thread class。
 *
 * 核验两件结构事实 + 一条 fork 派送行为：
 * 1. say 注册在 thread class 上（say 是 thread 的行为）。
 * 2. talk / reflect_request 的 say 是**同一 method 实例**（薄 delegation，无复制）。
 * 3. executeSay 在 fork 子窗上走内存树派送：消息进 child inbox + 父 outbox（不付磁盘 IO）。
 */
describe("thread.say (S3.2 归位)", () => {
  it("say 注册在 thread class 上", () => {
    const def = builtinRegistry.getObjectDefinition("thread");
    expect(def.methods?.say).toBeDefined();
    expect(def.methods?.say).toBe(sayMethod);
  });

  it("talk / reflect_request 的 say delegate 到同一 thread.say 实例", () => {
    const threadDef = builtinRegistry.getObjectDefinition("thread");
    const talkDef = builtinRegistry.getObjectDefinition("talk");
    const reflectDef = builtinRegistry.getObjectDefinition("reflect_request");
    // 同一 ObjectMethod 引用 —— 不是逐字复制的两份逻辑。
    expect(talkDef.methods?.say).toBe(threadDef.methods?.say);
    expect(reflectDef.methods?.say).toBe(threadDef.methods?.say);
  });

  it("executeSay 在 fork 子窗上走内存树派送（child inbox + 父 outbox）", async () => {
    const SELF = "alice";
    const persistence: ThreadPersistenceRef = {
      baseDir: "/tmp/__test__",
      sessionId: "s_test",
      objectId: SELF,
      threadId: "t_parent",
    };
    const parent = makeThread({ id: "t_parent", persistence });

    // fork 一条同对象子线程，得到父侧 fork 子窗。
    await execRootMethod("talk", { thread: parent, args: { target: SELF, msg: "首条消息" } });
    const childId = parent.childThreadIds![0]!;
    const forkWindow = parent.contextWindows.find(
      (w): w is TalkWindow =>
        w.class === "talk" && (w as TalkWindow).isForkWindow === true && !(w as TalkWindow).isCreatorWindow,
    )!;
    expect(forkWindow).toBeDefined();

    // 直接驱动 thread.say 的逻辑（ctx.self = fork 子窗）。
    const out = await executeSay({
      thread: parent,
      self: forkWindow,
      manager: WindowManager.fromThread(parent, builtinRegistry),
      args: { msg: "继续处理 WARN" },
    } as any);

    expect(out).toBeUndefined();
    const child = parent.childThreads![childId]!;
    // 首条来自 fork 构造 + 本次 say = 2 条进 child inbox / 父 outbox。
    expect(child.inbox?.map((m) => m.content)).toEqual(["首条消息", "继续处理 WARN"]);
    expect(parent.outbox?.map((m) => m.content)).toEqual(["首条消息", "继续处理 WARN"]);
  });
});
