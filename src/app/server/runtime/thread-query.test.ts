import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createFlowObject, writeThread } from "@src/persistable";
import type { ThreadContext } from "@src/thinkable/context";
import { scanPausedThreads, scanRunningThreads } from "./thread-query";

/**
 * 回归 root cause（2026-05-27）：scanThreadsByStatus 旧实现只 readdir 一层
 * `objects/`，不会进入 sub-object 目录（如 sentry/sentry_runtime_metrics/threads/）。
 * 修复后 walker 递归任何深度，按 `.flow.json` 识别 flow object，按相对路径派生 objectId。
 */

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function setupThread(
  baseDir: string,
  sessionId: string,
  objectId: string,
  threadId: string,
  status: ThreadContext["status"],
): Promise<void> {
  const ref = await createFlowObject({ baseDir, sessionId, objectId });
  const thread: ThreadContext = {
    id: threadId,
    status,
    events: [],
    contextWindows: [],
    persistence: { ...ref, threadId },
  };
  await writeThread(thread);
}

describe("scanThreadsByStatus recursion", () => {
  test("flat: objects/<a>/threads/<t> is found, objectId='a'", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "ooc-thread-query-"));
    await setupThread(tempRoot, "s1", "a", "t1", "running");

    const result = await scanRunningThreads(tempRoot, "s1");
    expect(result).toEqual([{ objectId: "a", threadId: "t1" }]);
  });

  test("nested: objects/<a>/<b>/threads/<t> is found, objectId='a/b'", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "ooc-thread-query-"));
    await setupThread(tempRoot, "s1", "a", "ta", "waiting");
    await setupThread(tempRoot, "s1", "a/b", "tb", "running");

    const result = await scanRunningThreads(tempRoot, "s1");
    const sorted = [...result].sort((x, y) => x.objectId.localeCompare(y.objectId));
    expect(sorted).toEqual([
      { objectId: "a", threadId: "ta" },
      { objectId: "a/b", threadId: "tb" },
    ]);
  });

  test("deeply nested: objects/<a>/<b>/<c>/threads/<t> is found, objectId='a/b/c'", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "ooc-thread-query-"));
    await setupThread(tempRoot, "s1", "a/b/c", "tc", "running");

    const result = await scanRunningThreads(tempRoot, "s1");
    expect(result).toEqual([{ objectId: "a/b/c", threadId: "tc" }]);
  });

  test("mixed flat + nested + various statuses: scanRunningThreads returns running+waiting only", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "ooc-thread-query-"));
    // flat
    await setupThread(tempRoot, "s1", "a", "t_running", "running");
    await setupThread(tempRoot, "s1", "a", "t_waiting", "waiting");
    await setupThread(tempRoot, "s1", "a", "t_done", "done");
    await setupThread(tempRoot, "s1", "a", "t_failed", "failed");
    await setupThread(tempRoot, "s1", "a", "t_paused", "paused");
    // nested 1 level
    await setupThread(tempRoot, "s1", "a/b", "t_nested_running", "running");
    await setupThread(tempRoot, "s1", "a/b", "t_nested_paused", "paused");
    // nested 2 levels — different parent
    await setupThread(tempRoot, "s1", "x/y/z", "t_deep_waiting", "waiting");

    const running = await scanRunningThreads(tempRoot, "s1");
    const sorted = [...running].sort((p, q) =>
      p.objectId === q.objectId
        ? p.threadId.localeCompare(q.threadId)
        : p.objectId.localeCompare(q.objectId),
    );
    expect(sorted).toEqual([
      { objectId: "a", threadId: "t_running" },
      { objectId: "a", threadId: "t_waiting" },
      { objectId: "a/b", threadId: "t_nested_running" },
      { objectId: "x/y/z", threadId: "t_deep_waiting" },
    ]);

    const paused = await scanPausedThreads(tempRoot, "s1");
    const pausedSorted = [...paused].sort((p, q) => p.objectId.localeCompare(q.objectId));
    expect(pausedSorted).toEqual([
      { objectId: "a", threadId: "t_paused" },
      { objectId: "a/b", threadId: "t_nested_paused" },
    ]);
  });

  test("missing flows/{sessionId}/objects directory returns []", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "ooc-thread-query-"));
    const result = await scanRunningThreads(tempRoot, "no-such-session");
    expect(result).toEqual([]);
  });

  test("directory without .flow.json is not treated as a flow object (only sub-object is found)", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "ooc-thread-query-"));
    // 只在 sub-object 创建 .flow.json：父目录 a/ 自己不是 object（无 .flow.json，无自己的 threads/）。
    await setupThread(tempRoot, "s1", "a/b", "tb", "running");

    const result = await scanRunningThreads(tempRoot, "s1");
    expect(result).toEqual([{ objectId: "a/b", threadId: "tb" }]);
  });
});
