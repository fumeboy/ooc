import { describe, expect, it } from "bun:test";

// side-effect：注册 thread class（唯一会话载体）。say 是 thread 的 object method；talk /
// reflect_request 不再是注册 class，而是 thread readable 按视角投影出的 window class，
// 三种投影窗共享同一 thread.say 实例。
import "@ooc/core/runtime/register-builtins.js";

import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { sayMethod } from "@ooc/builtins/agent/thread/executable/session-methods.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { WindowManager } from "@ooc/core/runtime/window-manager.js";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

/**
 * say 归位到 thread class（Wave 4 对象模型）。
 *
 * 核验两件结构事实 + 一条 fork 派送行为：
 * 1. say 注册为 thread class 的 object method（say 是 thread 的行为）。
 * 2. thread / talk / reflect_request 三个投影 window decl 的 "say" 都解析到**同一** thread.say
 *    实例（薄 surface，无复制）——talk / reflect_request 是 thread readable 的投影 class，不是独立注册 class。
 * 3. fork 子窗上 say 走内存树派送：消息进 child inbox + 父 outbox（不付磁盘 IO）。
 */
describe("thread.say (归位到 thread class)", () => {
  it("say 注册为 thread class 的 object method", () => {
    const resolved = builtinRegistry.resolveObjectMethod(THREAD_CLASS_ID, "say");
    expect(resolved).toBeDefined();
    expect(resolved).toBe(sayMethod);
  });

  it("thread / talk / reflect_request 三个投影窗的 say 都引用同一 thread.say 实例", () => {
    // talk / reflect_request 不再是注册 class——它们是 thread readable 的投影 window class。
    // 三个 window decl 各自的 "say" object_method 引用都解析到同一个 thread.say 实例。
    const projections = ["thread", "talk", "reflect_request"];
    for (const projClass of projections) {
      const decl = builtinRegistry.resolveWindowClass(THREAD_CLASS_ID, projClass);
      expect(decl, `window decl for projection "${projClass}"`).toBeDefined();
      expect(decl!.object_methods).toContain("say");
      // 投影窗按名引用的 say 解析到 thread class 上唯一的 say 实例。
      const m = builtinRegistry.resolveObjectMethod(THREAD_CLASS_ID, "say");
      expect(m).toBe(sayMethod);
    }
  });

  it("fork 子窗上 say 走内存树派送（child inbox + 父 outbox）", async () => {
    const SELF = "alice";
    const persistence: ThreadPersistenceRef = {
      baseDir: "/tmp/__test__",
      sessionId: "s_test",
      objectId: SELF,
      threadId: "t_parent",
    };
    const parent = makeThread({ id: "t_parent", objectId: SELF, persistence });

    // fork 一条同对象子线程（talk(target=自己) ⇒ construct 派生子线程 + 父侧 fork 子窗）。
    const mgr = WindowManager.fromThread(parent, builtinRegistry);
    const forkId = await mgr.instantiate(THREAD_CLASS_ID, { target: SELF, msg: "首条消息" });
    parent.contextWindows = mgr.toData();

    const childId = parent.childThreadIds![0]!;
    const forkInstance = mgr.get(forkId)!;
    expect((forkInstance.data as { isForkWindow?: boolean }).isForkWindow).toBe(true);

    // 在 fork 子窗上调 thread.say（dispatch 三参：ctx, self=inst.data, args）。
    const out = await mgr.execObjectMethod(forkId, "say", { msg: "继续处理 WARN" }, parent);
    expect(out).toContain("已发送给 fork 对端");

    const child = parent.childThreads![childId]!;
    // 首条来自 fork 构造 + 本次 say = 2 条进 child inbox / 父 outbox。
    expect(child.inbox?.map((m) => m.content)).toEqual(["首条消息", "继续处理 WARN"]);
    expect(parent.outbox?.map((m) => m.content)).toEqual(["首条消息", "继续处理 WARN"]);
  });
});
