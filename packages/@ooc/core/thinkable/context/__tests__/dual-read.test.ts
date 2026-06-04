/**
 * dual-read.test.ts — P5.2 运行时双读测试。
 *
 * 验证 buildInputItems() 在每轮 think loop 开始时，
 * 从 context/ 目录和 thread.contextWindows[] 双源读取，context/ 优先。
 *
 * 2026-06-01 ooc-6 Phase 5.2
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildInputItems, type ThreadContext } from "../index";
import { makeThread } from "../../../__tests__/make-thread";
import type { ThreadPersistenceRef } from "../../../persistable/common";
import type { ContextWindow } from "../../../executable/windows/_shared/types";
import { contextObjectFile } from "../../../persistable/flow-context";

const BASE_DIR = "/tmp/test-world";
const SESSION_ID = "_test_p5_dual_read";
const OBJECT_ID = "user";
const THREAD_ID = "t1";

const persistence: ThreadPersistenceRef = {
  baseDir: BASE_DIR,
  sessionId: SESSION_ID,
  objectId: OBJECT_ID,
  threadId: THREAD_ID,
};

afterEach(async () => {
  await rm(join(BASE_DIR, "flows", SESSION_ID), { recursive: true, force: true });
});

/** 手动写入 window.json 到 context/ 目录 */
async function writeWindowToContext(parentObjectId: string, window: ContextWindow): Promise<void> {
  const file = contextObjectFile(
    { baseDir: BASE_DIR, sessionId: SESSION_ID, objectId: OBJECT_ID },
    parentObjectId,
    window.id,
  );
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(window, null, 2), "utf8");
}

