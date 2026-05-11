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
});
