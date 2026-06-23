/**
 * reload 回归 — 验证「绕过 WindowManager 直接改 thread.contextWindows 再 writeThread」
 * 的写路径，在 thread.json.contextWindows **退役** + hydrate legacy fallback **删除** 后仍正确。
 *
 * 机制核心（方案 B）：writeThread 是唯一持久化入口，单点刷 thread-context.json
 *   （buildEntries），因此覆盖所有绕过 WindowManager 的写路径——这些 window 不再依赖已删除的
 *   fallback，纯靠 thread-context.json round-trip。
 *
 * Wave4 对齐：
 *  - builtin inline 窗（todo / 会话窗 thread）整窗 inline 落 thread-context.json；其 class 必须是
 *    **已注册的 inline class**（agent/todo / _builtin/agent/thread）才在 hydrate 时保留。
 *  - 会话窗（talk-like）inst.class = `_builtin/agent/thread`（唯一会话载体注册 class），会话状态
 *    （target/...）进 inst.data；`talk` 是渲染期 POV 投影 class，不写进 inst.class、不落盘。
 *  - peer 窗不再经 `_ref` 持久化 round-trip，而是每次 reload 由 injectPeerWindowsIfObjectThread
 *    从 stone hierarchy 派生重注入（transient）——旧「append peer 窗 → writeThread → reload 还原」
 *    机制已退役（连同 registerNewObjectType / isBuiltinFeature / readThread 自带 registry 参数）。
 *
 * 覆盖：
 *  1. delivery.deliverTalkMessage —— 新建 callee thread（init 注入 builtin 窗 → writeThread）
 *  2. service seedSession/addUserTalkWindow —— 往 user.root append 会话窗（thread class）
 *  外加退役验证：writeThread 后磁盘 thread.json **不含** contextWindows 字段。
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowObject, __resetSerialQueueForTests } from "../index";
import { readThread, writeThread } from "@ooc/core/persistable/thread-container-io.js";
import { threadFile } from "@ooc/builtins/agent/thread/persistable/thread-json";
import type { FlowObjectRef, ThreadPersistenceRef } from "../common";
import { deliverTalkMessage } from "@ooc/builtins/agent/thread/executable/talk-delivery.js";
import type { ContextWindow } from "@ooc/core/_shared/types/context-window.js";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import {
  getSessionObjectTable,
  materializeWindow,
} from "@ooc/core/runtime/session-object-table.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import type { TalkWindowView } from "@ooc/builtins/agent/thread/types.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { makeThread } from "../../__tests__/make-thread";
// 触发 builtin class 注册（hydrate 用 builtinRegistry.has + isInlinePersisted 判定保留）。
import "@ooc/core/runtime/register-builtins";

/**
 * 造一个**持久化形态**的会话窗（B→A：窗=ref / data 入 session 对象表）。
 * 经 materializeWindow 把会话状态（target）写进 thread 的对象表、返回纯 ref；
 * 与 delivery 期望的扁平 TalkWindowView DTO 区分：后者另由 viewOf 经表还原。
 */
function makeThreadWindow(
  thread: ThreadContext,
  id: string,
  target: string,
): ContextWindow {
  return materializeWindow(thread, {
    id,
    class: THREAD_CLASS_ID,
    data: { target },
    parentWindowId: "root",
    title: target,
    status: "open",
    createdAt: Date.now(),
  });
}

/** 把持久化会话窗 ref 还原成 delivery 期望的扁平 TalkWindowView（data 经 session 对象表解析）。 */
function viewOf(win: ContextWindow, thread: ThreadContext): TalkWindowView {
  const data = (objectDataOf(win, getSessionObjectTable(thread)) ?? {}) as {
    target?: string;
    targetThreadId?: string;
  };
  return {
    id: win.id,
    class: win.class,
    target: data.target ?? "",
    targetThreadId: data.targetThreadId,
  };
}

