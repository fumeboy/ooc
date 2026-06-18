import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readData as readFlowData, mergeData as mergeFlowData } from "../persistable/flow-data.js";
import { __resetSerialQueueForTests, type FlowObjectRef } from "@ooc/core/persistable";

let tempRoot: string | undefined;

/** flow object 的 data.json 物理落点（flowDataFile 已降级私有；测试直接拼路径核验落点）。 */
function dataFile(ref: FlowObjectRef): string {
  return join(ref.baseDir, "flows", ref.sessionId, "objects", ref.objectId, "data.json");
}

beforeEach(() => {
  __resetSerialQueueForTests();
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("flow-data: ProgramSelf.getData/setData 的载体", () => {
  test("readFlowData 文件不存在返回空对象 {}", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-data-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    expect(await readFlowData(ref)).toEqual({});
  });

  test("mergeFlowData 落 flows/<sid>/objects/<id>/data.json + 自动 mkdir", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-data-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await mergeFlowData(ref, { a: 1, b: "two" });
    expect(await readFlowData(ref)).toEqual({ a: 1, b: "two" });
    // 落点核验：文件确实写到约定路径
    expect(JSON.parse(await readFile(dataFile(ref), "utf8"))).toEqual({ a: 1, b: "two" });
  });

  test("mergeFlowData 顶层 spread merge", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-data-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await mergeFlowData(ref, { x: 1, y: 2 });
    await mergeFlowData(ref, { y: 99, z: 3 });
    expect(await readFlowData(ref)).toEqual({ x: 1, y: 99, z: 3 });
  });

  test("readFlowData 抛清晰错误于损坏 JSON", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-data-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    // 先 merge 一个合法 JSON 让目录存在
    await mergeFlowData(ref, { ok: true });
    await Bun.write(dataFile(ref), "not json {");
    await expect(readFlowData(ref)).rejects.toThrow(/解析 flow data\.json 失败/);
  });

  test("并发 mergeFlowData 串行化保证不丢数据", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-data-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await Promise.all([
      mergeFlowData(ref, { a: 1 }),
      mergeFlowData(ref, { b: 2 }),
      mergeFlowData(ref, { c: 3 }),
    ]);
    const final = JSON.parse(await readFile(dataFile(ref), "utf8"));
    expect(final).toEqual({ a: 1, b: 2, c: 3 });
  });
});
