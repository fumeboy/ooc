import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { threadsToProcess } from "../src/storable/thread/thread-adapter.js";
import { writeThreadData, writeThreadsTree } from "../src/storable/thread/persistence.js";
import type { ThreadsTreeFile } from "../src/thinkable/thread-tree/types.js";

const TEST_DIR = join(import.meta.dir, ".tmp_process_events_contract");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Process API event field contract", () => {
  test("threadsToProcess exposes node events without an actions alias", () => {
    const now = Date.now();
    const tree: ThreadsTreeFile = {
      rootId: "root",
      nodes: {
        root: { id: "root", title: "Root", status: "running", childrenIds: [], createdAt: now, updatedAt: now },
      },
    };

    writeThreadsTree(TEST_DIR, tree);
    writeThreadData(join(TEST_DIR, "threads", "root"), {
      id: "root",
      events: [{ id: "e1", type: "thinking", content: "正在分析", timestamp: now }],
    });

    const process = threadsToProcess(TEST_DIR)!;
    expect(process.root.events).toHaveLength(1);
    expect(process.root.events[0]!.id).toBe("e1");
    expect("actions" in process.root).toBe(false);
  });

  test("threadsToProcess preserves failed node status", () => {
    const now = Date.now();
    const tree: ThreadsTreeFile = {
      rootId: "root",
      nodes: {
        root: { id: "root", title: "Root", status: "failed", childrenIds: [], createdAt: now, updatedAt: now },
      },
    };

    writeThreadsTree(TEST_DIR, tree);
    writeThreadData(join(TEST_DIR, "threads", "root"), { id: "root", events: [] });

    const process = threadsToProcess(TEST_DIR)!;
    expect(process.root.status).toBe("failed");
    expect(process.root.locals?._threadStatus).toBe("failed");
  });
});
