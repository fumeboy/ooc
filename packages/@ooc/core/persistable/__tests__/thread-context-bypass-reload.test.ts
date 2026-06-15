/**
 * reload 回归 — 验证「绕过 WindowManager 直接改 thread.contextWindows 再 writeThread」
 * 的写路径，在 thread.json.contextWindows **退役** + hydrate legacy fallback **删除** 后仍正确。
 *
 * 机制核心（方案 B）：writeThread 是唯一持久化入口，单点刷 thread-context.json
 *   （buildThreadContextEntries），因此覆盖所有绕过 WindowManager 的写路径——
 *   这些 window 不再依赖已删除的 fallback，纯靠 thread-context.json round-trip。
 *
 * 覆盖三类绕过路径：
 *  1. delivery.deliverTalkMessage —— 新建 callee thread（init 注入 builtin 窗 → writeThread）
 *  2. thinkloop reconcilePeerWindowsIntoContext —— 往 thread.contextWindows append peer 窗
 *  3. service seedSession/addUserTalkWindow —— 往 user.root append talk 窗
 *
 * 外加退役验证：writeThread 后磁盘 thread.json **不含** contextWindows 字段；
 * readThread 完全靠 thread-context.json + init 注入还原。
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFlowObject,
  readThread,
  writeThread,
  writeRuntimeObjectState,
  threadFile,
  __resetSerialQueueForTests,
} from "../index";
import type { FlowObjectRef, ThreadPersistenceRef } from "../common";
import { deliverTalkMessage } from "@ooc/builtins/agent/thread/executable/talk-delivery.js";
import { createObjectRegistry } from "../../runtime/object-registry";
import type { ContextWindow, TalkWindow } from "@ooc/core/_shared/types/context-window.js";
import { makeThread } from "../../__tests__/make-thread";

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
    thread.contextWindows = [
      {
        id: "todo_keep",
        class: "todo",
        title: "builtin todo",
        status: "open",
        content: "body",
        createdAt: 1,
      } as never,
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
    const talkWindow: TalkWindow = {
      id: talkWindowId,
      class: "talk",
      parentWindowId: "root",
      title: "agent_callee",
      status: "open",
      createdAt: Date.now(),
      target: "agent_callee",
      conversationId: talkWindowId,
    };
    const callerThread = makeThread({
      id: "root",
      persistence: callerPersist,
      skipCreatorWindow: true,
    });
    callerThread.contextWindows = [talkWindow];

    // deliverTalkMessage 内部：createFlowObject(callee) + init 注入 builtin 窗 +
    // writeThread(callerThread) & writeThread(calleeThread)（单点刷 thread-context.json）。
    const result = await deliverTalkMessage({
      caller: { thread: callerThread, talkWindow },
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
    // callee init 注入的 creator 窗（builtin do/talk）应被 writeThread 单点刷落 thread-context.json
    // 并由 readThread 还原（至少一个 builtin 窗在场，证明非空 round-trip）。
    expect((calleeReloaded?.contextWindows ?? []).length).toBeGreaterThan(0);

    // caller talk_window（builtin）也经 writeThread 单点刷 → reload 还原。
    const callerReloaded = await readThread(callerRef, "root");
    const callerIds = (callerReloaded?.contextWindows ?? []).map((w) => w.id);
    expect(callerIds).toContain(talkWindowId);
  });

  it("路径2 reconcilePeerWindows：append peer 窗 → writeThread → reload 还原", async () => {
    const sessionId = "sess_peer";
    const objectId = "agent_peer_host";
    const peerId = "agent_peer_x";
    const persistence: ThreadPersistenceRef = { baseDir, sessionId, objectId, threadId: "t_main" };
    await createFlowObject(persistence);

    // 模拟 reconcilePeerWindowsIntoContext 的核心持久化语义：往 thread.contextWindows
    // append 一个 peer 窗（id===type，非 builtin）。peer 是独立 flow object → thread-context.json
    // 落 _ref，权威字段在 peer 自身 state.json（由 WindowManager / peer 注入持久化）。
    await writeRuntimeObjectState(
      { baseDir, sessionId, objectId: peerId },
      {
        id: peerId,
        class: peerId,
        parentWindowId: "root",
        title: `peer: ${peerId}`,
        status: "open",
        createdAt: 1,
      } as never,
    );

    const peerWindow = {
      id: peerId,
      class: peerId,
      parentWindowId: "root",
      title: `peer: ${peerId}`,
      status: "open",
      createdAt: 1,
    } as unknown as ContextWindow;
    const thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
    thread.contextWindows = [peerWindow];
    await writeThread(thread);

    // peer type 在读时必须已注册（否则 readThread 的 unregistered drop 守门会丢它）；
    // 用一个注册了 peer type 的 registry 模拟 runtime per-world registry。
    const registry = createObjectRegistry();
    registry.registerNewObjectType(peerId as never, {
      isBuiltinFeature: false,
      methods: {},
    });

    const restored = await readThread(
      { baseDir, sessionId, objectId },
      "t_main",
      registry,
    );
    const ids = (restored?.contextWindows ?? []).map((w) => w.id);
    expect(ids).toContain(peerId);
  });

  it("路径3 service seedSession/addUserTalkWindow：append talk 窗 → writeThread → reload 还原", async () => {
    // 复刻 service 两路对 user.root 的核心持久化语义：append 一个 talk_window（builtin feature）
    // 到 user.root.contextWindows，再 writeThread（service 内部经 deliverTalkMessage→writeThread
    // 或直接 writeThread 单点刷）。
    const sessionId = "sess_user";
    const userRef: FlowObjectRef = { baseDir, sessionId, objectId: "user" };
    const userPersist: ThreadPersistenceRef = { ...userRef, threadId: "root" };
    await createFlowObject(userPersist);

    const talkWindowId = "talk_user_to_agent";
    const talkWindow: TalkWindow = {
      id: talkWindowId,
      class: "talk",
      parentWindowId: "root",
      title: "agent_t",
      status: "open",
      createdAt: Date.now(),
      target: "agent_t",
      conversationId: talkWindowId,
    };
    const userThread = makeThread({ id: "root", persistence: userPersist, skipCreatorWindow: true });
    userThread.contextWindows = [...(userThread.contextWindows ?? []), talkWindow];
    await writeThread(userThread);

    // reload user.root —— talk_window（builtin inline）经 thread-context.json round-trip 还原。
    const reloaded = await readThread(userRef, "root");
    const ids = (reloaded?.contextWindows ?? []).map((w) => w.id);
    expect(ids).toContain(talkWindowId);
  });
});
