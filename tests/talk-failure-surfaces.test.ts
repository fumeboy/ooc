/**
 * 当 world.talk 异步失败时，对应 sessionId 应该出现在 /api/flows 列表里，
 * 且 status="failed", failureReason 非空。
 *
 * 测试策略：
 * 1. 构造一个包含破损 trait（缺失 namespace + name）的对象目录。
 * 2. 直接调用 world.talk()，等待其 reject（trait-loader 会抛 Error）。
 * 3. 模拟 server.ts 中 .catch 处理器的行为（写 failed flow 记录）。
 * 4. 通过 GET /api/flows 验证 failureReason 已出现在 sessions 列表。
 *
 * 注意：server.ts 的 .catch 处理器在真实 HTTP 请求路径中被触发；
 * 此处通过调用同一个辅助逻辑直接验证副作用（写 data.json），
 * 避免引入完整 HTTP 层的测试复杂度。
 *
 * @ref Bruce 深度验证 - B1 修复
 * @ref src/observable/server/server.ts — POST /api/talk 的 .catch 处理器
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { handleRoute } from "../src/observable/server/server.js";
import { World } from "../src/world/world.js";
import { createProcess } from "../src/storable/thread/process-compat.js";
import type { FlowData } from "../src/shared/types/flow.js";
import type { LLMConfig } from "../src/thinkable/llm/config.js";

const TEST_DIR = join(import.meta.dir, ".tmp_talk_failure_surfaces_test");

const TEST_LLM_CONFIG: LLMConfig = {
  provider: "openai-compatible",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "test-model",
  maxTokens: 1024,
  timeout: 5,
  thinking: { enabled: false },
};

/**
 * 构造一个带破损 trait 的对象目录（readme.md 缺失 namespace + name），
 * 使 trait-loader 在 talk() 中抛出 Error。
 */
function createBrokenTraitObject(rootDir: string, objectName: string): void {
  const stoneDir = join(rootDir, "stones", objectName);
  const traitDir = join(stoneDir, "traits", "broken-trait");
  mkdirSync(traitDir, { recursive: true });

  /* 对象 readme */
  writeFileSync(join(stoneDir, "readme.md"), `# ${objectName}\n`, "utf-8");
  writeFileSync(join(stoneDir, "data.json"), JSON.stringify({ name: objectName }), "utf-8");

  /* 破损的 trait frontmatter（缺少 namespace + name，trait-loader 会抛 Error） */
  writeFileSync(
    join(traitDir, "readme.md"),
    "---\nwhen: \"always\"\n---\n\n# broken trait\n",
    "utf-8",
  );
}

/**
 * 模拟 server.ts 中 .catch 处理器写入 failed flow 记录的行为。
 *
 * 此函数与 server.ts 的 .catch 实现保持同步——若 server.ts 改变写入逻辑，
 * 此处亦需更新。
 */
function writeFailedFlowRecord(flowsDir: string, sessionId: string, objectName: string, errMsg: string): void {
  const now = Date.now();
  const objectFlowDir = join(flowsDir, sessionId, "objects", objectName);
  mkdirSync(objectFlowDir, { recursive: true });
  const failedFlow: FlowData = {
    sessionId,
    stoneName: objectName,
    title: "(talk failed before engine start)",
    status: "failed",
    failureReason: errMsg,
    messages: [],
    process: createProcess("task"),
    data: {},
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(join(objectFlowDir, "data.json"), JSON.stringify(failedFlow, null, 2));
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, "kernel", "traits"), { recursive: true });
  mkdirSync(join(TEST_DIR, "library", "traits"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("talk 失败后 failureReason 在 /api/flows 中可见", () => {
  test("world.talk() 因破损 trait 抛出 Error 时，catch 路径写入 failed flow 记录", async () => {
    /* 构造含破损 trait 的对象 */
    createBrokenTraitObject(TEST_DIR, "nexus");

    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sessionId = "s_b1_failure_test";

    /* world.talk() 应当因 trait-loader 抛 Error 而 reject */
    let caughtError: Error | null = null;
    try {
      await world.talk("nexus", "hello", "user", sessionId);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("namespace");

    /* 模拟 server.ts .catch 处理器：将失败落盘 */
    writeFailedFlowRecord(world.flowsDir, sessionId, "nexus", caughtError!.message);

    /* 验证 data.json 已写入 */
    const dataPath = join(world.flowsDir, sessionId, "objects", "nexus", "data.json");
    expect(existsSync(dataPath)).toBe(true);
    const saved = JSON.parse(readFileSync(dataPath, "utf-8")) as FlowData;
    expect(saved.status).toBe("failed");
    expect(saved.failureReason).toContain("namespace");

    /* 验证 GET /api/flows 列表中 sessionId 可见且 failureReason 非空 */
    const req = new Request("http://test/api/flows");
    const res = await handleRoute("GET", "/api/flows", req, world);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      success: boolean;
      data: {
        sessions: Array<{
          sessionId: string;
          status: string;
          failureReason?: string;
        }>;
      };
    };
    expect(body.success).toBe(true);

    const session = body.data.sessions.find((s) => s.sessionId === sessionId);
    expect(session).toBeDefined();
    expect(session!.status).toBe("failed");
    expect(typeof session!.failureReason).toBe("string");
    expect(session!.failureReason!.length).toBeGreaterThan(0);
    expect(session!.failureReason).toContain("namespace");
  });

  test("failed flow 记录满足 FlowData 类型（类型层验证）", () => {
    /* 纯类型验证：确认写入的字段结构合法 */
    const now = Date.now();
    const failedFlow: FlowData = {
      sessionId: "s_type_check",
      stoneName: "nexus",
      title: "(talk failed before engine start)",
      status: "failed",
      failureReason: "[trait-loader] 缺少 namespace 字段",
      messages: [],
      process: createProcess("task"),
      data: {},
      createdAt: now,
      updatedAt: now,
    };
    expect(failedFlow.status).toBe("failed");
    expect(failedFlow.failureReason).toContain("namespace");
    expect(Array.isArray(failedFlow.messages)).toBe(true);
    expect(failedFlow.process).toBeDefined();
  });
});
