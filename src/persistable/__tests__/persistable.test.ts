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
      persistence: { ...ref, threadId: "root" }
    };

    await writeThread(thread);
    const restored = await readThread(ref, "root");

    expect(restored?.id).toBe("root");
    expect(restored?.status).toBe("running");
    expect(restored?.persistence).toEqual({ ...ref, threadId: "root" });
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
      messages: [{ role: "system", content: "<context />" }],
      tools: []
    });
    await writeDebugOutput(threadRef, {
      threadId: "root",
      result: {
        provider: "openai",
        model: "test",
        text: "ok",
        toolCalls: []
      }
    });

    const input = JSON.parse(await readFile(llmInputFile(threadRef), "utf8"));
    const output = JSON.parse(await readFile(llmOutputFile(threadRef), "utf8"));

    expect(input.threadId).toBe("root");
    expect(output.result.text).toBe("ok");
  });
});
