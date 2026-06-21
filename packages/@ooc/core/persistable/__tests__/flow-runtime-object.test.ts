import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runtimeObjectDataFile,
  writeRuntimeObjectData,
  readRuntimeObjectData,
} from "../flow-runtime-object";
import { __resetSerialQueueForTests } from "@ooc/core/runtime/serial-queue";
import type { FlowObjectRef } from "../common";

describe("flow-runtime-object — ooc-6 P5'.1 flat runtime layout (裸 data.json)", () => {
  let baseDir: string;
  let ref: FlowObjectRef;
  const sampleData: Record<string, unknown> = {
    content: "demo todo body",
    done: false,
  };

  beforeEach(async () => {
    __resetSerialQueueForTests();
    baseDir = await mkdtemp(join(tmpdir(), "ooc-runtime-obj-"));
    ref = { baseDir, sessionId: "sess_rt", objectId: "todo_run_xyz" };
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("computes correct path: flows/<sid>/objects/<oid>/data.json", () => {
    expect(runtimeObjectDataFile(ref)).toBe(
      join(baseDir, "flows", "sess_rt", "objects", "todo_run_xyz", "data.json"),
    );
  });

  it("write + read roundtrip preserves the bare Data shape", async () => {
    await writeRuntimeObjectData(ref, sampleData);
    const back = await readRuntimeObjectData(ref);
    expect(back).toEqual(sampleData);
  });

  it("writes bare data (no {id,class,data} envelope) to disk", async () => {
    await writeRuntimeObjectData(ref, sampleData);
    const onDisk = JSON.parse(await readFile(runtimeObjectDataFile(ref), "utf8"));
    expect(onDisk).toEqual(sampleData);
    expect(onDisk).not.toHaveProperty("data");
    expect(onDisk).not.toHaveProperty("class");
  });

  it("strips contextWindows before writing", async () => {
    await writeRuntimeObjectData(ref, { ...sampleData, contextWindows: [{ id: "x" }] });
    const back = await readRuntimeObjectData(ref);
    expect(back).toEqual(sampleData);
    expect(back).not.toHaveProperty("contextWindows");
  });

  it("read returns undefined when file missing (ENOENT graceful)", async () => {
    const back = await readRuntimeObjectData(ref);
    expect(back).toBeUndefined();
  });

  it("update overwrites previous data.json contents", async () => {
    await writeRuntimeObjectData(ref, sampleData);
    await writeRuntimeObjectData(ref, { ...sampleData, content: "renamed" });
    const back = await readRuntimeObjectData(ref);
    expect(back?.content).toBe("renamed");
  });
});
