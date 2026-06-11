import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

/**
 * backend API 一致性回归测试。
 * 覆盖 4 类问题:
 * - silent-fabricate(GET 不存在资源返回 200 + 空)
 * - 错误 shape 不统一
 * - URL 命名(/api/sessions 别名 + /api/flows deprecation header)
 * - PUT 覆盖性写无护栏(X-Overwrite-Confirm 强制)
 */

async function makeApp() {
  const baseDir = mkdtempSync(join(tmpdir(), "ooc-issue-6-"));
  await ensureStoneRepo({ baseDir });
  const app = buildServer({
    ...(await readServerConfig()),
    port: 0,
    baseDir,
    workerPollMs: 5,
    workerEnabled: false,
  });
  return { app, baseDir };
}

describe("silent-fabricate", () => {
  test("GET /api/stones/<nonexistent>/self → 404 NOT_FOUND", async () => {
    const { app } = await makeApp();
    const res = await app.handle(new Request("http://localhost/api/stones/_test_no_such_obj/self"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("_test_no_such_obj");
  });

  test("GET /api/stones/<nonexistent>/readme → 404 NOT_FOUND", async () => {
    const { app } = await makeApp();
    const res = await app.handle(new Request("http://localhost/api/stones/_test_no_such_obj/readme"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("GET /api/stones/<nonexistent>/server-source → 404", async () => {
    const { app } = await makeApp();
    const res = await app.handle(new Request("http://localhost/api/stones/_test_no_such_obj/server-source"));
    expect(res.status).toBe(404);
  });

  test("GET /api/stones/<nonexistent> (root) → 404", async () => {
    const { app } = await makeApp();
    const res = await app.handle(new Request("http://localhost/api/stones/_test_no_such_obj"));
    expect(res.status).toBe(404);
  });

  test("GET /api/flows/<nonexistent_sid>/threads → 404", async () => {
    const { app } = await makeApp();
    const res = await app.handle(new Request("http://localhost/api/flows/_test_no_such_session/threads"));
    expect(res.status).toBe(404);
  });

  test("seed session 后 list threads 返回非空（flows/<sid>/<obj>/ flat 布局，非 objects/）", async () => {
    // listThreads 曾按 flows/<sid>/objects/ 布局扫描，
    // 但实际 objectDir = flows/<sid>/<nestedObjectPath>（无 objects/ 段）→ list 端点恒返回空。
    const { app } = await makeApp();
    await app.handle(new Request("http://localhost/api/stones", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectId: "assistant", self: "# A" }),
    }));
    const seed = await app.handle(new Request("http://localhost/api/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "_test_x1_list", targetObjectId: "assistant", initialMessage: "hi" }),
    }));
    expect(seed.status).toBe(200);
    const res = await app.handle(new Request("http://localhost/api/flows/_test_x1_list/threads"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((t: { objectId: string }) => t.objectId === "assistant")).toBe(true);
  });

  test("GET /api/stones (list) 父目录不存在仍返回 200 + []", async () => {
    const { app } = await makeApp();
    const res = await app.handle(new Request("http://localhost/api/stones"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  test("GET /api/flows (list) 父目录不存在仍返回 200 + []", async () => {
    const { app } = await makeApp();
    const res = await app.handle(new Request("http://localhost/api/flows"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
});

describe("错误 shape 统一为 { error: { code, message, details } }", () => {
  test("404 (not found) 返回 JSON shape", async () => {
    const { app } = await makeApp();
    const res = await app.handle(new Request("http://localhost/api/stones/_test_no_such/self"));
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toHaveProperty("error.code");
    expect(body).toHaveProperty("error.message");
    expect(body).toHaveProperty("error.details");
  });

  test("422 (schema validation) 返回相同 shape", async () => {
    const { app } = await makeApp();
    // POST /api/stones with malformed body 触发 schema validation 失败
    // (createStone schema 要求 objectId 是合法字符串;给 number 会触发 422)
    const res = await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: 12345 }),
      })
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(typeof body.error.message).toBe("string");
  });

  test("AppServerError NOT_FOUND 不再是裸 text", async () => {
    const { app } = await makeApp();
    // 用 /api/stones/<nonexistent>/self 触发 NOT_FOUND（替代已下线的 issue 路由）
    const res = await app.handle(new Request("http://localhost/api/stones/_no_such_stone/self"));
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("URL 命名 — /api/sessions alias + deprecation", () => {
  test("GET /api/sessions 与 GET /api/flows 返回相同形状", async () => {
    const { app } = await makeApp();
    await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "_test_alias_sess", title: "alias" }),
      })
    );
    const sessRes = await app.handle(new Request("http://localhost/api/sessions"));
    expect(sessRes.status).toBe(200);
    const sessBody = await sessRes.json();
    expect(sessBody.items.length).toBe(1);
    expect(sessBody.items[0].sessionId).toBe("_test_alias_sess");

    const flowsRes = await app.handle(new Request("http://localhost/api/flows"));
    expect(flowsRes.status).toBe(200);
    expect(flowsRes.headers.get("x-deprecated")).toContain("deprecated");
    const flowsBody = await flowsRes.json();
    expect(flowsBody.items[0].sessionId).toBe("_test_alias_sess");
  });
});

describe("PUT 覆盖性写无护栏", () => {
  test("PUT self 首次写入(目标不存在)不需要 confirm header", async () => {
    const { app } = await makeApp();
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "_test_executable_target_1" }),
      })
    );
    // 第一次 PUT,无 confirm,允许
    const first = await app.handle(
      new Request("http://localhost/api/stones/_test_executable_target_1/self", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "first content" }),
      })
    );
    expect(first.status).toBe(200);
  });

  test("PUT self 覆盖已存在文件,无 confirm → 409 OVERWRITE_REQUIRES_CONFIRM", async () => {
    const { app } = await makeApp();
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "_test_executable_target_2", self: "existing" }),
      })
    );
    // 已存在 self.md,再 PUT 没带 header — 应被拒
    const blocked = await app.handle(
      new Request("http://localhost/api/stones/_test_executable_target_2/self", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "overwrite attempt" }),
      })
    );
    expect(blocked.status).toBe(409);
    const body = await blocked.json();
    expect(body.error.code).toBe("OVERWRITE_REQUIRES_CONFIRM");
    expect(body.error.message).toContain("X-Overwrite-Confirm");

    // 带 confirm header 后允许
    const allowed = await app.handle(
      new Request("http://localhost/api/stones/_test_executable_target_2/self", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-overwrite-confirm": "true" },
        body: JSON.stringify({ text: "overwrite OK" }),
      })
    );
    expect(allowed.status).toBe(200);
  });

  test("PUT readme 同样受 confirm 护栏保护", async () => {
    const { app } = await makeApp();
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "_test_executable_target_3", readme: "v1" }),
      })
    );
    const blocked = await app.handle(
      new Request("http://localhost/api/stones/_test_executable_target_3/readme", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "v2" }),
      })
    );
    expect(blocked.status).toBe(409);
  });

  test("PUT server-source 覆盖已存在 → 409", async () => {
    const { app } = await makeApp();
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "_test_executable_target_4" }),
      })
    );
    // first PUT — 不存在,允许
    const first = await app.handle(
      new Request("http://localhost/api/stones/_test_executable_target_4/server-source", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "export const a = 1;" }),
      })
    );
    expect(first.status).toBe(200);
    // 第二次 — 没 confirm 应被拒
    const blocked = await app.handle(
      new Request("http://localhost/api/stones/_test_executable_target_4/server-source", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "export const a = 2;" }),
      })
    );
    expect(blocked.status).toBe(409);
  });

  test("PUT knowledge/files 覆盖已存在 → 409", async () => {
    const { app } = await makeApp();
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "_test_executable_target_5" }),
      })
    );
    await app.handle(
      new Request("http://localhost/api/stones/_test_executable_target_5/knowledge/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "note.md", content: "first" }),
      })
    );
    const blocked = await app.handle(
      new Request("http://localhost/api/stones/_test_executable_target_5/knowledge/files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "note.md", content: "overwrite" }),
      })
    );
    expect(blocked.status).toBe(409);
  });

  test("PUT 对不存在的 stone → 404 (ensureStoneExists 先行)", async () => {
    const { app } = await makeApp();
    const res = await app.handle(
      new Request("http://localhost/api/stones/_test_never_created/self", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "leaks should not create stone" }),
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
