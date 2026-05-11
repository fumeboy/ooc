import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createJobManager } from "../../runtime/job-manager";
import { createPauseStore } from "../../runtime/pause-store";
import { createRuntimeService } from "./service";
import { AppServerError } from "../../bootstrap/errors";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function makeService() {
  return createRuntimeService({
    pauseStore: createPauseStore(),
    jobManager: createJobManager(),
  });
}

describe("runtime service", () => {
  test("returns global pause status", () => {
    const pauseStore = createPauseStore();
    const service = createRuntimeService({
      pauseStore,
      jobManager: createJobManager(),
    });

    pauseStore.enableGlobalPause();

    expect(service.getGlobalPauseStatus()).toEqual({ enabled: true });
  });

  test("getLatestDebug throws NOT_FOUND when debug files missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-runtime-debug-"));
    const ref = {
      baseDir: tempRoot,
      sessionId: "s",
      objectId: "o",
      threadId: "t",
    };
    const service = makeService();

    try {
      await service.getLatestDebug(ref);
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppServerError);
      const appError = error as AppServerError;
      expect(appError.code).toBe("NOT_FOUND");
      expect(appError.message).toContain("llm.input.json");
      expect(appError.details?.threadId).toBe("t");
    }
  });

  test("getLatestDebug throws INTERNAL_ERROR on invalid JSON", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-runtime-debug-"));
    const ref = {
      baseDir: tempRoot,
      sessionId: "s",
      objectId: "o",
      threadId: "t",
    };
    const debugDir = join(tempRoot, "flows/s/objects/o/threads/t/debug");
    await mkdir(debugDir, { recursive: true });
    await writeFile(join(debugDir, "llm.input.json"), "{not valid json");
    await writeFile(join(debugDir, "llm.output.json"), "{}");

    const service = makeService();

    try {
      await service.getLatestDebug(ref);
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppServerError);
      const appError = error as AppServerError;
      expect(appError.code).toBe("INTERNAL_ERROR");
      expect(appError.message).toContain("invalid JSON");
    }
  });

  test("getLoopDebug throws NOT_FOUND when loop files missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-runtime-debug-"));
    const ref = {
      baseDir: tempRoot,
      sessionId: "s",
      objectId: "o",
      threadId: "t",
    };
    const service = makeService();

    try {
      await service.getLoopDebug(ref, 3);
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppServerError);
      const appError = error as AppServerError;
      expect(appError.code).toBe("NOT_FOUND");
      expect(appError.message).toContain("loop_3.input.json");
      expect(appError.details?.loopIndex).toBe(3);
    }
  });

  test("getLatestDebug returns parsed JSON when files exist and are valid", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-runtime-debug-"));
    const ref = {
      baseDir: tempRoot,
      sessionId: "s",
      objectId: "o",
      threadId: "t",
    };
    const debugDir = join(tempRoot, "flows/s/objects/o/threads/t/debug");
    await mkdir(debugDir, { recursive: true });
    await writeFile(join(debugDir, "llm.input.json"), JSON.stringify({ threadId: "t", messages: [] }));
    await writeFile(join(debugDir, "llm.output.json"), JSON.stringify({ threadId: "t", result: { text: "hi" } }));

    const service = makeService();
    const out = (await service.getLatestDebug(ref)) as {
      input: { threadId: string };
      output: { result: { text: string } };
    };
    expect(out.input.threadId).toBe("t");
    expect(out.output.result.text).toBe("hi");
  });
});
