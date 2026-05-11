import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

function makeApp() {
  const baseDir = mkdtempSync(join(tmpdir(), "ooc-app-server-e2e-"));
  const app = buildServer({
    ...readServerConfig(),
    port: 0,
    baseDir,
    workerPollMs: 5,
    workerEnabled: false,
  });
  return { app, baseDir };
}

describe("app server local e2e", () => {
  test("create stone -> write self -> read self", async () => {
    const { app } = makeApp();

    const createStone = await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "stone-e2e-1" }),
      })
    );
    expect(createStone.status).toBe(200);
    const created = await createStone.json();
    expect(created.objectId).toBe("stone-e2e-1");

    const putSelf = await app.handle(
      new Request("http://localhost/api/stones/stone-e2e-1/self", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: '{"ok":true,"n":1}' }),
      })
    );
    expect(putSelf.status).toBe(200);

    const getSelf = await app.handle(new Request("http://localhost/api/stones/stone-e2e-1/self"));
    expect(getSelf.status).toBe(200);
    const selfBody = await getSelf.json();
    expect(selfBody.text).toBe('{"ok":true,"n":1}');
  });

  test("create session -> create flow object returns initialThreadId and jobId", async () => {
    const { app } = makeApp();

    const createSession = await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "flow-e2e-session", title: "Flow E2E Session" }),
      })
    );
    expect(createSession.status).toBe(200);
    const session = await createSession.json();
    expect(session.sessionId).toBe("flow-e2e-session");

    const createFlowObject = await app.handle(
      new Request("http://localhost/api/flows/flow-e2e-session/objects/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "flow-e2e-object" }),
      })
    );
    expect(createFlowObject.status).toBe(200);
    const objectBody = await createFlowObject.json();
    expect(objectBody.initialThreadId).toBe("root");
    expect(typeof objectBody.jobId).toBe("string");
    expect(objectBody.jobId.length).toBeGreaterThan(0);
  });
});