describe("thread-context bypass reload regression", () => {
  let baseDir: string;

  beforeEach(async () => {
    __resetSerialQueueForTests();
    baseDir = await mkdtemp(join(tmpdir(), "_test_persistable_bypass-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("退役验证：writeThread 后磁盘 thread.json 不含 contextWindows 字段", async () => {
    const persistence: ThreadPersistenceRef = {
      baseDir,
      sessionId: "sess_retire",
      objectId: "agent_r",
      threadId: "t_main",
    };
    await createFlowObject(persistence);
    const thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
    // B→A：inline 窗 data（todo content/status）进 session 对象表，窗本身只是纯 ref。
    thread.contextWindows = [
      materializeWindow(thread, {
        id: "todo_keep",
        class: "agent/todo",
        data: { content: "body", status: "open" },
        title: "builtin todo",
        status: "open",
        createdAt: 1,
      }),
    ];
    await writeThread(thread);

    // thread.json 磁盘内容：contextWindows 字段已退役，不应出现。
    const rawThreadJson = JSON.parse(await readFile(threadFile(persistence), "utf8")) as Record<
      string,
      unknown
    >;
    expect(rawThreadJson.contextWindows).toBeUndefined();

    // readThread 完全靠 thread-context.json hydrate（builtin todo inline）。
    const restored = await readThread(
      { baseDir, sessionId: "sess_retire", objectId: "agent_r" },
      "t_main",
    );
    const ids = (restored?.contextWindows ?? []).map((w) => w.id);
    expect(ids).toContain("todo_keep");
  });

  it("路径1 delivery：新建 callee thread 的 builtin 窗经 writeThread 单点刷，reload 还原", async () => {
    const callerRef: FlowObjectRef = { baseDir, sessionId: "sess_deliver", objectId: "user" };
    const callerPersist: ThreadPersistenceRef = { ...callerRef, threadId: "root" };
    await createFlowObject(callerPersist);

    const talkWindowId = "talk_to_callee";
    const callerThread = makeThread({
      id: "root",
      persistence: callerPersist,
      skipCreatorWindow: true,
    });
    const talkWindow = makeThreadWindow(callerThread, talkWindowId, "agent_callee");
    callerThread.contextWindows = [talkWindow];

    // deliverTalkMessage 内部：createFlowObject(callee) + init 注入 builtin 窗 +
    // writeThread(callerThread) & writeThread(calleeThread)（单点刷 thread-context.json）。
    const result = await deliverTalkMessage({
      caller: { thread: callerThread, talkWindow: viewOf(talkWindow, callerThread) },
      content: "hello callee",
      source: "user",
    });
    expect(result.calleeObjectId).toBe("agent_callee");

    // reload callee thread —— 无 fallback，纯靠 thread-context.json round-trip。
    const calleeReloaded = await readThread(
      { baseDir, sessionId: "sess_deliver", objectId: "agent_callee" },
      result.calleeThreadId,
    );
    expect(calleeReloaded).toBeDefined();
    // callee init 注入的 creator 窗（builtin 会话窗）应被 writeThread 单点刷落 thread-context.json
    // 并由 readThread 还原（至少一个 builtin 窗在场，证明非空 round-trip）。
    expect((calleeReloaded?.contextWindows ?? []).length).toBeGreaterThan(0);

    // caller 会话窗（builtin thread class，inline）也经 writeThread 单点刷 → reload 还原。
    const callerReloaded = await readThread(callerRef, "root");
    const callerIds = (callerReloaded?.contextWindows ?? []).map((w) => w.id);
    expect(callerIds).toContain(talkWindowId);
  });

  it("路径2 service seedSession/addUserTalkWindow：append 会话窗 → writeThread → reload 还原", async () => {
    // 复刻 service 两路对 user.root 的核心持久化语义：append 一个会话窗（builtin thread class，inline）
    // 到 user.root.contextWindows，再 writeThread（service 内部经 deliverTalkMessage→writeThread
    // 或直接 writeThread 单点刷）。
    const sessionId = "sess_user";
    const userRef: FlowObjectRef = { baseDir, sessionId, objectId: "user" };
    const userPersist: ThreadPersistenceRef = { ...userRef, threadId: "root" };
    await createFlowObject(userPersist);

    const talkWindowId = "talk_user_to_agent";
    const userThread = makeThread({ id: "root", persistence: userPersist, skipCreatorWindow: true });
    const talkWindow = makeThreadWindow(userThread, talkWindowId, "agent_t");
    userThread.contextWindows = [...(userThread.contextWindows ?? []), talkWindow];
    await writeThread(userThread);

    // reload user.root —— 会话窗（builtin inline）经 thread-context.json round-trip 还原。
    const reloaded = await readThread(userRef, "root");
    const ids = (reloaded?.contextWindows ?? []).map((w) => w.id);
    expect(ids).toContain(talkWindowId);
  });
});
