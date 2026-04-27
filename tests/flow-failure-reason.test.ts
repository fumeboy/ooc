/**
 * failureReason 字段集成测试
 *
 * 验证：
 * 1. FlowData 类型包含 failureReason 字段
 * 2. 手动取消 Flow（DELETE /api/flows/:sid）后，data.json 中包含 failureReason
 * 3. GET /api/flows 列表接口在 session 摘要中透传 failureReason
 *
 * @ref src/types/flow.ts — FlowData.failureReason
 * @ref src/server/server.ts — DELETE /api/flows/:sid, GET /api/flows
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { handleRoute } from "../src/server/server.js";
import { World } from "../src/world/world.js";
import { createProcess } from "../src/storable/thread/process-compat.js";
import type { FlowData } from "../src/types/flow.js";
import type { LLMConfig } from "../src/thinkable/config.js";

const TEST_DIR = join(import.meta.dir, ".tmp_flow_failure_reason_test");

const TEST_LLM_CONFIG: LLMConfig = {
  provider: "openai-compatible",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "test-model",
  maxTokens: 1024,
  timeout: 5,
  thinking: { enabled: false },
};

/** 创建一个最小可用的 running 状态 FlowData，写入 data.json */
function createRunningFlow(flowsDir: string, sessionId: string, objectName: string): string {
  const sessionDir = join(flowsDir, sessionId);
  const objectDir = join(sessionDir, "objects", objectName);
  mkdirSync(objectDir, { recursive: true });

  const flow: FlowData = {
    sessionId,
    stoneName: objectName,
    status: "running",
    messages: [],
    process: createProcess("task"),
    data: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  writeFileSync(join(sessionDir, ".session.json"), JSON.stringify({ title: "测试会话" }));
  writeFileSync(join(objectDir, "data.json"), JSON.stringify(flow, null, 2));

  return objectDir;
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("FlowData.failureReason 类型存在性", () => {
  test("FlowData 接口接受 failureReason 字段（类型层验证）", () => {
    const flow: FlowData = {
      sessionId: "s_test",
      stoneName: "user",
      status: "failed",
      messages: [],
      process: createProcess("task"),
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      failureReason: "用户取消",
    };
    expect(flow.failureReason).toBe("用户取消");
  });

  test("FlowData 的 failureReason 字段可以为 undefined（可选字段）", () => {
    const flow: FlowData = {
      sessionId: "s_test2",
      stoneName: "user",
      status: "finished",
      messages: [],
      process: createProcess("task"),
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(flow.failureReason).toBeUndefined();
  });
});

describe("DELETE /api/flows/:sid — 手动取消后包含 failureReason", () => {
  test("取消 running 状态的 flow 后，data.json 中 failureReason 为 '用户取消'", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_cancel_test";
    const objectDir = createRunningFlow(world.flowsDir, sid, "user");

    const req = new Request(`http://test/api/flows/${sid}`, { method: "DELETE" });
    const res = await handleRoute("DELETE", `/api/flows/${sid}`, req, world);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { cancelled: number } };
    expect(body.success).toBe(true);
    expect(body.data.cancelled).toBeGreaterThan(0);

    /* 读取 data.json 验证 failureReason 已设置 */
    const raw = readFileSync(join(objectDir, "data.json"), "utf-8");
    const saved = JSON.parse(raw) as FlowData;
    expect(saved.status).toBe("failed");
    expect(saved.failureReason).toBe("用户取消");
  });

  test("取消多个对象的 flow 后，每个 data.json 都包含 failureReason", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_cancel_multi";
    const dir1 = createRunningFlow(world.flowsDir, sid, "user");
    const dir2 = createRunningFlow(world.flowsDir, sid, "assistant");

    const req = new Request(`http://test/api/flows/${sid}`, { method: "DELETE" });
    const res = await handleRoute("DELETE", `/api/flows/${sid}`, req, world);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { cancelled: number } };
    expect(body.data.cancelled).toBe(2);

    for (const dir of [dir1, dir2]) {
      const saved = JSON.parse(readFileSync(join(dir, "data.json"), "utf-8")) as FlowData;
      expect(saved.status).toBe("failed");
      expect(typeof saved.failureReason).toBe("string");
      expect(saved.failureReason!.length).toBeGreaterThan(0);
    }
  });
});

describe("GET /api/flows — session 列表中透传 failureReason", () => {
  test("失败 flow 的 failureReason 出现在 sessions 列表中", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_failed_list_test";
    const objectDir = createRunningFlow(world.flowsDir, sid, "user");

    /* 先取消，让 failureReason 写入 data.json */
    const cancelReq = new Request(`http://test/api/flows/${sid}`, { method: "DELETE" });
    await handleRoute("DELETE", `/api/flows/${sid}`, cancelReq, world);

    /* 获取 sessions 列表 */
    const listReq = new Request("http://test/api/flows");
    const listRes = await handleRoute("GET", "/api/flows", listReq, world);

    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as {
      success: boolean;
      data: {
        sessions: Array<{
          sessionId: string;
          status: string;
          failureReason?: string;
        }>;
      };
    };

    const session = listBody.data.sessions.find((s) => s.sessionId === sid);
    expect(session).toBeDefined();
    expect(session!.status).toBe("failed");
    expect(session!.failureReason).toBe("用户取消");

    /* 防止 objectDir 被 lint 为 unused */
    expect(objectDir).toBeTruthy();
  });

  test("非失败 flow 的 failureReason 不出现（或为 undefined/null）", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_running_no_reason";
    createRunningFlow(world.flowsDir, sid, "user");

    const listReq = new Request("http://test/api/flows");
    const listRes = await handleRoute("GET", "/api/flows", listReq, world);

    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as {
      success: boolean;
      data: { sessions: Array<{ sessionId: string; failureReason?: string }> };
    };

    const session = listBody.data.sessions.find((s) => s.sessionId === sid);
    expect(session).toBeDefined();
    expect(session!.failureReason == null).toBe(true);
  });
});
