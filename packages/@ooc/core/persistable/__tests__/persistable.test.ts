import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createFlowObject,
  flowMetadataFile,
  llmInputFile,
  llmOutputFile,
  writeDebugInput,
  writeDebugOutput,
} from "../index";
import { readThread, writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json";
import { writeThreadContext } from "@ooc/builtins/agent/thread/persistable/flow-thread-context";
import type { ThreadContext } from "../../thinkable/context";
// 触发 builtin class 注册（loadThread/hydrate 用 builtinRegistry.has 判定保留/丢弃窗）。
import "@ooc/core/runtime/register-builtins";

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

  test("readThread filters out unregistered-class windows from thread-context.json", async () => {
    // 退役 thread.json.contextWindows 后，thread-context.json 是唯一完整权威。
    // Wave4：hydrate 按 entry.class 判定——`registry.has(class)` 为 false（已废弃 / 悬空 class）
    // 的窗 graceful drop（warn），已注册 class 的窗保留。这里用真实注册 class `agent/todo`
    // 当「保留」样本，悬空 type="issue"（无 class 字段）当「丢弃」样本。
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });
    const persistence = { ...ref, threadId: "legacy" };
    // 先写一份最小 thread.json（不含 contextWindows，退役后的形态）。
    const thread: ThreadContext = {
      id: "legacy",
      status: "running",
      events: [],
      contextWindows: [],
      persistence
    };
    await writeThread(thread);
    // 直接构造 thread-context.json：inline 一个悬空 type ("issue"，无 class 字段) + 一个
    // 已注册 class 的窗 (agent/todo)。issue 无 class → drop；todo 已注册 → 保留。
    await writeThreadContext(persistence, [
      // @ts-expect-error - intentionally write legacy entry without a class field
      { id: "w_issue_x", type: "issue", title: "old issue ref", status: "open" },
      {
        id: "w_todo_x",
        class: "agent/todo",
        title: "real todo",
        status: "open",
        createdAt: 1,
        data: { content: "real todo", status: "open" },
      },
    ]);

    const restored = await readThread(ref, "legacy");

    expect(restored).toBeDefined();
    expect(restored?.id).toBe("legacy");
    // issue window 被 drop, todo window 保留
    const ids = (restored?.contextWindows ?? []).map((w) => w.id);
    expect(ids).not.toContain("w_issue_x");
    expect(ids).toContain("w_todo_x");
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
