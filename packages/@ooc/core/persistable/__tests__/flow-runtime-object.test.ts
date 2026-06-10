import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runtimeObjectStateFile,
  writeRuntimeObjectState,
  readRuntimeObjectState,
  deleteRuntimeObject,
} from "../flow-runtime-object";
import { __resetSerialQueueForTests } from "@ooc/core/runtime/serial-queue";
import type { ContextWindow } from "../../executable/windows/_shared/types.js";
import type { FlowObjectRef } from "../common";

describe("flow-runtime-object — ooc-6 P5'.1 flat runtime layout", () => {
  let baseDir: string;
  let ref: FlowObjectRef;
  const sampleWindow: ContextWindow = {
    id: "todo_run_xyz",
    class: "todo",
    title: "demo todo",
    status: "open",
    content: "demo todo body",
    createdAt: 1717000000000,
  };

  beforeEach(async () => {
    __resetSerialQueueForTests();
    baseDir = await mkdtemp(join(tmpdir(), "ooc-runtime-obj-"));
    ref = { baseDir, sessionId: "sess_rt", objectId: "todo_run_xyz" };
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("computes correct path: flows/<sid>/objects/<oid>/state.json", () => {
    expect(runtimeObjectStateFile(ref)).toBe(
      join(baseDir, "flows", "sess_rt", "objects", "todo_run_xyz", "state.json"),
    );
  });

  it("write + read roundtrip preserves the ContextWindow shape", async () => {
    await writeRuntimeObjectState(ref, sampleWindow);
    const back = await readRuntimeObjectState(ref);
    expect(back).toEqual(sampleWindow);
  });

  it("read returns undefined when file missing (ENOENT graceful)", async () => {
    const back = await readRuntimeObjectState(ref);
    expect(back).toBeUndefined();
  });

  it("deleteRuntimeObject removes the object directory; second call is idempotent", async () => {
    await writeRuntimeObjectState(ref, sampleWindow);
    await deleteRuntimeObject(ref);
    const file = runtimeObjectStateFile(ref);
    let exists = true;
    try {
      await stat(file);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
    // 第二次调用应当幂等（ENOENT 不抛）
    await deleteRuntimeObject(ref);
  });

  it("update overwrites previous state.json contents", async () => {
    await writeRuntimeObjectState(ref, sampleWindow);
    const updated: ContextWindow = { ...sampleWindow, title: "renamed" } as ContextWindow;
    await writeRuntimeObjectState(ref, updated);
    const back = await readRuntimeObjectState(ref);
    expect(back?.title).toBe("renamed");
  });
});
