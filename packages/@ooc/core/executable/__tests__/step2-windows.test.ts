import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execRootMethod, WindowManager, builtinRegistry } from "@ooc/core/executable/manager.js";
import {
  ROOT_WINDOW_ID,
  creatorWindowIdOf,
  type FileWindow,
  type KnowledgeWindow,
  type TerminalProcessWindow,
  type TalkWindow,
} from "@ooc/core/_shared/types/context-window.js";
import { createStoneObject, createPoolObject, poolKnowledgeDir } from "../../persistable";
import { buildContext } from "../../thinkable/context";
import { clearKnowledgeLoaderCache } from "../../thinkable/knowledge";
import { makeThread } from "../../__tests__/make-thread";
import type { ContextWindow } from "@ooc/core/_shared/types/context-window.js";

/**
 * Step 2 各 window 类型的端到端最小覆盖：创建 → 后续命令 → close。
 */

/**
 * 文件/程序工具方法（open_file / program 等）已从 root 移到 agent 组合持有的
 * tool-object 成员上：filesystem（grep/glob/open_file/write_file）与 terminal（program）。
 * dispatch 经成员窗路由，故 thread.contextWindows 须含对应成员窗 requireParent 才命中。
 */
const FS_WIN: ContextWindow = {
  id: "filesystem",
  class: "filesystem",
  parentWindowId: "root",
  title: "member: filesystem",
  status: "open",
  createdAt: Date.now(),
  isMemberWindow: true,
} as ContextWindow;

const TERMINAL_WIN: ContextWindow = {
  id: "terminal",
  class: "terminal",
  parentWindowId: "root",
  title: "member: terminal",
  status: "open",
  createdAt: Date.now(),
  isMemberWindow: true,
} as ContextWindow;

const KB_WIN: ContextWindow = {
  id: "knowledge_base",
  class: "knowledge_base",
  parentWindowId: "root",
  title: "member: knowledge_base",
  status: "open",
  createdAt: Date.now(),
  isMemberWindow: true,
} as ContextWindow;

