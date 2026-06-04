/**
 * P5 runtime object persistence e2e test.
 *
 * 验证完整链路：window 创建 → 更新 → 删除 → 重启加载 → 优先级。
 *
 * 2026-06-01 ooc-6 Phase 5
 *
 * 场景:
 *   a. 创建 session + thread
 *   b. open file window → 验证 context/<id>/window.json 存在
 *   c. refine file window set_range → 验证 window.json 更新
 *   d. close file window → 验证 context/<id>/ 目录被删除
 *   e. 重启（重新 load thread）→ 验证 context/ 目录数据被正确加载
 *   f. 验证 context/ 数据优先于 thread.contextWindows
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { WindowManager, builtinRegistry } from "@ooc/core/executable/windows";
import type { ThreadContext } from "@ooc/core/thinkable/context";
import { contextObjectFile, contextObjectDir, readContextObjectsRecursive } from "@ooc/core/persistable/flow-context";
import type { FileWindow } from "@ooc/core/executable/windows/_shared/types";
import { createFlowObject, readThread, writeThread } from "@ooc/core/persistable";
import { buildInputItems } from "@ooc/core/thinkable/context";

describe("[e2e backend] P5 runtime object persistence", () => {
  let tempFile: string;
  let tempDir: string;
  let baseDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ooc-p5-e2e-"));
    baseDir = tempDir;
    tempFile = join(tempDir, "test.txt");
    await writeFile(tempFile, "line 0\nline 1\nline 2\nline 3\nline 4\n");
  });

  afterEach(async () => {
    // 清理所有 _test_p5_ 开头的 session 目录
    if (existsSync(join(baseDir, "flows"))) {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(join(baseDir, "flows"));
      for (const entry of entries) {
        if (entry.startsWith("_test_p5_")) {
          await rm(join(baseDir, "flows", entry), { recursive: true, force: true });
        }
      }
    }
  });

  function makeThread(baseDir: string, sessionId: string): ThreadContext {
    return {
      id: "root",
      status: "running",
      events: [],
      contextWindows: [],
      persistence: {
        baseDir,
        sessionId,
        objectId: "user",
        threadId: "root",
      },
      inbox: [],
      outbox: [],
      threadLocalData: {},
    };
  }

  it("a. 创建 file window → context/<id>/window.json 存在", async () => {
    const sessionId = `_test_p5_${Date.now()}`;
    const ref = { baseDir, sessionId, objectId: "user" };
    await createFlowObject(ref);
    const thread = makeThread(baseDir, sessionId);
    await writeThread(thread);

    // 通过 WindowManager 创建 file window
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const fileWindow: FileWindow = {
      id: "w_file_test",
      type: "file",
      parentWindowId: "root",
      title: "test.txt",
      status: "open",
      createdAt: Date.now(),
      path: tempFile,
      viewport: { lineStart: 0, lineEnd: 5, columnStart: 0, columnEnd: 200 },
    };
    mgr.insertTypedWindow(fileWindow, thread);

    // 等待写入队列完成
    await new Promise(resolve => setTimeout(resolve, 100));

    // 验证 window.json 存在
    const windowFile = contextObjectFile(ref, "user", "w_file_test");
    const raw = await readFile(windowFile, "utf8");
    const written = JSON.parse(raw);
    expect(written.id).toBe("w_file_test");
    expect(written.type).toBe("file");
    expect(written.path).toBe(tempFile);
    expect(written.viewport).toEqual({ lineStart: 0, lineEnd: 5, columnStart: 0, columnEnd: 200 });
  });

  it("b. refine file window set_range → window.json 更新", async () => {
    const sessionId = `_test_p5_${Date.now()}`;
    const ref = { baseDir, sessionId, objectId: "user" };
    await createFlowObject(ref);
    const thread = makeThread(baseDir, sessionId);
    await writeThread(thread);

    // 先创建 file window
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const fileWindow: FileWindow = {
      id: "w_file_refine",
      type: "file",
      parentWindowId: "root",
      title: "test.txt",
      status: "open",
      createdAt: Date.now(),
      path: tempFile,
      viewport: { lineStart: 0, lineEnd: 5, columnStart: 0, columnEnd: 200 },
    };
    mgr.insertTypedWindow(fileWindow, thread);
    await new Promise(resolve => setTimeout(resolve, 100));

    // refine set_range
    const opened = await mgr.openMethodExec({
      thread,
      parentWindowId: "w_file_refine",
      command: "set_range",
      title: "set range",
      args: { lines: [1, 3] },
    });
    expect(opened.autoSubmitted).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    // 验证 window.json 已更新
    const windowFile = contextObjectFile(ref, "user", "w_file_refine");
    const raw = await readFile(windowFile, "utf8");
    const written = JSON.parse(raw) as FileWindow;
    expect(written.viewport).toEqual({ lineStart: 1, lineEnd: 3, columnStart: 0, columnEnd: 200 });
  });

  it("c. close file window → context/<id>/ 目录被删除", async () => {
    const sessionId = `_test_p5_${Date.now()}`;
    const ref = { baseDir, sessionId, objectId: "user" };
    await createFlowObject(ref);
    const thread = makeThread(baseDir, sessionId);
    await writeThread(thread);

    // 创建 file window
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const fileWindow: FileWindow = {
      id: "w_file_close",
      type: "file",
      parentWindowId: "root",
      title: "test.txt",
      status: "open",
      createdAt: Date.now(),
      path: tempFile,
      viewport: { lineStart: 0, lineEnd: 5, columnStart: 0, columnEnd: 200 },
    };
    mgr.insertTypedWindow(fileWindow, thread);
    await new Promise(resolve => setTimeout(resolve, 100));

    // 验证目录存在
    const windowDir = contextObjectDir(ref, "user", "w_file_close");
    expect(existsSync(windowDir)).toBe(true);

    // close window
    const closed = mgr.close("w_file_close", thread);
    expect(closed).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    // 验证目录已删除
    expect(existsSync(windowDir)).toBe(false);
  });

  it("d. 重启后 context/ 目录数据被正确加载", async () => {
    const sessionId = `_test_p5_${Date.now()}`;
    const ref = { baseDir, sessionId, objectId: "user" };
    await createFlowObject(ref);

    // Phase 1: 创建 thread 和 window，写入 context/
    const thread1 = makeThread(baseDir, sessionId);
    await writeThread(thread1);
    const mgr1 = WindowManager.fromThread(thread1, builtinRegistry);
    const fileWindow: FileWindow = {
      id: "w_file_restart",
      type: "file",
      parentWindowId: "root",
      title: "test.txt",
      status: "open",
      createdAt: Date.now(),
      path: tempFile,
      viewport: { lineStart: 0, lineEnd: 5, columnStart: 0, columnEnd: 200 },
    };
    mgr1.insertTypedWindow(fileWindow, thread1);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Phase 2: 模拟重启 —— 重新 readThread
    const loaded = await readThread(ref, "root");
    expect(loaded).toBeDefined();

    // Phase 3: 验证 readContextObjectsRecursive 能读到数据
    const contextObjects = await readContextObjectsRecursive(ref);
    expect(contextObjects.size).toBeGreaterThan(0);
    const loadedWindow = contextObjects.get("w_file_restart") as FileWindow;
    expect(loadedWindow).toBeDefined();
    expect(loadedWindow.id).toBe("w_file_restart");
    expect(loadedWindow.path).toBe(tempFile);

    // Phase 4: 验证 buildInputItems 能正确加载 context/ 数据
    const input = await buildInputItems(loaded!);
    const systemMsg = input.input.find(
      (item) => item.type === "message" && item.role === "system",
    ) as { content: string } | undefined;
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("w_file_restart");
    expect(systemMsg!.content).toContain("test.txt");
  });

  it("e. context/ 数据优先于 thread.contextWindows", async () => {
    const sessionId = `_test_p5_${Date.now()}`;
    const ref = { baseDir, sessionId, objectId: "user" };
    await createFlowObject(ref);

    // Phase 1: 先在 context/ 目录写入一个 window（模拟"外部修改"）
    const windowFile = contextObjectFile(ref, "user", "w_priority_test");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(windowFile, ".."), { recursive: true });
    await writeFile(windowFile, JSON.stringify({
      id: "w_priority_test",
      type: "todo",
      parentWindowId: "root",
      title: "来自 context/ 目录（优先级更高）",
      status: "open",
      createdAt: Date.now(),
      content: "context 目录中的内容",
    }, null, 2));

    // Phase 2: 创建 thread，其中 thread.contextWindows 有一个同 id 但不同内容的 window
    const thread = makeThread(baseDir, sessionId);
    thread.contextWindows = [{
      id: "w_priority_test",
      type: "todo",
      parentWindowId: "root",
      title: "来自 thread.contextWindows（应被覆盖）",
      status: "open",
      createdAt: 1,
      content: "thread 中的内容",
    }];
    await writeThread(thread);

    // Phase 3: buildInputItems 应优先使用 context/ 目录的数据
    const input = await buildInputItems(thread);
    const systemMsg = input.input.find(
      (item) => item.type === "message" && item.role === "system",
    ) as { content: string } | undefined;
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("w_priority_test");
    expect(systemMsg!.content).toContain("来自 context/ 目录（优先级更高）");
    expect(systemMsg!.content).not.toContain("来自 thread.contextWindows");
    expect(systemMsg!.content).toContain("context 目录中的内容");
    expect(systemMsg!.content).not.toContain("thread 中的内容");
  });
});
