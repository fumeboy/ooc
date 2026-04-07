/**
 * 线程树持久化层测试
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#10
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  readThreadsTree,
  writeThreadsTree,
  readThreadData,
  writeThreadData,
  getThreadDir,
  ensureThreadDir,
  getAncestorPath,
} from "../src/thread/persistence.js";
import type { ThreadsTreeFile, ThreadDataFile } from "../src/thread/types.js";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_persist_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("threads.json 读写", () => {
  test("写入并读取 threads.json", () => {
    const tree: ThreadsTreeFile = {
      rootId: "root_001",
      nodes: {
        root_001: {
          id: "root_001",
          title: "Root",
          status: "running",
          childrenIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    };
    writeThreadsTree(TEST_DIR, tree);
    const loaded = readThreadsTree(TEST_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded!.rootId).toBe("root_001");
    expect(loaded!.nodes["root_001"]!.title).toBe("Root");
  });

  test("不存在时返回 null", () => {
    const loaded = readThreadsTree(join(TEST_DIR, "nonexistent"));
    expect(loaded).toBeNull();
  });

  test("多节点树结构", () => {
    const now = Date.now();
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: { id: "r", title: "Root", status: "running", childrenIds: ["a", "b"], createdAt: now, updatedAt: now },
        a: { id: "a", title: "A", status: "done", parentId: "r", childrenIds: [], summary: "A 完成", createdAt: now, updatedAt: now },
        b: { id: "b", title: "B", status: "pending", parentId: "r", childrenIds: [], createdAt: now, updatedAt: now },
      },
    };
    writeThreadsTree(TEST_DIR, tree);
    const loaded = readThreadsTree(TEST_DIR)!;
    expect(Object.keys(loaded.nodes)).toHaveLength(3);
    expect(loaded.nodes["a"]!.summary).toBe("A 完成");
    expect(loaded.nodes["b"]!.parentId).toBe("r");
  });
});

describe("thread.json 读写", () => {
  test("写入并读取 thread.json", () => {
    const threadDir = join(TEST_DIR, "threads", "root_001");
    mkdirSync(threadDir, { recursive: true });

    const data: ThreadDataFile = {
      id: "root_001",
      actions: [
        { type: "thought", content: "开始思考", timestamp: Date.now() },
      ],
      plan: "写论文",
    };
    writeThreadData(threadDir, data);
    const loaded = readThreadData(threadDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("root_001");
    expect(loaded!.actions).toHaveLength(1);
    expect(loaded!.plan).toBe("写论文");
  });

  test("不存在时返回 null", () => {
    const loaded = readThreadData(join(TEST_DIR, "nonexistent"));
    expect(loaded).toBeNull();
  });

  test("包含 inbox 和 todos", () => {
    const threadDir = join(TEST_DIR, "threads", "t1");
    mkdirSync(threadDir, { recursive: true });

    const data: ThreadDataFile = {
      id: "t1",
      actions: [],
      inbox: [
        { id: "msg1", from: "A", content: "你好", timestamp: Date.now(), source: "talk", status: "unread" },
      ],
      todos: [
        { id: "todo1", content: "回复 A", status: "pending", createdAt: Date.now() },
      ],
    };
    writeThreadData(threadDir, data);
    const loaded = readThreadData(threadDir)!;
    expect(loaded.inbox).toHaveLength(1);
    expect(loaded.inbox![0]!.status).toBe("unread");
    expect(loaded.todos).toHaveLength(1);
    expect(loaded.todos![0]!.content).toBe("回复 A");
  });
});

describe("目录路径计算", () => {
  test("Root 线程路径", () => {
    const dir = getThreadDir(TEST_DIR, ["root_001"]);
    expect(dir).toBe(join(TEST_DIR, "threads", "root_001"));
  });

  test("嵌套线程路径", () => {
    const dir = getThreadDir(TEST_DIR, ["root_001", "child_a", "grandchild_x"]);
    expect(dir).toBe(join(TEST_DIR, "threads", "root_001", "child_a", "grandchild_x"));
  });

  test("ensureThreadDir 创建嵌套目录", () => {
    const dir = ensureThreadDir(TEST_DIR, ["r", "a", "b"]);
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(TEST_DIR, "threads", "r", "a", "b"));
  });
});

describe("getAncestorPath", () => {
  test("Root 节点返回 [rootId]", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: { id: "r", title: "Root", status: "running", childrenIds: [], createdAt: 0, updatedAt: 0 },
      },
    };
    expect(getAncestorPath(tree, "r")).toEqual(["r"]);
  });

  test("三层嵌套返回完整路径", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: { id: "r", title: "Root", status: "running", childrenIds: ["a"], createdAt: 0, updatedAt: 0 },
        a: { id: "a", title: "A", status: "running", parentId: "r", childrenIds: ["b"], createdAt: 0, updatedAt: 0 },
        b: { id: "b", title: "B", status: "running", parentId: "a", childrenIds: [], createdAt: 0, updatedAt: 0 },
      },
    };
    expect(getAncestorPath(tree, "b")).toEqual(["r", "a", "b"]);
  });

  test("不存在的节点返回 [nodeId]", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: { id: "r", title: "Root", status: "running", childrenIds: [], createdAt: 0, updatedAt: 0 },
      },
    };
    expect(getAncestorPath(tree, "nonexistent")).toEqual(["nonexistent"]);
  });

  test("写入 → 读取 → getAncestorPath 端到端", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: { id: "r", title: "Root", status: "running", childrenIds: ["a"], createdAt: 0, updatedAt: 0 },
        a: { id: "a", title: "A", status: "done", parentId: "r", childrenIds: ["b"], createdAt: 0, updatedAt: 0 },
        b: { id: "b", title: "B", status: "running", parentId: "a", childrenIds: [], createdAt: 0, updatedAt: 0 },
      },
    };
    writeThreadsTree(TEST_DIR, tree);
    const loaded = readThreadsTree(TEST_DIR)!;
    expect(getAncestorPath(loaded, "b")).toEqual(["r", "a", "b"]);
  });
});
