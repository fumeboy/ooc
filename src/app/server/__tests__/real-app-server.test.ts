import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { readThread } from "@src/persistable";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

function loadRealEnv(): void {
  const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;

    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator);
      const value = trimmed.slice(separator + 1);
      process.env[key] = value;
    }
    return;
  }
}

async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs: number, intervalMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }

  return await fn();
}

const shouldRunRealTest = process.env.RUN_REAL_APP_SERVER_TEST === "1";

describe.skipIf(!shouldRunRealTest)("real app server e2e", () => {
  it("runs a real flow through app server entry", async () => {
    loadRealEnv();
    process.env.OOC_PROVIDER = "openai";

    const baseDir = mkdtempSync(join(tmpdir(), "ooc-app-server-real-"));
    const app = buildServer({
      ...readServerConfig(),
      port: 0,
      baseDir,
      workerPollMs: 50,
      workerEnabled: true,
    });

    const createSession = await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "real-app-session", title: "Real App Session" }),
      })
    );
    expect(createSession.status).toBe(200);

    const pauseSession = await app.handle(
      new Request("http://localhost/api/flows/real-app-session/pause", {
        method: "POST",
      })
    );
    expect(pauseSession.status).toBe(200);

    const createObject = await app.handle(
      new Request("http://localhost/api/flows/real-app-session/objects/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "real-app-object" }),
      })
    );
    expect(createObject.status).toBe(200);
    const objectBody = await createObject.json();
    expect(objectBody.initialThreadId).toBe("root");
    expect(typeof objectBody.jobId).toBe("string");

    const job = await waitFor(
      async () => {
        const response = await app.handle(new Request(`http://localhost/api/runtime/jobs/${objectBody.jobId}`));
        expect(response.status).toBe(200);
        return await response.json();
      },
      (value) => value.status === "done" || value.status === "failed",
      120000,
      1000
    );

    expect(job.status).toBe("done");

    const thread = await readThread(
      { baseDir, sessionId: "real-app-session", objectId: "real-app-object" },
      "root"
    );
    expect(thread).toBeTruthy();
    expect(thread?.status).toBe("paused");
    expect(thread?.events.length).toBeGreaterThan(0);
  }, 180000);
});
