import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleRoute } from "../src/observable/server/server.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ooc-flow-detail-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeWorld() {
  return {
    rootDir: root,
    flowsDir: join(root, "flows"),
    objectsDir: join(root, "stones"),
  } as any;
}

function writeFlow(objectName: string, status: string, threadStatus: string) {
  const dir = join(root, "flows", "s_test", "objects", objectName);
  mkdirSync(join(dir, "threads", "root"), { recursive: true });
  writeFileSync(join(dir, "data.json"), JSON.stringify({
    sessionId: "s_test",
    stoneName: objectName,
    status,
    messages: [],
    process: { root: { id: "root", title: "task", status: "done", children: [] }, focusId: "root" },
    data: {},
    createdAt: 1,
    updatedAt: 1,
  }, null, 2));
  writeFileSync(join(dir, "threads.json"), JSON.stringify({
    rootId: "root",
    nodes: {
      root: {
        id: "root",
        title: `${objectName} root`,
        status: threadStatus,
        ...(threadStatus === "waiting" ? { waitingType: "explicit_wait" } : {}),
        childrenIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
  }, null, 2));
  writeFileSync(join(dir, "threads", "root", "thread.json"), JSON.stringify({ id: "root", events: [] }, null, 2));
}

describe("GET /api/flows/:sessionId status aggregation", () => {
  test("all waiting subflows produce top-level waiting", async () => {
    writeFlow("bruce", "waiting", "waiting");
    writeFlow("iris", "waiting", "waiting");

    const res = await handleRoute("GET", "/api/flows/s_test", new Request("http://localhost/api/flows/s_test"), makeWorld());
    const body = await res.json() as any;

    expect(body.success).toBe(true);
    expect(body.data.flow.status).toBe("waiting");
    expect(body.data.subFlows.map((sf: any) => sf.status).sort()).toEqual(["waiting", "waiting"]);
  });

  test("running subflow wins over waiting", async () => {
    writeFlow("bruce", "waiting", "waiting");
    writeFlow("supervisor", "running", "running");

    const res = await handleRoute("GET", "/api/flows/s_test", new Request("http://localhost/api/flows/s_test"), makeWorld());
    const body = await res.json() as any;

    expect(body.success).toBe(true);
    expect(body.data.flow.status).toBe("running");
  });
});
