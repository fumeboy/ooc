import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execRootMethod } from "../windows";
import { WindowManager } from "../windows";
import {
  ROOT_WINDOW_ID,
  creatorWindowIdOf,
  type FileWindow,
  type KnowledgeWindow,
  type ProgramWindow,
  type TalkWindow,
} from "../windows/_shared/types";
import { createStoneObject, createPoolObject, poolKnowledgeDir } from "../../persistable";
import { buildContext } from "../../thinkable/context";
import { clearKnowledgeLoaderCache } from "../../thinkable/knowledge";
import { makeThread } from "../../__tests__/make-thread";

/**
 * Step 2 各 window 类型的端到端最小覆盖：创建 → 后续命令 → close。
 */

describe("Step 2 window lifecycles", () => {
  it("talk_window: root.talk creates window; say delivers cross-object; close releases", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-talk-"));
    try {
      // caller thread 必须有 persistence ref，talk-delivery 才能 createFlowObject + 写 callee
      const thread = makeThread({
        id: "root",
        persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "alice", threadId: "root" },
      });
      // 必须先建 caller flow object 目录，writeThread 才能落盘
      const { createFlowObject } = await import("../../persistable");
      await createFlowObject({ baseDir: tempRoot, sessionId: "s1", objectId: "alice" });
      // root.talk 校验 target 对应 stones/ 存在(spec relation activation 2026-05-18);
      // 测试场景需要预先建 bob stone 才能 open talk_window
      await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

      // 创建 talk_window 指向 bob
      await execRootMethod("talk", { thread, args: { target: "bob", title: "release plan" } });
      const talkWindow = thread.contextWindows.find((w): w is TalkWindow => w.type === "talk" && !w.isCreatorWindow);
      expect(talkWindow).toBeDefined();
      expect(talkWindow!.target).toBe("bob");

      // talk_window.say 在 args 给齐时 open 立即提交 form，派送一条消息到 bob
      const mgr = WindowManager.fromThread(thread);
      const opened = await mgr.openCommandExec({
        thread,
        parentWindowId: talkWindow!.id,
        command: "say",
        title: "ask",
        args: { msg: "deploy tomorrow ok?" },
      });
      thread.contextWindows = mgr.toData();
      expect(opened.autoSubmitted).toBe(true);
      expect(thread.outbox?.[0]?.windowId).toBe(talkWindow!.id);
      expect(thread.outbox?.[0]?.source).toBe("talk");

      // talk_window.targetThreadId 已被 talk-delivery 回填
      const updated = thread.contextWindows.find((w): w is TalkWindow => w.id === talkWindow!.id);
      expect(updated?.targetThreadId).toBeDefined();

      // close（非 creator）允许
      const mgr2 = WindowManager.fromThread(thread);
      expect(mgr2.close(talkWindow!.id, thread)).toBe(true);
      thread.contextWindows = mgr2.toData();
      expect(thread.contextWindows.find((w) => w.id === talkWindow!.id)).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("program_window: root.program runs first exec; window.exec appends to history", async () => {
    const thread = makeThread({ id: "t_root" });

    await execRootMethod("program", {
      thread,
      args: { language: "shell", code: "echo first" },
    });
    const programWindow = thread.contextWindows.find(
      (w): w is ProgramWindow => w.type === "program",
    );
    expect(programWindow).toBeDefined();
    expect(programWindow!.history).toHaveLength(1);
    expect(programWindow!.history[0]?.output).toContain("first");

    // 二次 exec 通过 program_window.exec
    const mgr = WindowManager.fromThread(thread);
    await mgr.openCommandExec({
      thread,
      parentWindowId: programWindow!.id,
      command: "exec",
      title: "second",
      args: { language: "shell", code: "echo second" },
    });
    thread.contextWindows = mgr.toData();
    const reread = thread.contextWindows.find((w) => w.id === programWindow!.id) as ProgramWindow;
    expect(reread.history).toHaveLength(2);
    expect(reread.history[1]?.output).toContain("second");
  });

  it("todo_window: created via one-shot open (args complete → submit immediately); close via close tool", async () => {
    const thread = makeThread({ id: "t_root" });
    const mgr = WindowManager.fromThread(thread);
    await mgr.openCommandExec({
      thread,
      command: "todo",
      title: "buy milk",
      args: { content: "buy milk" },
    });
    thread.contextWindows = mgr.toData();
    const todo = thread.contextWindows.find((w) => w.type === "todo")!;
    expect(todo.type).toBe("todo");

    const mgr2 = WindowManager.fromThread(thread);
    expect(mgr2.close(todo.id, thread)).toBe(true);
    thread.contextWindows = mgr2.toData();
    expect(thread.contextWindows.find((w) => w.id === todo.id)).toBeUndefined();
  });

  it("file_window: created via open_file (args complete → submit immediately); render reads file body", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-fw-"));
    try {
      const file = join(tempRoot, "hello.txt");
      await writeFile(file, "alpha\nbeta\ngamma\n");
      const thread = makeThread({ id: "t_root" });
      const mgr = WindowManager.fromThread(thread);
      const opened = await mgr.openCommandExec({
        thread,
        command: "open_file",
        title: "read hello",
        args: { path: file },
      });
      thread.contextWindows = mgr.toData();
      expect(opened.autoSubmitted).toBe(true);
      const fw = thread.contextWindows.find((w): w is FileWindow => w.type === "file");
      expect(fw).toBeDefined();
      expect(fw!.path).toBe(file);

      const messages = await buildContext(thread);
      const xml = messages[0]?.content ?? "";
      expect(xml).toContain('type="file"');
      expect(xml).toContain("alpha");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("knowledge_window: open_knowledge force-fulls the doc and renders body", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-kw-"));
    clearKnowledgeLoaderCache();
    try {
      // 2026-05-23: knowledge 已迁到 pool 层；createStoneObject 仍创建 stone 骨架，
      // 但 knowledge 文档现在落在 pools/objects/<id>/knowledge/。
      await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
      const poolRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
      const knDir = poolKnowledgeDir(poolRef);
      await writeFile(
        join(knDir, "manual.md"),
        `---\ndescription: 手册\n---\n手册正文内容`,
      );
      const thread = makeThread({
        id: "t",
        persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
      });
      const mgr = WindowManager.fromThread(thread);
      const opened = await mgr.openCommandExec({
        thread,
        command: "open_knowledge",
        title: "pin manual",
        args: { path: "manual" },
      });
      thread.contextWindows = mgr.toData();
      expect(opened.autoSubmitted).toBe(true);
      const kw = thread.contextWindows.find((w): w is KnowledgeWindow => w.type === "knowledge");
      expect(kw).toBeDefined();
      expect(kw!.path).toBe("manual");

      const messages = await buildContext(thread);
      const xml = messages[0]?.content ?? "";
      expect(xml).toContain('type="knowledge"');
      // knowledge_window 自身渲染 + activator force-full 渲染各一次都包含正文
      expect(xml).toContain("手册正文内容");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * 回归测试:cross-object talk 的回信路由。
   *
   * 场景:
   *   user → assistant.say(target=bob)
   *   bob 收到后,通过自己的 creator talk_window (target=assistant) 回复 assistant
   *
   * 期望:
   *   bob 的回信落到 assistant 上 `target=bob` 的那个 talk_window 上(replyToWindowId 命中),
   *   而不是错落到 assistant 的 creator talk_window (target=user)。
   *
   * 旧实现写死 replyToWindowId = creatorWindowIdOf(calleeThread.id) → 把 bob 的回信
   * 标成"指向 user 的 creator window 的回信",和 user 无关的消息显示成 user 消息。
   */
  it("talk_window: cross-object 回信落到正确的对端 talk_window 上,而非 creator window", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-talk-reply-"));
    try {
      const { createFlowObject, readThread } = await import("../../persistable");
      await createFlowObject({ baseDir: tempRoot, sessionId: "s1", objectId: "assistant" });

      // assistant.t_user 是 user 派生的 assistant 主 thread
      const assistantThread = makeThread({
        id: "t_user_assistant",
        persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "assistant", threadId: "t_user_assistant" },
        creatorThreadId: "root",
        creatorObjectId: "user",
      });
      const { initContextWindows } = await import("../windows/_shared/init");
      initContextWindows(assistantThread, { creatorThreadId: "root", initialTaskTitle: "user task" });
      // root.talk target 校验需要 bob stone 存在
      await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

      // assistant 创建 talk_window 指向 bob
      await execRootMethod("talk", { thread: assistantThread, args: { target: "bob", title: "ask bob" } });
      const talkToBob = assistantThread.contextWindows.find(
        (w): w is TalkWindow => w.type === "talk" && w.target === "bob",
      );
      expect(talkToBob).toBeDefined();

      // assistant say → bob
      const mgr1 = WindowManager.fromThread(assistantThread);
      await mgr1.openCommandExec({
        thread: assistantThread,
        parentWindowId: talkToBob!.id,
        command: "say",
        title: "ask",
        args: { msg: "hi bob" },
      });
      assistantThread.contextWindows = mgr1.toData();
      const bobThreadId = assistantThread.contextWindows.find(
        (w): w is TalkWindow => w.id === talkToBob!.id,
      )!.targetThreadId!;

      // 读 bob 的 thread,它现在有 creator talk_window (target=assistant)
      const bobThread = (await readThread(
        { baseDir: tempRoot, sessionId: "s1", objectId: "bob" },
        bobThreadId,
      ))!;
      expect(bobThread).toBeTruthy();
      const bobCreatorTalk = bobThread.contextWindows.find(
        (w): w is TalkWindow => w.type === "talk" && w.target === "assistant" && Boolean(w.isCreatorWindow),
      );
      expect(bobCreatorTalk).toBeDefined();

      // bob 通过 creator talk_window 回 assistant
      const mgr2 = WindowManager.fromThread(bobThread);
      await mgr2.openCommandExec({
        thread: bobThread,
        parentWindowId: bobCreatorTalk!.id,
        command: "say",
        title: "reply",
        args: { msg: "hi assistant, got it" },
      });
      bobThread.contextWindows = mgr2.toData();

      // 关键断言:重新读 assistant.thread,bob 的回信应该归到 talkToBob (not creator)
      const refreshed = (await readThread(
        { baseDir: tempRoot, sessionId: "s1", objectId: "assistant" },
        "t_user_assistant",
      ))!;
      const reply = refreshed.inbox?.find((m) => m.content === "hi assistant, got it");
      expect(reply).toBeDefined();
      expect(reply!.replyToWindowId).toBe(talkToBob!.id);
      expect(reply!.replyToWindowId).not.toBe(creatorWindowIdOf("t_user_assistant"));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

void ROOT_WINDOW_ID;
