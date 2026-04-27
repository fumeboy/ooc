/**
 * POST /api/sessions/:sid/issues/:id/status 与 tasks/:id/status 集成测试
 *
 * 直接调 handleRoute，无需起 Bun.serve。
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_kanban状态切换.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { handleRoute } from "../src/server/server.js";
import { createIssue, createTask } from "../src/collaborable/kanban/methods.js";
import { readIssues, readTasks } from "../src/collaborable/kanban/store.js";
import { World } from "../src/world/world.js";
import type { LLMConfig } from "../src/thinkable/config.js";

const TEST_DIR = join(import.meta.dir, ".tmp_server_kanban_status_test");

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
 * 预创建 session 目录骨架（模拟 /api/sessions/create 的产物），
 * 再调 createIssue / createTask 写入数据。
 */
async function prepareSession(world: World, sessionId: string): Promise<string> {
  const sessionDir = join(world.flowsDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, ".session.json"), JSON.stringify({ title: "" }));
  return sessionDir;
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("POST /api/sessions/:sid/issues/:id/status", () => {
  test("合法 status 切换后持久化落盘", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_issue_ok";
    const sessionDir = await prepareSession(world, sid);
    const issue = await createIssue(sessionDir, "Test Issue");
    expect(issue.status).toBe("discussing");

    const req = new Request(
      `http://test/api/sessions/${sid}/issues/${issue.id}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "executing" }),
      },
    );
    const res = await handleRoute(
      "POST", `/api/sessions/${sid}/issues/${issue.id}/status`, req, world,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { id: string; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(issue.id);
    expect(body.data.status).toBe("executing");

    /* 确认持久化 */
    const issues = await readIssues(sessionDir);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.status).toBe("executing");
  });

  test("非法 status 返回 400", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_issue_bad";
    const sessionDir = await prepareSession(world, sid);
    await createIssue(sessionDir, "Test");

    const req = new Request(
      `http://test/api/sessions/${sid}/issues/issue-001/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "not-a-status" }),
      },
    );
    const res = await handleRoute(
      "POST", `/api/sessions/${sid}/issues/issue-001/status`, req, world,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("非法 status");
  });

  test("未知 issueId 返回 404", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_issue_missing";
    await prepareSession(world, sid);

    const req = new Request(
      `http://test/api/sessions/${sid}/issues/issue-999/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      },
    );
    const res = await handleRoute(
      "POST", `/api/sessions/${sid}/issues/issue-999/status`, req, world,
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  test("session 不存在返回 404", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const req = new Request(
      `http://test/api/sessions/s_nope/issues/issue-001/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      },
    );
    const res = await handleRoute(
      "POST", `/api/sessions/s_nope/issues/issue-001/status`, req, world,
    );

    expect(res.status).toBe(404);
  });
});

describe("POST /api/sessions/:sid/tasks/:id/status", () => {
  test("合法 status 切换后持久化落盘", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_task_ok";
    const sessionDir = await prepareSession(world, sid);
    const task = await createTask(sessionDir, "Test Task");
    expect(task.status).toBe("running");

    const req = new Request(
      `http://test/api/sessions/${sid}/tasks/${task.id}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      },
    );
    const res = await handleRoute(
      "POST", `/api/sessions/${sid}/tasks/${task.id}/status`, req, world,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { id: string; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(task.id);
    expect(body.data.status).toBe("done");

    const tasks = await readTasks(sessionDir);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe("done");
  });

  test("非法 status 返回 400", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_task_bad";
    const sessionDir = await prepareSession(world, sid);
    await createTask(sessionDir, "Test");

    const req = new Request(
      `http://test/api/sessions/${sid}/tasks/task-001/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "designing" }), // Issue 状态，不是 Task 的
      },
    );
    const res = await handleRoute(
      "POST", `/api/sessions/${sid}/tasks/task-001/status`, req, world,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("非法 status");
  });

  test("未知 taskId 返回 404", async () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const sid = "s_task_missing";
    await prepareSession(world, sid);

    const req = new Request(
      `http://test/api/sessions/${sid}/tasks/task-999/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      },
    );
    const res = await handleRoute(
      "POST", `/api/sessions/${sid}/tasks/task-999/status`, req, world,
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });
});