describe("P5.2 buildInputItems runtime dual-read", () => {
  it("context/ 目录中的 window 出现在 LLM 输入中", async () => {
    // 1. 创建 thread.persistence，但 thread.contextWindows 为空
    const thread = makeThread({
      id: THREAD_ID,
      persistence,
      extraWindows: [], // thread 中没有任何 window
      skipCreatorWindow: true,
    });

    // 2. 手动在 context/ 目录写一个 window
    const contextWindow: ContextWindow = {
      id: "w_context_only",
      type: "todo",
      parentWindowId: "root",
      title: "我来自 context/ 目录",
      status: "open",
      createdAt: Date.now(),
      content: "context 目录中的 todo 内容",
    };
    await writeWindowToContext("user", contextWindow);

    // 3. 调用 buildInputItems
    const out = await buildInputItems(thread as ThreadContext);

    // 4. 断言 system message 中包含 context/ 目录的 window
    const systemMsg = out.input.find(
      (item) => item.type === "message" && item.role === "system",
    ) as { content: string } | undefined;
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("w_context_only");
    expect(systemMsg!.content).toContain("我来自 context/ 目录");
    expect(systemMsg!.content).toContain("context 目录中的 todo 内容");
  });

  it("context/ 目录中的 window 覆盖 thread.contextWindows 中同 id 的 window", async () => {
    // 1. 创建 thread，其中有一个 window 带 id="w_overlap"
    const threadWindow: ContextWindow = {
      id: "w_overlap",
      type: "todo",
      parentWindowId: "root",
      title: "我来自 thread.contextWindows",
      status: "open",
      createdAt: 1,
      content: "thread 中的内容",
    };
    const thread = makeThread({
      id: THREAD_ID,
      persistence,
      extraWindows: [threadWindow],
      skipCreatorWindow: true,
    });

    // 2. 在 context/ 目录写一个同 id 但不同内容的 window
    const contextWindow: ContextWindow = {
      id: "w_overlap",
      type: "todo",
      parentWindowId: "root",
      title: "我来自 context/ 目录，我优先级更高",
      status: "open",
      createdAt: Date.now(),
      content: "context 目录中的内容，优先级更高",
    };
    await writeWindowToContext("user", contextWindow);

    // 3. 调用 buildInputItems
    const out = await buildInputItems(thread as ThreadContext);

    // 4. 断言 system message 中包含 context/ 版本的 window（优先级更高）
    const systemMsg = out.input.find(
      (item) => item.type === "message" && item.role === "system",
    ) as { content: string } | undefined;
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("w_overlap");
    expect(systemMsg!.content).toContain("我来自 context/ 目录，我优先级更高");
    expect(systemMsg!.content).not.toContain("我来自 thread.contextWindows");
    expect(systemMsg!.content).toContain("context 目录中的内容，优先级更高");
    expect(systemMsg!.content).not.toContain("thread 中的内容");
  });

  it("无 persistence 时不读取 context/ 目录（保持原行为）", async () => {
    const threadWindow: ContextWindow = {
      id: "w_thread_only",
      type: "todo",
      parentWindowId: "root",
      title: "thread 中的 window",
      status: "open",
      createdAt: 1,
      content: "只有 thread 里有我",
    };
    // 没有 persistence
    const thread = makeThread({
      id: THREAD_ID,
      extraWindows: [threadWindow],
      skipCreatorWindow: true,
    });

    // 写入 context/ 目录（但没有 persistence，应该不会被读取）
    const contextWindow: ContextWindow = {
      id: "w_context_only",
      type: "todo",
      parentWindowId: "root",
      title: "context 中的 window（不应被读取）",
      status: "open",
      createdAt: Date.now(),
      content: "不应出现",
    };
    await writeWindowToContext("user", contextWindow);

    const out = await buildInputItems(thread as ThreadContext);

    const systemMsg = out.input.find(
      (item) => item.type === "message" && item.role === "system",
    ) as { content: string } | undefined;
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("w_thread_only");
    expect(systemMsg!.content).toContain("thread 中的 window");
    expect(systemMsg!.content).not.toContain("w_context_only");
    expect(systemMsg!.content).not.toContain("不应出现");
  });

  it("context/ 目录为空时仅使用 thread.contextWindows", async () => {
    const threadWindow: ContextWindow = {
      id: "w_only_in_thread",
      type: "todo",
      parentWindowId: "root",
      title: "只有 thread 里有我",
      status: "open",
      createdAt: 1,
      content: "thread 独有内容",
    };
    const thread = makeThread({
      id: THREAD_ID,
      persistence,
      extraWindows: [threadWindow],
      skipCreatorWindow: true,
    });

    // 不写入任何 context/ 目录内容
    const out = await buildInputItems(thread as ThreadContext);

    const systemMsg = out.input.find(
      (item) => item.type === "message" && item.role === "system",
    ) as { content: string } | undefined;
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("w_only_in_thread");
    expect(systemMsg!.content).toContain("只有 thread 里有我");
    expect(systemMsg!.content).toContain("thread 独有内容");
  });

  it("不会 mutate 原 thread 对象", async () => {
    const threadWindow: ContextWindow = {
      id: "w_test",
      type: "todo",
      parentWindowId: "root",
      title: "original",
      status: "open",
      createdAt: 1,
      content: "original content",
    };
    const thread = makeThread({
      id: THREAD_ID,
      persistence,
      extraWindows: [threadWindow],
      skipCreatorWindow: true,
    });

    const contextWindow: ContextWindow = {
      id: "w_test",
      type: "todo",
      parentWindowId: "root",
      title: "overridden",
      status: "open",
      createdAt: Date.now(),
      content: "overridden content",
    };
    await writeWindowToContext("user", contextWindow);

    const originalContextWindows = [...thread.contextWindows];
    await buildInputItems(thread as ThreadContext);

    // 原 thread 不应被修改
    expect(thread.contextWindows).toEqual(originalContextWindows);
    expect(thread.contextWindows[0]!.title).toBe("original");
    expect((thread.contextWindows[0] as { content?: string }).content).toBe("original content");
  });
});
