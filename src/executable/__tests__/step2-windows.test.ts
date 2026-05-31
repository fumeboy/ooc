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
import { createStoneObject, createPoolObject, createFlowObject, poolKnowledgeDir, readTodos } from "../../persistable";
import { buildContext } from "../../thinkable/context";
import { clearKnowledgeLoaderCache } from "../../thinkable/knowledge";
import { makeThread } from "../../__tests__/make-thread";

/**
 * Step 2 各 window 类型的端到端最小覆盖：创建 → 后续命令 → close。
 */

describe("Step 2 window lifecycles", () => {
  it("root.talk (OOC-4 L5c): window-free 派送 cross-object + 写 talks.json 路由（不建 talk_window）", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-talk-"));
    try {
      // caller thread 必须有 persistence ref，deliverMessage 才能 createFlowObject + 写 callee
      const thread = makeThread({
        id: "root",
        persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "alice", threadId: "root" },
      });
      const { createFlowObject, readTalks, readThread } = await import("../../persistable");
      await createFlowObject({ baseDir: tempRoot, sessionId: "s1", objectId: "alice" });
      // root.talk 校验 target 对应 stones/ 存在(spec relation activation 2026-05-18)
      await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

      // root.talk(target=bob, content) —— window-free 派送，不创建 talk_window
      const result = await execRootMethod("talk", {
        thread,
        args: { target: "bob", content: "deploy tomorrow ok?" },
      });
      expect(result).toBeUndefined();

      // 不再创建 talk_window
      expect(thread.contextWindows.find((w) => w.type === "talk")).toBeUndefined();

      // 消息进 alice.outbox，source=talk，peerObjectId=bob
      expect(thread.outbox?.[0]?.source).toBe("talk");
      expect(thread.outbox?.[0]?.peerObjectId).toBe("bob");
      expect(thread.outbox?.[0]?.conversationId).toBeDefined();

      // alice.talks.json[bob] 路由写入（targetThreadId + conversationId）
      const aliceRouting = await readTalks({ baseDir: tempRoot, sessionId: "s1", objectId: "alice" });
      expect(aliceRouting["bob"]).toBeDefined();
      expect(aliceRouting["bob"]!.targetThreadId).toBeDefined();
      const bobThreadId = aliceRouting["bob"]!.targetThreadId!;

      // callee（bob）thread 创建 + inbox 收到消息
      const bobThread = (await readThread(
        { baseDir: tempRoot, sessionId: "s1", objectId: "bob" },
        bobThreadId,
      ))!;
      expect(bobThread).toBeTruthy();
      expect(bobThread.inbox?.some((m) => m.content === "deploy tomorrow ok?")).toBe(true);
      expect(bobThread.status).toBe("running");

      // bob.talks.json[alice] 反向路由写入（回信据此路由回 alice）
      const bobRouting = await readTalks({ baseDir: tempRoot, sessionId: "s1", objectId: "bob" });
      expect(bobRouting["alice"]).toBeDefined();
      expect(bobRouting["alice"]!.targetThreadId).toBe("root");

      // 复用：再 talk(target=bob) 不重建 callee thread（命中已有路由）
      await execRootMethod("talk", { thread, args: { target: "bob", content: "second" } });
      const aliceRouting2 = await readTalks({ baseDir: tempRoot, sessionId: "s1", objectId: "alice" });
      expect(aliceRouting2["bob"]!.targetThreadId).toBe(bobThreadId);
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

  it("todo_add: one-shot open (args complete → submit immediately) writes to todos.json; no window", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-todo-"));
    try {
      await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
      const thread = makeThread({
        id: "t_root",
        persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t_root" },
      });
      const mgr = WindowManager.fromThread(thread);
      const opened = await mgr.openCommandExec({
        thread,
        command: "todo_add",
        title: "buy milk",
        args: { content: "buy milk" },
      });
      thread.contextWindows = mgr.toData();
      expect(opened.autoSubmitted).toBe(true);
      // 不再产生 todo_window
      expect(thread.contextWindows.find((w) => (w as { type: string }).type === "todo")).toBeUndefined();
      // 写入对象级 todos.json
      const todos = await readTodos({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
      expect(todos).toHaveLength(1);
      expect(todos[0]?.content).toBe("buy milk");
      expect(todos[0]?.done).toBe(false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
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
   * 回归测试（OOC-4 L5c）：cross-object talk 双向往返经 talks.json 路由。
   *
   * 场景:
   *   assistant root.talk(target=bob, "hi bob") → bob 收到 + bob.talks.json[assistant] 路由
   *   bob root.talk(target=assistant, "got it") → 据 talks.json 路由回 assistant.inbox
   *
   * 期望:
   *   bob 的回信精确落到 assistant 原 thread.inbox（按 bob.talks.json[assistant].targetThreadId 路由），
   *   且共享同一 conversationId（双向配对一致，不串话）。
   */
  it("root.talk: cross-object 双向往返经 talks.json 路由回到正确 caller thread", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-talk-reply-"));
    try {
      const { createFlowObject, readThread, readTalks } = await import("../../persistable");
      await createFlowObject({ baseDir: tempRoot, sessionId: "s1", objectId: "assistant" });

      // assistant 主 thread（由 user 派生）
      const assistantThread = makeThread({
        id: "t_user_assistant",
        persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "assistant", threadId: "t_user_assistant" },
        creatorThreadId: "root",
        creatorObjectId: "user",
      });
      const { initContextWindows } = await import("../windows/_shared/init");
      initContextWindows(assistantThread, { creatorThreadId: "root", initialTaskTitle: "user task" });
      await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
      await createStoneObject({ baseDir: tempRoot, objectId: "assistant" });

      // assistant root.talk → bob（window-free）
      await execRootMethod("talk", { thread: assistantThread, args: { target: "bob", content: "hi bob" } });
      const assistantRouting = await readTalks({ baseDir: tempRoot, sessionId: "s1", objectId: "assistant" });
      const bobThreadId = assistantRouting["bob"]!.targetThreadId!;
      const sharedConvId = assistantRouting["bob"]!.conversationId;

      // 读 bob thread + 它的反向路由 talks.json[assistant]
      const bobThread = (await readThread(
        { baseDir: tempRoot, sessionId: "s1", objectId: "bob" },
        bobThreadId,
      ))!;
      expect(bobThread).toBeTruthy();
      expect(bobThread.inbox?.some((m) => m.content === "hi bob")).toBe(true);
      const bobRouting = await readTalks({ baseDir: tempRoot, sessionId: "s1", objectId: "bob" });
      expect(bobRouting["assistant"]!.targetThreadId).toBe("t_user_assistant");
      expect(bobRouting["assistant"]!.conversationId).toBe(sharedConvId);

      // bob root.talk → assistant（据 talks.json 路由回 assistant 原 thread）
      bobThread.persistence = { baseDir: tempRoot, sessionId: "s1", objectId: "bob", threadId: bobThread.id };
      await execRootMethod("talk", { thread: bobThread, args: { target: "assistant", content: "got it" } });

      // 关键断言：bob 的回信精确落到 assistant 原 thread.inbox，conversationId 一致
      const refreshed = (await readThread(
        { baseDir: tempRoot, sessionId: "s1", objectId: "assistant" },
        "t_user_assistant",
      ))!;
      const reply = refreshed.inbox?.find((m) => m.content === "got it");
      expect(reply).toBeDefined();
      expect(reply!.peerObjectId).toBe("bob");
      expect(reply!.conversationId).toBe(sharedConvId);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

void ROOT_WINDOW_ID;
