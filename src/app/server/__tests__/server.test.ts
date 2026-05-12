import { describe, expect, test } from "bun:test";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

describe("app server", () => {
  test("readServerConfig uses explicit world cli arg before env base dir", () => {
    const config = readServerConfig({
      env: {
        OOC_APP_PORT: "3001",
        OOC_BASE_DIR: "/tmp/from-env",
        OOC_WORKER_ENABLED: "0",
      },
      argv: ["bun", "src/app/server/index.ts", "--world", "/tmp/from-cli"],
    });

    expect(config.port).toBe(3001);
    expect(config.baseDir).toBe("/tmp/from-cli");
    expect(config.workerEnabled).toBe(false);
  });

  test("readServerConfig supports equals form for world dir", () => {
    const config = readServerConfig({
      env: {},
      argv: ["bun", "src/app/server/index.ts", "--world-dir=/tmp/ooc-world-equals"],
    });

    expect(config.baseDir).toBe("/tmp/ooc-world-equals");
  });

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
