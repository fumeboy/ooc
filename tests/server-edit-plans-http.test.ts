/**
 * Edit Plans HTTP endpoints 集成测试
 *
 * 覆盖三个路由：
 *   GET    /api/flows/:sid/edit-plans/:planId          — 详情（带 preview）
 *   POST   /api/flows/:sid/edit-plans/:planId/apply    — 应用事务（透传 threadId）
 *   POST   /api/flows/:sid/edit-plans/:planId/cancel   — 取消 pending plan
 *
 * 直接调用 handleRoute，无需真起 Bun.serve。
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_edit_plans_http_ui.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { handleRoute } from "../src/server/server.js";
import { World } from "../src/world/world.js";
import { createEditPlan } from "../src/persistence/edit-plans.js";
import type { LLMConfig } from "../src/thinkable/config.js";

const TEST_DIR = join(import.meta.dir, ".tmp_server_edit_plans_http_test");

const TEST_LLM_CONFIG: LLMConfig = {
  provider: "openai-compatible",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "test-model",
  maxTokens: 1024,
  timeout: 5,
};

type ApiBody<T = any> = {
  success: boolean;
  data: T;
};

/** 构造一个带两个源文件的 session，返回 world + sessionId */
async function setupWorldWithFixture(): Promise<{ world: World; sid: string }> {
  const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
  world.init();
  const sid = "s_edit_plan_http";
  /* 为可观测 apply 行为，在 rootDir 下种两个源文件 */
  mkdirSync(join(TEST_DIR, "src"), { recursive: true });
  writeFileSync(join(TEST_DIR, "src", "a.ts"), "export const A = 1;\nexport const B = 2;\n", "utf-8");
  writeFileSync(join(TEST_DIR, "src", "b.ts"), "export const C = 3;\n", "utf-8");
  return { world, sid };
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("GET /api/flows/:sid/edit-plans/:planId", () => {
  test("返回 plan 详情 + preview", async () => {
    const { world, sid } = await setupWorldWithFixture();
    const plan = await createEditPlan({
      rootDir: TEST_DIR,
      sessionId: sid,
      flowsRoot: world.flowsDir,
      changes: [
        { kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 100" },
        { kind: "write", path: "src/new.ts", newContent: "export const N = 9;\n" },
      ],
    });

    const path = `/api/flows/${sid}/edit-plans/${plan.planId}`;
    const req = new Request(`http://test${path}`);
    const res = await handleRoute("GET", path, req, world);

    expect(res.status).toBe(200);
    const body = await res.json() as ApiBody;
    expect(body.success).toBe(true);
    expect(body.data.plan.planId).toBe(plan.planId);
    expect(body.data.plan.status).toBe("pending");
    expect(body.data.plan.changes.length).toBe(2);
    /* preview 形如 unified diff */
    expect(typeof body.data.preview).toBe("string");
    expect(body.data.preview).toContain("--- a/src/a.ts");
    expect(body.data.preview).toContain("+ A = 100");
  });

  test("plan 不存在返回 404", async () => {
    const { world, sid } = await setupWorldWithFixture();
    const path = `/api/flows/${sid}/edit-plans/ep_not_exist`;
    const req = new Request(`http://test${path}`);
    const res = await handleRoute("GET", path, req, world);
    expect(res.status).toBe(404);
    const body = await res.json() as ApiBody;
    expect(body.success).toBe(false);
  });
});

describe("POST /api/flows/:sid/edit-plans/:planId/apply", () => {
  test("pending plan 应用后写盘 + 状态变 applied", async () => {
    const { world, sid } = await setupWorldWithFixture();
    const plan = await createEditPlan({
      rootDir: TEST_DIR,
      sessionId: sid,
      flowsRoot: world.flowsDir,
      changes: [
        { kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 100" },
      ],
    });

    const path = `/api/flows/${sid}/edit-plans/${plan.planId}/apply`;
    const req = new Request(`http://test${path}`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const res = await handleRoute("POST", path, req, world);

    expect(res.status).toBe(200);
    const body = await res.json() as ApiBody;
    expect(body.success).toBe(true);
    expect(body.data.result.ok).toBe(true);
    expect(body.data.result.applied).toBe(1);
    expect(body.data.plan.status).toBe("applied");

    /* 文件确实改了 */
    const content = readFileSync(join(TEST_DIR, "src", "a.ts"), "utf-8");
    expect(content).toContain("A = 100");
  });

  test("apply 透传 threadId 不报错（feedback 落 bucket 由 edit-plans.ts 处理）", async () => {
    const { world, sid } = await setupWorldWithFixture();
    const plan = await createEditPlan({
      rootDir: TEST_DIR,
      sessionId: sid,
      flowsRoot: world.flowsDir,
      changes: [{ kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 7" }],
    });

    const path = `/api/flows/${sid}/edit-plans/${plan.planId}/apply`;
    const req = new Request(`http://test${path}`, {
      method: "POST",
      body: JSON.stringify({ threadId: "th_demo_123" }),
      headers: { "content-type": "application/json" },
    });
    const res = await handleRoute("POST", path, req, world);

    expect(res.status).toBe(200);
    const body = await res.json() as ApiBody;
    expect(body.success).toBe(true);
    expect(body.data.result.ok).toBe(true);
  });

  test("plan 不存在返回 404", async () => {
    const { world, sid } = await setupWorldWithFixture();
    const path = `/api/flows/${sid}/edit-plans/ep_not_exist/apply`;
    const req = new Request(`http://test${path}`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const res = await handleRoute("POST", path, req, world);
    expect(res.status).toBe(404);
  });

  test("非 pending plan 重复 apply 返回 409", async () => {
    const { world, sid } = await setupWorldWithFixture();
    const plan = await createEditPlan({
      rootDir: TEST_DIR,
      sessionId: sid,
      flowsRoot: world.flowsDir,
      changes: [{ kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 100" }],
    });
    const path = `/api/flows/${sid}/edit-plans/${plan.planId}/apply`;

    /* 第一次：成功 */
    const req1 = new Request(`http://test${path}`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const res1 = await handleRoute("POST", path, req1, world);
    expect(res1.status).toBe(200);

    /* 第二次：plan 已 applied，拒绝 */
    const req2 = new Request(`http://test${path}`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const res2 = await handleRoute("POST", path, req2, world);
    expect(res2.status).toBe(409);
  });
});

describe("POST /api/flows/:sid/edit-plans/:planId/cancel", () => {
  test("pending plan 取消成功", async () => {
    const { world, sid } = await setupWorldWithFixture();
    const plan = await createEditPlan({
      rootDir: TEST_DIR,
      sessionId: sid,
      flowsRoot: world.flowsDir,
      changes: [{ kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 100" }],
    });

    const path = `/api/flows/${sid}/edit-plans/${plan.planId}/cancel`;
    const req = new Request(`http://test${path}`, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    const res = await handleRoute("POST", path, req, world);

    expect(res.status).toBe(200);
    const body = await res.json() as ApiBody;
    expect(body.success).toBe(true);
    expect(body.data.plan.status).toBe("cancelled");
  });

  test("plan 不存在返回 404", async () => {
    const { world, sid } = await setupWorldWithFixture();
    const path = `/api/flows/${sid}/edit-plans/ep_not_exist/cancel`;
    const req = new Request(`http://test${path}`, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    const res = await handleRoute("POST", path, req, world);
    expect(res.status).toBe(404);
  });
});
