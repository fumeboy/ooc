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
import { appendUserInbox } from "../src/persistence/user-inbox.js";
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

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("GET /api/sessions/:sid/user-inbox", () => {
  test("session 不存在时返回 { inbox: [] }", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const req = new Request("http://test/api/sessions/s_nonexistent/user-inbox");
    const res = await handleRoute("GET", "/api/sessions/s_nonexistent/user-inbox", req, world);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { inbox: [] } });
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
    const body = await res.json();
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
