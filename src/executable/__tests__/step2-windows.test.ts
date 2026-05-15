import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execRootCommand } from "../windows";
import { WindowManager } from "../windows";
import {
  ROOT_WINDOW_ID,
  type FileWindow,
  type KnowledgeWindow,
  type ProgramWindow,
  type TalkWindow,
} from "../windows/types";
import { createStoneObject, knowledgeDir } from "../../persistable";
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

      // 创建 talk_window 指向 bob
      await execRootCommand("talk", { thread, args: { target: "bob", title: "release plan" } });
      const talkWindow = thread.contextWindows.find((w): w is TalkWindow => w.type === "talk" && !w.isCreatorWindow);
      expect(talkWindow).toBeDefined();
      expect(talkWindow!.target).toBe("bob");

      // talk_window.say 通过 C 规则自动 submit，派送一条消息到 bob
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

    await execRootCommand("program", {
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

  it("todo_window: created via C-rule; close via close tool", async () => {
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

  it("file_window: created via open_file with C-rule; render reads file body", async () => {
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
      const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
      const knDir = knowledgeDir(stoneRef);
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
});

void ROOT_WINDOW_ID;
