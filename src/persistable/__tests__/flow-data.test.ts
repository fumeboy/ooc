import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  flowDataFile,
  readFlowData,
  writeFlowData,
  mergeFlowData,
  __resetSerialQueueForTests,
} from "..";
import type { FlowObjectRef } from "..";

let tempRoot: string | undefined;

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
  test("flowDataFile 计算 flows/<sid>/objects/<id>/data.json", () => {
    const ref: FlowObjectRef = { baseDir: "/abs", sessionId: "s1", objectId: "agent" };
    expect(flowDataFile(ref)).toBe(join("/abs", "flows", "s1", "objects", "agent", "data.json"));
  });

  test("readFlowData 文件不存在返回空对象 {}", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-data-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    expect(await readFlowData(ref)).toEqual({});
  });

  test("writeFlowData / readFlowData round trip + 自动 mkdir", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-data-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await writeFlowData(ref, { a: 1, b: "two" });
    expect(await readFlowData(ref)).toEqual({ a: 1, b: "two" });
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
    // 先写一个合法 JSON 让目录存在
    await writeFlowData(ref, { ok: true });
    await Bun.write(flowDataFile(ref), "not json {");
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
    const final = JSON.parse(await readFile(flowDataFile(ref), "utf8"));
    expect(final).toEqual({ a: 1, b: 2, c: 3 });
  });
});
