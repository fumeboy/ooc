import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createJobManager } from "../../runtime/job-manager";
import { createPauseStore } from "../../runtime/pause-store";
import { createRuntimeService } from "./service";
import { AppServerError } from "../../bootstrap/errors";
import { clearObservableDebugState } from "@ooc/core/observable";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearObservableDebugState();
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

  test("toggles observable debug status", () => {
    const service = makeService();

    expect(service.getDebugStatus()).toEqual({ enabled: false });
    expect(service.enableDebug()).toEqual({ enabled: true });
    expect(service.getDebugStatus()).toEqual({ enabled: true });
    expect(service.disableDebug()).toEqual({ enabled: false });
    expect(service.getDebugStatus()).toEqual({ enabled: false });
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
    const debugDir = join(tempRoot, "flows/s/o/threads/t/debug");
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
      expect(appError.message).toContain("loop_0003.input.json");
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
    const debugDir = join(tempRoot, "flows/s/o/threads/t/debug");
    await mkdir(debugDir, { recursive: true });
    await writeFile(join(debugDir, "llm.input.json"), JSON.stringify({ threadId: "t", inputItems: [] }));
    await writeFile(join(debugDir, "llm.output.json"), JSON.stringify({
      threadId: "t",
      outputItems: [{ type: "message", role: "assistant", content: "hi" }],
      provider: "openai",
      model: "test"
    }));

    const service = makeService();
    const out = (await service.getLatestDebug(ref)) as {
      input: { threadId: string };
      output: { outputItems: Array<{ content: string }> };
    };
    expect(out.input.threadId).toBe("t");
    expect(out.output.outputItems[0]?.content).toBe("hi");
  });
});