/**
 * agency 方法（do/todo/...）已从 root 迁到 `_builtin/agent` 类。
 * 经 openMethodExec 直接调 agency 时须把 parentWindowId 指向一个 class 解析得到 `_builtin/agent` 的窗。
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
      // root.talk 校验 target 对应 stones/ 存在(relation activation);
      // 测试场景需要预先建 bob stone 才能 open talk_window
      await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

      // 创建 talk_window 指向 bob
      await execRootMethod("talk", { thread, args: { target: "bob", title: "release plan" } });
      const talkWindow = thread.contextWindows.find((w): w is TalkWindow => w.class === "talk" && !(w as TalkWindow).isCreatorWindow);
      expect(talkWindow).toBeDefined();
      expect(talkWindow!.target).toBe("bob");

      // talk_window.say 在 args 给齐时 open 立即提交 form，派送一条消息到 bob
      const mgr = WindowManager.fromThread(thread, builtinRegistry);
      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: talkWindow!.id,
        method: "say",
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
      const mgr2 = WindowManager.fromThread(thread, builtinRegistry);
      expect(mgr2.close(talkWindow!.id, thread)).toBe(true);
      thread.contextWindows = mgr2.toData();
      expect(thread.contextWindows.find((w) => w.id === talkWindow!.id)).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("terminal_process: terminal.run runs first exec; window.exec appends to history", async () => {
    // 跑 bash 已从 root 移到 agent 组合持有的 terminal tool-object 成员上；
    // 经 terminal 成员窗 openMethodExec("run") 走真实派发链路造出 terminal_process。
    const thread = makeThread({ id: "t_root", extraWindows: [TERMINAL_WIN] });

    const mgr0 = WindowManager.fromThread(thread, builtinRegistry);
    await mgr0.openMethodExec({
      thread,
      parentWindowId: "terminal",
      method: "run",
      title: "first",
      args: { code: "echo first" },
    });
    thread.contextWindows = mgr0.toData();
    const processWindow = thread.contextWindows.find(
      (w): w is TerminalProcessWindow => w.class === "terminal_process",
    );
    expect(processWindow).toBeDefined();
    expect(processWindow!.history).toHaveLength(1);
    expect(processWindow!.history[0]?.output).toContain("first");

    // 二次 exec 通过 terminal_process.exec
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    await mgr.openMethodExec({
      thread,
      parentWindowId: processWindow!.id,
      method: "exec",
      title: "second",
      args: { code: "echo second" },
    });
    thread.contextWindows = mgr.toData();
    const reread = thread.contextWindows.find((w) => w.id === processWindow!.id) as TerminalProcessWindow;
    expect(reread.history).toHaveLength(2);
    expect(reread.history[1]?.output).toContain("second");
  });

  it("todo_window: created via one-shot open (args complete → submit immediately); close via close tool", async () => {
    const thread = makeThread({ id: "t_root", extraWindows: [AGENT_WIN] });
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    await mgr.openMethodExec({
      thread,
      parentWindowId: "agent",
      method: "todo",
      title: "buy milk",
      args: { content: "buy milk" },
    });
    thread.contextWindows = mgr.toData();
    const todo = thread.contextWindows.find((w) => w.class === "todo")!;
    expect(todo.class).toBe("todo");

    const mgr2 = WindowManager.fromThread(thread, builtinRegistry);
    expect(mgr2.close(todo.id, thread)).toBe(true);
    thread.contextWindows = mgr2.toData();
    expect(thread.contextWindows.find((w) => w.id === todo.id)).toBeUndefined();
  });

  it("file_window: created via open_file (args complete → submit immediately); render reads file body", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-fw-"));
    try {
      const file = join(tempRoot, "hello.txt");
      await writeFile(file, "alpha\nbeta\ngamma\n");
      // open_file 已从 root 移到 filesystem 成员上：经 filesystem 成员窗 dispatch。
      const thread = makeThread({ id: "t_root", extraWindows: [FS_WIN] });
      const mgr = WindowManager.fromThread(thread, builtinRegistry);
      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: "filesystem",
        method: "open_file",
        title: "read hello",
        args: { path: file },
      });
      thread.contextWindows = mgr.toData();
      expect(opened.autoSubmitted).toBe(true);
      const fw = thread.contextWindows.find((w): w is FileWindow => w.class === "file");
      expect(fw).toBeDefined();
      expect(fw!.path).toBe(file);

      const messages = await buildContext(thread);
      const xml = messages[0]?.content ?? "";
      expect(xml).toContain('class="file"');
      expect(xml).toContain("alpha");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("knowledge_window: open_knowledge force-fulls the doc and renders body", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-kw-"));
    clearKnowledgeLoaderCache();
    try {
      // knowledge 已迁到 pool 层；createStoneObject 仍创建 stone 骨架，
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
        extraWindows: [KB_WIN],
      });
      const mgr = WindowManager.fromThread(thread, builtinRegistry);
      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: "knowledge_base",
        method: "open_knowledge",
        title: "pin manual",
        args: { path: "manual" },
      });
      thread.contextWindows = mgr.toData();
      expect(opened.autoSubmitted).toBe(true);
      const kw = thread.contextWindows.find((w): w is KnowledgeWindow => w.class === "knowledge");
      expect(kw).toBeDefined();
      expect(kw!.path).toBe("manual");

      const messages = await buildContext(thread);
      const xml = messages[0]?.content ?? "";
      expect(xml).toContain('class="knowledge"');
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
      const { initContextWindows } = await import("@ooc/core/thinkable/context/init.js");
      initContextWindows(assistantThread, { creatorThreadId: "root", initialTaskTitle: "user task" });
      // root.talk target 校验需要 bob stone 存在
      await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

      // assistant 创建 talk_window 指向 bob
      await execRootMethod("talk", { thread: assistantThread, args: { target: "bob", title: "ask bob" } });
      const talkToBob = assistantThread.contextWindows.find(
        (w): w is TalkWindow => w.class === "talk" && (w as TalkWindow).target === "bob",
      );
      expect(talkToBob).toBeDefined();

      // assistant say → bob
      const mgr1 = WindowManager.fromThread(assistantThread, builtinRegistry);
      await mgr1.openMethodExec({
        thread: assistantThread,
        parentWindowId: talkToBob!.id,
        method: "say",
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
        (w): w is TalkWindow => w.class === "talk" && (w as TalkWindow).target === "assistant" && Boolean((w as TalkWindow).isCreatorWindow),
      );
      expect(bobCreatorTalk).toBeDefined();

      // bob 通过 creator talk_window 回 assistant
      const mgr2 = WindowManager.fromThread(bobThread, builtinRegistry);
      await mgr2.openMethodExec({
        thread: bobThread,
        parentWindowId: bobCreatorTalk!.id,
        method: "say",
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
