import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contextDir,
  contextObjectDir,
  contextObjectFile,
  readContextObjects,
  readContextObjectsRecursive,
  writeContextObject,
  deleteContextObject,
} from "../flow-context";
import type { ContextWindow } from "../../executable/windows/_shared/types.js";
import type { FlowObjectRef } from "../common";

describe("flow-context", () => {
  let baseDir: string;
  let ref: FlowObjectRef;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-flow-ctx-"));
    ref = {
      baseDir,
      sessionId: "sess_123",
      objectId: "agent_of_x",
    };
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("computes correct paths", () => {
    expect(contextDir(ref, "agent_of_x")).toBe(
      join(baseDir, "flows", "sess_123", "objects", "agent_of_x", "context"),
    );
    expect(contextObjectDir(ref, "agent_of_x", "todo_456")).toBe(
      join(baseDir, "flows", "sess_123", "objects", "agent_of_x", "context", "todo_456"),
    );
    expect(contextObjectFile(ref, "agent_of_x", "todo_456")).toBe(
      join(baseDir, "flows", "sess_123", "objects", "agent_of_x", "context", "todo_456", "window.json"),
    );
  });

  it("handles nested object ids (children/ separator)", () => {
    const nestedRef = { ...ref, objectId: "supervisor/agent_of_x" };
    expect(contextDir(nestedRef, "supervisor/agent_of_x")).toBe(
      join(baseDir, "flows", "sess_123", "objects", "supervisor", "children", "agent_of_x", "context"),
    );
  });

  it("writes and reads context objects", async () => {
    const window: ContextWindow = {
      id: "todo_1",
      type: "todo",
      title: "Test Todo",
      status: "active",
      createdAt: Date.now(),
      items: [{ id: "1", text: "item 1", done: false }],
    };

    await writeContextObject(ref, "agent_of_x", window);

    const objs = await readContextObjects(ref, "agent_of_x");
    expect(objs.size).toBe(1);
    expect(objs.get("todo_1")?.type).toBe("todo");
    expect(objs.get("todo_1")?.title).toBe("Test Todo");
  });

  it("returns empty map for non-existent context directory", async () => {
    const objs = await readContextObjects(ref, "nonexistent");
    expect(objs.size).toBe(0);
  });

  it("deletes context objects", async () => {
    const window: ContextWindow = {
      id: "todo_1",
      type: "todo",
      title: "Test",
      status: "active",
      createdAt: Date.now(),
      items: [],
    };
    await writeContextObject(ref, "agent_of_x", window);
    expect((await readContextObjects(ref, "agent_of_x")).size).toBe(1);

    await deleteContextObject(ref, "agent_of_x", "todo_1");
    expect((await readContextObjects(ref, "agent_of_x")).size).toBe(0);
  });

  it("deleteContextObject is idempotent for non-existent objects", async () => {
    await deleteContextObject(ref, "agent_of_x", "nonexistent");
    // should not throw
  });

  it("readContextObjectsRecursive reads from all ancestor levels", async () => {
    const nestedRef = { ...ref, objectId: "supervisor/agent_of_x/worker" };

    // Write at each level
    const win1: ContextWindow = {
      id: "win_at_supervisor",
      type: "todo",
      title: "supervisor level",
      status: "active",
      createdAt: 1,
      items: [],
    };
    const win2: ContextWindow = {
      id: "win_at_agent",
      type: "file",
      title: "agent level",
      status: "active",
      createdAt: 2,
      filePath: "test.ts",
    };
    const win3: ContextWindow = {
      id: "win_at_worker",
      type: "plan",
      title: "worker level",
      status: "active",
      createdAt: 3,
      steps: [],
    };

    await writeContextObject(nestedRef, "supervisor", win1);
    await writeContextObject(nestedRef, "supervisor/agent_of_x", win2);
    await writeContextObject(nestedRef, "supervisor/agent_of_x/worker", win3);

    const all = await readContextObjectsRecursive(nestedRef);
    expect(all.size).toBe(3);
    expect(all.get("win_at_supervisor")?.title).toBe("supervisor level");
    expect(all.get("win_at_agent")?.title).toBe("agent level");
    expect(all.get("win_at_worker")?.title).toBe("worker level");
  });

  it("skips malformed window.json gracefully", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const badDir = join(contextDir(ref, "agent_of_x"), "bad_window");
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, "window.json"), "not valid json", "utf8");

    const objs = await readContextObjects(ref, "agent_of_x");
    expect(objs.size).toBe(0); // skipped gracefully
  });
});
