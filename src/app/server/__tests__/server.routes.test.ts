import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

function makeApp() {
  const baseDir = mkdtempSync(join(tmpdir(), "ooc-app-server-routes-"));
  return buildServer({
    ...readServerConfig(),
    port: 0,
    baseDir,
    workerPollMs: 5,
    workerEnabled: false,
  });
}

describe("app server routes", () => {
  test("GET /api/health returns ok", async () => {
    const app = makeApp();
    const response = await app.handle(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("ooc-app-server");
  });

  test("GET /debug/chat.html returns the debug chat page", async () => {
    const app = makeApp();
    const response = await app.handle(new Request("http://localhost/debug/chat.html"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("OOC Debug Chat");
    expect(html).toContain("Create Object");
    expect(html).toContain("Create Session");
    expect(html).toContain("Process Events");
    expect(html).toContain("Thread Context");
    expect(html).toContain("Auto refresh");
    expect(html).toContain("autoRefresh");
    expect(html).toContain("setInterval");
    expect(html).toContain("threadStatus");
    expect(html).toContain("/api/stones");
    expect(html).toContain("/api/flows/");
    expect(html).toContain("/threads/root/continue");
    expect(html).toContain("/api/runtime/jobs/");
  });

  test("GET /api/stones lists created objects for debug UI selection", async () => {
    const app = makeApp();
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "debug-object-a" }),
      })
    );
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "debug-object-b" }),
      })
    );

    const response = await app.handle(new Request("http://localhost/api/stones"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((item: { objectId: string }) => item.objectId)).toEqual([
      "debug-object-a",
      "debug-object-b",
    ]);
  });

  test("POST /api/stones rejects invalid body", async () => {
    const app = makeApp();
    const response = await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(422);
  });

  test("POST /api/flows creates session", async () => {
    const app = makeApp();
    const response = await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-routes", title: "Routes Session" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe("session-routes");
    expect(body.created).toBe(true);
  });

  test("POST /api/stones/:id/call_method returns 404 for missing method", async () => {
    const app = makeApp();
    // 先创建一个 stone（不写任何 ui_methods）
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "stone-no-methods" }),
      })
    );
    const response = await app.handle(
      new Request("http://localhost/api/stones/stone-no-methods/call_method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "ghost", args: {} }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("METHOD_NOT_FOUND");
    expect(body.error.message).toContain("ghost");
    expect(body.error.details.objectId).toBe("stone-no-methods");
  });

  test("POST /api/flows/:sid/objects/:id/call_method returns 404 for missing method", async () => {
    const app = makeApp();
    // 先创建 stone + flow session
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "flow-no-methods" }),
      })
    );
    await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s-call", title: "S" }),
      })
    );
    await app.handle(
      new Request("http://localhost/api/flows/s-call/objects/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "flow-no-methods" }),
      })
    );
    const response = await app.handle(
      new Request(
        "http://localhost/api/flows/s-call/objects/flow-no-methods/call_method",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "ghost", args: {} }),
        }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("METHOD_NOT_FOUND");
    expect(body.error.details.objectId).toBe("flow-no-methods");
  });
});
