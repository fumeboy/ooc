/**
 * R0b 单测: list-loops endpoint (GET .../debug/loops).
 *
 * 4 用例 (plan §5.1 验收 + AgentOfObservable 派单要求):
 *   1. debug 目录不存在 → 200 + { loops: [] }
 *   2. debug 目录存在但无 loop_*.json → 200 + { loops: [] }
 *   3. 多个 loop, 部分仅 meta, 部分齐全 → 升序数组, flag 正确, meta 回填
 *   4. meta.json 损坏 (非合法 JSON) → 不抛; hasMeta=true 但 meta=undefined
 *
 * Session 卫生: 测试 fixture 用 _test_observable_<timestamp> 前缀.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { clearObservableDebugState } from "@ooc/core/observable";
import { readServerConfig } from "../../bootstrap/config";
import { buildServer } from "../../index";
import { createJobManager } from "../../runtime/job-manager";
import { createPauseStore } from "../../runtime/pause-store";
import { createRuntimeService } from "./service";

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
    baseDir: "/tmp/ooc-runtime-test-nonexistent",
    pauseStore: createPauseStore(),
    jobManager: createJobManager(),
  });
}

async function makeWorld() {
  const baseDir = await mkdtemp(join(tmpdir(), "_test_observable_list-loops-"));
  await ensureStoneRepo({ baseDir });
  tempRoot = baseDir;
  return baseDir;
}

const SESSION_ID = "_test_observable_session";
const OBJECT_ID = "obj";
const THREAD_ID = "thr";

function debugDirFor(baseDir: string): string {
  return join(
    baseDir,
    "flows",
    SESSION_ID,
    "objects",
    OBJECT_ID,
    "threads",
    THREAD_ID,
    "debug",
  );
}

function ref(baseDir: string) {
  return {
    baseDir,
    sessionId: SESSION_ID,
    objectId: OBJECT_ID,
    threadId: THREAD_ID,
  };
}

describe("runtime listLoops service", () => {
  test("debug dir absent → returns empty loops array", async () => {
    const baseDir = await makeWorld();
    const service = makeService();
    const result = await service.listLoops(ref(baseDir));
    expect(result).toEqual({ loops: [] });
  });

  test("debug dir exists but no loop_*.json → returns empty loops array", async () => {
    const baseDir = await makeWorld();
    const dir = debugDirFor(baseDir);
    await mkdir(dir, { recursive: true });
    // 放一些非 loop_ 文件混淆 (latest debug)
    await writeFile(join(dir, "llm.input.json"), "{}");
    await writeFile(join(dir, "llm.output.json"), "{}");
    await writeFile(join(dir, "unrelated.txt"), "noise");

    const service = makeService();
    const result = await service.listLoops(ref(baseDir));
    expect(result).toEqual({ loops: [] });
  });

  test("multiple loops with mixed file presence → ascending order, correct flags, meta content backfilled", async () => {
    const baseDir = await makeWorld();
    const dir = debugDirFor(baseDir);
    await mkdir(dir, { recursive: true });

    // loop_0001: input + output + meta (齐全), 但乱序文件名 (验证按 loopIndex 排序)
    const meta1 = {
      threadId: THREAD_ID,
      loopIndex: 1,
      provider: "openai",
      model: "test-model",
      startedAt: 1000,
      finishedAt: 1500,
      latencyMs: 500,
      messageCount: 3,
      toolCount: 4,
      toolCallCount: 1,
      contextBytes: 1234,
      resultTextBytes: 56,
      status: "ok" as const,
    };
    await writeFile(join(dir, "loop_0001.input.json"), JSON.stringify({ threadId: THREAD_ID, inputItems: [] }));
    await writeFile(join(dir, "loop_0001.output.json"), JSON.stringify({ threadId: THREAD_ID, outputItems: [] }));
    await writeFile(join(dir, "loop_0001.meta.json"), JSON.stringify(meta1));

    // loop_0003: 仅 meta
    const meta3 = { ...meta1, loopIndex: 3, latencyMs: 999, status: "error" as const, error: "boom" };
    await writeFile(join(dir, "loop_0003.meta.json"), JSON.stringify(meta3));

    // loop_0002: 仅 input + output (无 meta)
    await writeFile(join(dir, "loop_0002.input.json"), JSON.stringify({ threadId: THREAD_ID, inputItems: [] }));
    await writeFile(join(dir, "loop_0002.output.json"), JSON.stringify({ threadId: THREAD_ID, outputItems: [] }));

    // 噪声文件 (latest debug)
    await writeFile(join(dir, "llm.input.json"), "{}");

    const service = makeService();
    const { loops } = await service.listLoops(ref(baseDir));

    expect(loops.length).toBe(3);
    expect(loops.map((l) => l.loopIndex)).toEqual([1, 2, 3]);

    expect(loops[0]).toEqual({
      loopIndex: 1,
      hasInput: true,
      hasOutput: true,
      hasMeta: true,
      meta: meta1,
    });

    expect(loops[1]).toEqual({
      loopIndex: 2,
      hasInput: true,
      hasOutput: true,
      hasMeta: false,
    });
    // 第 2 条没有 meta 字段
    expect(loops[1]!.meta).toBeUndefined();

    expect(loops[2]).toEqual({
      loopIndex: 3,
      hasInput: false,
      hasOutput: false,
      hasMeta: true,
      meta: meta3,
    });
  });

  test("corrupt meta.json → does not throw; hasMeta=true but meta=undefined", async () => {
    const baseDir = await makeWorld();
    const dir = debugDirFor(baseDir);
    await mkdir(dir, { recursive: true });

    await writeFile(join(dir, "loop_0001.meta.json"), "{not valid json");
    await writeFile(join(dir, "loop_0001.input.json"), JSON.stringify({ threadId: THREAD_ID, inputItems: [] }));

    const service = makeService();
    const { loops } = await service.listLoops(ref(baseDir));

    expect(loops.length).toBe(1);
    expect(loops[0]!.loopIndex).toBe(1);
    expect(loops[0]!.hasInput).toBe(true);
    expect(loops[0]!.hasOutput).toBe(false);
    expect(loops[0]!.hasMeta).toBe(true);
    // 损坏 meta → meta 字段保持 undefined (区分 "存在但损坏" vs "不存在")
    expect(loops[0]!.meta).toBeUndefined();
  });
});

// HTTP 路径单测: 复用 buildServer + app.handle, 与 server.routes.test.ts 风格一致.
describe("GET /api/runtime/.../debug/loops HTTP", () => {
  async function makeApp(baseDir: string) {
    return buildServer({
      ...(await readServerConfig()),
      port: 0,
      baseDir,
      workerPollMs: 5,
      workerEnabled: false,
    });
  }

  function url(baseDir: string): string {
    return `http://localhost/api/runtime/flows/${SESSION_ID}/${OBJECT_ID}/threads/${THREAD_ID}/debug/loops`;
  }

  test("debug dir absent → 200 + empty loops", async () => {
    const baseDir = await makeWorld();
    const app = await makeApp(baseDir);
    const res = await app.handle(new Request(url(baseDir)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ loops: [] });
  });

  test("debug dir with loops → 200 + ascending entries", async () => {
    const baseDir = await makeWorld();
    const dir = debugDirFor(baseDir);
    await mkdir(dir, { recursive: true });
    const meta = {
      threadId: THREAD_ID,
      loopIndex: 1,
      startedAt: 1,
      finishedAt: 2,
      latencyMs: 1,
      messageCount: 1,
      toolCount: 1,
      toolCallCount: 0,
      contextBytes: 10,
      resultTextBytes: 5,
      status: "ok",
    };
    await writeFile(join(dir, "loop_0001.meta.json"), JSON.stringify(meta));
    await writeFile(join(dir, "loop_0001.input.json"), JSON.stringify({}));

    const app = await makeApp(baseDir);
    const res = await app.handle(new Request(url(baseDir)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { loops: Array<{ loopIndex: number; hasInput: boolean; hasMeta: boolean; meta?: typeof meta }> };
    expect(body.loops.length).toBe(1);
    expect(body.loops[0]!.loopIndex).toBe(1);
    expect(body.loops[0]!.hasInput).toBe(true);
    expect(body.loops[0]!.hasMeta).toBe(true);
    expect(body.loops[0]!.meta?.latencyMs).toBe(1);
  });
});
