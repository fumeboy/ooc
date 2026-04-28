import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inferLiveFlowStatus, inferSessionLiveStatus } from "../src/observable/server/sessions.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ooc-live-status-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeThreads(
  objectDir: string,
  statuses: Array<"running" | "waiting" | "done" | "failed" | "paused" | "pending">,
) {
  mkdirSync(objectDir, { recursive: true });
  const nodes: Record<string, unknown> = {};
  statuses.forEach((status, index) => {
    nodes[`n${index}`] = {
      id: `n${index}`,
      title: `node ${index}`,
      status,
      childrenIds: [],
      createdAt: 1,
      updatedAt: 1,
      ...(status === "waiting" ? { waitingType: "explicit_wait" } : {}),
    };
  });
  writeFileSync(join(objectDir, "threads.json"), JSON.stringify({ rootId: "n0", nodes }, null, 2));
}

function writeFlowData(objectDir: string, status: string) {
  mkdirSync(objectDir, { recursive: true });
  writeFileSync(join(objectDir, "data.json"), JSON.stringify({
    sessionId: "s_test",
    stoneName: objectDir.split("/").at(-1),
    status,
    messages: [],
    process: { root: { id: "root", title: "task", status: "done", children: [] }, focusId: "root" },
    data: {},
    createdAt: 1,
    updatedAt: 1,
  }, null, 2));
}

describe("live flow status inference", () => {
  test("returns waiting when threads contain only waiting nodes", () => {
    const objectDir = join(root, "objects", "bruce");
    writeThreads(objectDir, ["waiting"]);

    expect(inferLiveFlowStatus(objectDir, "finished")).toBe("waiting");
  });

  test("running wins over waiting", () => {
    const objectDir = join(root, "objects", "bruce");
    writeThreads(objectDir, ["waiting", "running"]);

    expect(inferLiveFlowStatus(objectDir, "waiting")).toBe("running");
  });

  test("falls back when no running or waiting nodes exist", () => {
    const objectDir = join(root, "objects", "kernel");
    writeThreads(objectDir, ["failed"]);

    expect(inferLiveFlowStatus(objectDir, "failed")).toBe("failed");
  });

  test("session with waiting and finished objects is waiting", () => {
    const sessionDir = root;
    writeThreads(join(sessionDir, "objects", "bruce"), ["waiting"]);
    writeFlowData(join(sessionDir, "objects", "iris"), "finished");

    expect(inferSessionLiveStatus(sessionDir, "finished")).toBe("waiting");
  });
});
