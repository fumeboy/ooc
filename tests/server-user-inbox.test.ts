/**
 * GET /api/sessions/:sid/user-inbox endpoint 集成测试
 *
 * 直接调 handleRoute（已 export），无需真起 Bun.serve。
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { handleRoute } from "../src/server/server.js";
import { appendUserInbox } from "../src/storable/inbox/user-inbox.js";
import { World } from "../src/world/world.js";
import type { LLMConfig } from "../src/thinkable/config.js";

const TEST_DIR = join(import.meta.dir, ".tmp_server_user_inbox_test");

const TEST_LLM_CONFIG: LLMConfig = {
  provider: "openai-compatible",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "test-model",
  maxTokens: 1024,
  timeout: 5,
};

type UserInboxBody = {
  success: boolean;
  data: {
    inbox: Array<{ threadId: string; messageId: string }>;
    readState: { lastReadTimestampByObject: Record<string, number> };
  };
};

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("GET /api/sessions/:sid/user-inbox", () => {
  test("session 不存在时返回空 inbox + 空 readState", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const req = new Request("http://test/api/sessions/s_nonexistent/user-inbox");
    const res = await handleRoute("GET", "/api/sessions/s_nonexistent/user-inbox", req, world);

    expect(res.status).toBe(200);
    const body = await res.json() as UserInboxBody;
    expect(body.success).toBe(true);
    expect(body.data.inbox).toEqual([]);
    expect(body.data.readState).toEqual({ lastReadTimestampByObject: {} });
  });

  test("预先写入 inbox 后能被 endpoint 读取", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_preloaded";
    await appendUserInbox(world.flowsDir, sid, "th_a", "msg_1");
    await appendUserInbox(world.flowsDir, sid, "th_a", "msg_2");
    await appendUserInbox(world.flowsDir, sid, "th_b", "msg_3");

    const req = new Request(`http://test/api/sessions/${sid}/user-inbox`);
    const res = await handleRoute("GET", `/api/sessions/${sid}/user-inbox`, req, world);

    expect(res.status).toBe(200);
    const body = await res.json() as UserInboxBody;
    expect(body.success).toBe(true);
    expect(body.data.inbox).toEqual([
      { threadId: "th_a", messageId: "msg_1" },
      { threadId: "th_a", messageId: "msg_2" },
      { threadId: "th_b", messageId: "msg_3" },
    ]);
  });

  test("返回值结构符合 ApiResponse<UserInboxData> 契约", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_structure_test";
    await appendUserInbox(world.flowsDir, sid, "t1", "m1");

    const req = new Request(`http://test/api/sessions/${sid}/user-inbox`);
    const res = await handleRoute("GET", `/api/sessions/${sid}/user-inbox`, req, world);
    const body = await res.json() as { success: boolean; data: { inbox: Array<{ threadId: string; messageId: string }> } };

    /* 顶层：success + data */
    expect(body).toHaveProperty("success", true);
    expect(body).toHaveProperty("data");
    /* data 层：inbox 数组 */
    expect(body.data).toHaveProperty("inbox");
    expect(Array.isArray(body.data.inbox)).toBe(true);
    /* 条目结构 */
    const entry = body.data.inbox[0];
    expect(entry).toHaveProperty("threadId", "t1");
    expect(entry).toHaveProperty("messageId", "m1");
  });
});

describe("POST /api/sessions/:sid/user-read-state", () => {
  test("合法 payload 更新 readState 并反映在后续 GET 中", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_read_state_set";
    const req = new Request(`http://test/api/sessions/${sid}/user-read-state`, {
      method: "POST",
      body: JSON.stringify({ objectName: "bruce", timestamp: 1234 }),
      headers: { "content-type": "application/json" },
    });
    const res = await handleRoute("POST", `/api/sessions/${sid}/user-read-state`, req, world);
    expect(res.status).toBe(200);
    const body = await res.json() as UserInboxBody;
    expect(body.success).toBe(true);
    expect(body.data.readState).toEqual({ lastReadTimestampByObject: { bruce: 1234 } });

    /* GET 也能读到 */
    const getReq = new Request(`http://test/api/sessions/${sid}/user-inbox`);
    const getRes = await handleRoute("GET", `/api/sessions/${sid}/user-inbox`, getReq, world);
    const getBody = await getRes.json() as UserInboxBody;
    expect(getBody.data.readState).toEqual({ lastReadTimestampByObject: { bruce: 1234 } });
  });

  test("旧 timestamp 被忽略（单调递增）", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_read_state_mono";
    for (const ts of [3000, 2000, 1500, 2500]) {
      const req = new Request(`http://test/api/sessions/${sid}/user-read-state`, {
        method: "POST",
        body: JSON.stringify({ objectName: "iris", timestamp: ts }),
        headers: { "content-type": "application/json" },
      });
      await handleRoute("POST", `/api/sessions/${sid}/user-read-state`, req, world);
    }

    const getReq = new Request(`http://test/api/sessions/${sid}/user-inbox`);
    const getRes = await handleRoute("GET", `/api/sessions/${sid}/user-inbox`, getReq, world);
    const getBody = await getRes.json() as UserInboxBody;
    /* 最大值 3000 胜出 */
    expect(getBody.data.readState).toEqual({ lastReadTimestampByObject: { iris: 3000 } });
  });

  test("缺字段返回 400", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_bad_payload";

    /* 缺 objectName */
    let req = new Request(`http://test/api/sessions/${sid}/user-read-state`, {
      method: "POST",
      body: JSON.stringify({ timestamp: 123 }),
      headers: { "content-type": "application/json" },
    });
    let res = await handleRoute("POST", `/api/sessions/${sid}/user-read-state`, req, world);
    expect(res.status).toBe(400);

    /* 缺 timestamp */
    req = new Request(`http://test/api/sessions/${sid}/user-read-state`, {
      method: "POST",
      body: JSON.stringify({ objectName: "bruce" }),
      headers: { "content-type": "application/json" },
    });
    res = await handleRoute("POST", `/api/sessions/${sid}/user-read-state`, req, world);
    expect(res.status).toBe(400);

    /* 非 JSON */
    req = new Request(`http://test/api/sessions/${sid}/user-read-state`, {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    res = await handleRoute("POST", `/api/sessions/${sid}/user-read-state`, req, world);
    expect(res.status).toBe(400);
  });
});
