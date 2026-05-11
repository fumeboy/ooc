import { describe, expect, test } from "bun:test";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

describe("app server", () => {
  test("responds to GET /api/health", async () => {
    const app = buildServer({
      ...readServerConfig(),
      port: 0,
      baseDir: "/tmp/ooc-app-test",
      workerPollMs: 100,
      workerEnabled: false,
    });

    const response = await app.handle(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("ooc-app-server");
  });
});
