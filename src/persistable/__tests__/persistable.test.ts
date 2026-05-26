import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createFlowObject,
  flowMetadataFile,
  llmInputFile,
  llmOutputFile,
  readThread,
  writeDebugInput,
  writeDebugOutput,
  writeThread
} from "../index";
import type { ThreadContext } from "../../thinkable/context";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("persistable single object flow", () => {
  test("creates a flow object directory with metadata", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });

    const metadata = JSON.parse(await readFile(flowMetadataFile(ref), "utf8"));

    expect(metadata).toEqual({
      type: "flow-object",
      sessionId: "s1",
      objectId: "obj"
    });
  });

  test("writes and reads a thread json file", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });
    const thread: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      contextWindows: [],
      persistence: { ...ref, threadId: "root" }
    };

    await writeThread(thread);
    const restored = await readThread(ref, "root");

    expect(restored?.id).toBe("root");
    expect(restored?.status).toBe("running");
    expect(restored?.persistence).toEqual({ ...ref, threadId: "root" });
  });

  test("readThread filters out windows with unregistered types (Round 7 issue cleanup)", async () => {
    // Round 7 移除 issue 看板后,历史 thread.json 可能含 type="issue" 等遗留 entries。
    // readThread 应 graceful skip (warn + drop) 而非抛错阻塞所有调用方。
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });
    // 构造 thread.json 含一个已废弃 type ("issue") + 一个合法 type ("file")
    const threadWithLegacy: ThreadContext = {
      id: "legacy",
      status: "running",
      events: [],
      contextWindows: [
        // @ts-expect-error - intentionally write legacy unregistered type
        { id: "w_issue_x", type: "issue", title: "old issue ref", status: "open" },
        // @ts-expect-error - minimal file window shape for test
        { id: "w_file_x", type: "file", title: "real.ts", path: "/tmp/x", status: "open" },
      ],
      persistence: { ...ref, threadId: "legacy" }
    };
    await writeThread(threadWithLegacy);

    const restored = await readThread(ref, "legacy");

    expect(restored).toBeDefined();
    expect(restored?.id).toBe("legacy");
    // issue window 被 drop, file window 保留
    const ids = (restored?.contextWindows ?? []).map((w) => w.id);
    expect(ids).not.toContain("w_issue_x");
    expect(ids).toContain("w_file_x");
  });

  test("returns undefined when reading a missing thread", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });

    const restored = await readThread(ref, "missing");

    expect(restored).toBeUndefined();
  });

  test("writes debug input and output files", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });
    const threadRef = { ...ref, threadId: "root" };

    await writeDebugInput(threadRef, {
      threadId: "root",
      inputItems: [{ type: "message", role: "system", content: "<context />" }]
    });
    await writeDebugOutput(threadRef, {
      threadId: "root",
      outputItems: [{ type: "message", role: "assistant", content: "ok" }],
      provider: "openai",
      model: "test"
    });

    const input = JSON.parse(await readFile(llmInputFile(threadRef), "utf8"));
    const output = JSON.parse(await readFile(llmOutputFile(threadRef), "utf8"));

    expect(input.threadId).toBe("root");
    expect(input.inputItems[0].type).toBe("message");
    expect(input.tools).toBeUndefined();
    expect(output.outputItems[0].content).toBe("ok");
  });
});
