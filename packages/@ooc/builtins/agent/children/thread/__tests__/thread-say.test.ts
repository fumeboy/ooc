import { describe, expect, it } from "bun:test";

// side-effect：注册 thread class（唯一会话载体）。say / reply 是 thread 的 object method；talk /
// reflect_request 不再是注册 class，而是 thread readable 按视角投影出的 window class——
// self-view（thread / reflect_request）surface `say`、creator-view（talk）surface `reply`。
import "@ooc/core/runtime/register-builtins.js";

import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { sayMethod, replyMethod } from "@ooc/builtins/agent/thread/executable/session-methods.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { WindowManager } from "@ooc/core/runtime/window-manager.js";
import { getSessionObjectTable } from "@ooc/core/runtime/session-object-table.js";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

/**
 * say / reply 归位到 thread class（creator-scoped inbox/outbox 模型）。
 *
 * 核验结构事实：
 * 1. say / reply 都注册为 thread class 的 object method。
 * 2. 投影窗按视角 surface 不同 method：self-view（thread / reflect_request）→ `say`（写 outbox）；
 *    creator-view（talk）→ `reply`（写 inbox）。各自解析到 thread class 上唯一的 say/reply 实例
 *    （薄 surface，无复制）——talk / reflect_request 是 thread readable 的投影 class，不是独立注册 class。
 */
describe("thread.say / thread.reply (creator-scoped 会话 method)", () => {
  it("say / reply 都注册为 thread class 的 object method", () => {
    expect(builtinRegistry.resolveObjectMethod(THREAD_CLASS_ID, "say")).toBe(sayMethod);
    expect(builtinRegistry.resolveObjectMethod(THREAD_CLASS_ID, "reply")).toBe(replyMethod);
  });

  it("投影窗按视角 surface say / reply：self-view→say、creator-view(talk)→reply", () => {
    // self-view 窗 surface say、解析到 thread.say 实例。
    for (const projClass of ["thread", "reflect_request"]) {
      const decl = builtinRegistry.resolveWindowClass(THREAD_CLASS_ID, projClass);
      expect(decl, `window decl for projection "${projClass}"`).toBeDefined();
      expect(decl!.object_methods).toContain("say");
      expect(builtinRegistry.resolveObjectMethod(THREAD_CLASS_ID, "say")).toBe(sayMethod);
    }
    // creator-view（talk）窗 surface reply、解析到 thread.reply 实例。
    const talkDecl = builtinRegistry.resolveWindowClass(THREAD_CLASS_ID, "talk");
    expect(talkDecl).toBeDefined();
    expect(talkDecl!.object_methods).toContain("reply");
    expect(talkDecl!.object_methods).not.toContain("say");
    expect(builtinRegistry.resolveObjectMethod(THREAD_CLASS_ID, "reply")).toBe(replyMethod);
  });

  // 退役：旧 fork 内存树双写（child inbox + 父 outbox）已被 creator-scoped 单写取代；scheduling
  // 留 TODO（enqueueThread 待建）。本用例本就被点 1 的 runningThread TODO 阻塞在 fork construct
  // （index.ts:144），待后续点接入运行 thread T + 真实 delivery 后重写。
  it.skip("[obsolete/deferred] fork 子窗上 say 走内存树派送（child inbox + 父 outbox）", async () => {
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
    const forkData = objectDataOf(forkInstance, getSessionObjectTable(parent)) as {
      isForkWindow?: boolean;
    };
    expect(forkData.isForkWindow).toBe(true);

    // 在 fork 子窗上调 thread.say（dispatch 三参：ctx, self=inst.object.data, args）。
    const out = await mgr.execObjectMethod(forkId, "say", { msg: "继续处理 WARN" }, parent);
    expect(out).toContain("已发送给 fork 对端");

    const child = parent.childThreads![childId]!;
    // 首条来自 fork 构造 + 本次 say = 2 条进 child inbox / 父 outbox。
    expect(child.inbox?.map((m) => m.content)).toEqual(["首条消息", "继续处理 WARN"]);
    expect(parent.outbox?.map((m) => m.content)).toEqual(["首条消息", "继续处理 WARN"]);
  });
});
