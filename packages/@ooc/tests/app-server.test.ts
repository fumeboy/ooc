/**
 * HTTP app server smoke test —— 验证 health / runtime endpoints。
 */
import { describe, it, expect } from "bun:test";
import { buildServer } from "@ooc/core/app/server";

const app = buildServer({ baseDir: "/tmp/test-world" });

describe("app server", () => {
  it("GET /health returns ok", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /api/runtime/threads creates thread", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/runtime/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "app-test-s1",
          calleeObjectId: "_builtin/supervisor",
          message: "hi",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threadId: string; sessionId: string };
    expect(body.sessionId).toBe("app-test-s1");
    expect(body.threadId).toMatch(/^thread_/);
  });

  it("GET /api/runtime/threads/:sessionId lists threads", async () => {
    // first create one
    await app.handle(
      new Request("http://localhost/api/runtime/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "app-test-s2",
          calleeObjectId: "_builtin/supervisor",
        }),
      }),
    );
    const res = await app.handle(new Request("http://localhost/api/runtime/threads/app-test-s2"));
    const body = (await res.json()) as { threads: Array<{ id: string }> };
    expect(body.threads.length).toBeGreaterThan(0);
  });
});
