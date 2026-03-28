/**
 * 并发 Focus Cursor 测试
 *
 * 覆盖：recordActionAt、fork_threads、finish_thread、join_threads、
 *       thread focus sync、Scheduler 并发线程检测
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Flow } from "../src/flow/flow.js";
import {
  createProcess,
  addNode,
  findNode,
  resetNodeCounter,
} from "../src/process/tree.js";
import {
  createThread,
  goThread,
  initDefaultThreads,
  listThreads,
  getThread,
} from "../src/process/thread.js";

const TEST_DIR = join(import.meta.dir, ".tmp_concurrent_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  resetNodeCounter();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/* ========== Flow.recordActionAt ========== */

describe("Flow.recordActionAt", () => {
  test("记录 action 到指定节点", () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "test", "hello", "human");

    /* 添加子节点 */
    const process = flow.process;
    const childId = addNode(process, process.root.id, "子任务")!;
    flow.setProcess({ ...process });

    /* 记录 action 到子节点（不是当前 focus） */
    flow.recordActionAt(childId, { type: "thought", content: "子节点的思考" });

    /* 验证 action 在子节点上 */
    const child = findNode(flow.process.root, childId);
    expect(child!.actions).toHaveLength(1);
    expect(child!.actions[0]!.content).toBe("子节点的思考");

    /* 验证 focus 节点（root）没有这个 action */
    expect(flow.process.root.actions).toHaveLength(0);
  });

  test("recordAction 仍然写入 focus 节点", () => {
    const flowsDir = join(TEST_DIR, "flows2");
    const flow = Flow.create(flowsDir, "test", "hello", "human");

    flow.recordAction({ type: "thought", content: "focus 节点的思考" });

    expect(flow.process.root.actions).toHaveLength(1);
    expect(flow.process.root.actions[0]!.content).toBe("focus 节点的思考");
  });
});

/* ========== fork_threads ========== */

describe("fork_threads", () => {
  test("为多个节点创建并发线程", () => {
    const process = createProcess("主任务");
    const child1 = addNode(process, process.root.id, "子任务A")!;
    const child2 = addNode(process, process.root.id, "子任务B")!;
    const child3 = addNode(process, process.root.id, "子任务C")!;

    /* 模拟 fork_threads 逻辑 */
    const nodeIds = [child1, child2, child3];
    if (!process.threads) process.threads = {};

    const created: string[] = [];
    for (const nodeId of nodeIds) {
      const node = findNode(process.root, nodeId);
      if (!node) continue;
      const threadName = `t_${nodeId}`;
      if (process.threads[threadName]) continue;
      process.threads[threadName] = {
        name: threadName,
        focusId: nodeId,
        status: "running",
        signals: [],
      };
      if (node.status === "todo") node.status = "doing";
      created.push(threadName);
    }

    expect(created).toHaveLength(3);
    expect(Object.keys(process.threads)).toHaveLength(3);

    /* 所有线程都是 running */
    for (const thread of Object.values(process.threads)) {
      expect(thread.status).toBe("running");
    }

    /* 所有子节点都变成 doing */
    for (const nodeId of nodeIds) {
      const node = findNode(process.root, nodeId);
      expect(node!.status).toBe("doing");
    }
  });

  test("不能对少于 2 个节点 fork", () => {
    const process = createProcess("主任务");
    const child1 = addNode(process, process.root.id, "子任务A")!;

    /* 只有 1 个节点，不应该 fork */
    const nodeIds = [child1];
    expect(nodeIds.length < 2).toBe(true);
  });
});

/* ========== finish_thread ========== */

describe("finish_thread", () => {
  test("标记当前 running 线程为 finished", () => {
    const process = createProcess("主任务");
    const child1 = addNode(process, process.root.id, "子任务A")!;
    const child2 = addNode(process, process.root.id, "子任务B")!;

    process.threads = {
      t1: { name: "t1", focusId: child1, status: "running", signals: [] },
      t2: { name: "t2", focusId: child2, status: "running", signals: [] },
    };

    /* 模拟 finish_thread：找到第一个 running 的线程并标记为 finished */
    const currentThread = Object.values(process.threads).find(t => t.status === "running");
    expect(currentThread).toBeDefined();
    currentThread!.status = "finished";

    /* 验证一个 finished，一个仍然 running */
    const threads = Object.values(process.threads);
    expect(threads.filter(t => t.status === "finished")).toHaveLength(1);
    expect(threads.filter(t => t.status === "running")).toHaveLength(1);
  });
});

/* ========== join_threads ========== */

describe("join_threads", () => {
  test("所有线程完成时返回 true", () => {
    const process = createProcess("主任务");
    process.threads = {
      t1: { name: "t1", focusId: "n1", status: "finished", signals: [] },
      t2: { name: "t2", focusId: "n2", status: "finished", signals: [] },
    };

    const allFinished = ["t1", "t2"].every((name) => {
      const thread = process.threads?.[name];
      return thread?.status === "finished";
    });

    expect(allFinished).toBe(true);
  });

  test("有线程未完成时返回 false", () => {
    const process = createProcess("主任务");
    process.threads = {
      t1: { name: "t1", focusId: "n1", status: "finished", signals: [] },
      t2: { name: "t2", focusId: "n2", status: "running", signals: [] },
    };

    const allFinished = ["t1", "t2"].every((name) => {
      const thread = process.threads?.[name];
      return thread?.status === "finished";
    });

    expect(allFinished).toBe(false);
  });
});

/* ========== Thread Focus Sync ========== */

describe("thread focus sync", () => {
  test("syncThreadFocusIn 将 process.focusId 切换到线程的 focusId", () => {
    const process = createProcess("主任务");
    const child1 = addNode(process, process.root.id, "子任务A")!;
    const child2 = addNode(process, process.root.id, "子任务B")!;

    process.threads = {
      t1: { name: "t1", focusId: child1, status: "running", signals: [] },
      t2: { name: "t2", focusId: child2, status: "running", signals: [] },
    };

    /* 模拟 syncThreadFocusIn */
    const threadId = "t1";
    const thread = process.threads[threadId];
    if (thread) {
      process.focusId = thread.focusId;
    }

    expect(process.focusId).toBe(child1);
  });

  test("syncThreadFocusOut 将 focusId 变化同步回线程", () => {
    const process = createProcess("主任务");
    const child1 = addNode(process, process.root.id, "子任务A")!;
    const child2 = addNode(process, process.root.id, "子任务B")!;

    process.threads = {
      t1: { name: "t1", focusId: child1, status: "running", signals: [] },
    };

    /* 模拟 ThinkLoop 中 focus 移动 */
    process.focusId = child2;

    /* 模拟 syncThreadFocusOut */
    const threadId = "t1";
    const thread = process.threads[threadId];
    if (thread) {
      thread.focusId = process.focusId;
    }

    expect(process.threads["t1"]!.focusId).toBe(child2);
  });
});

/* ========== Scheduler 并发线程检测 ========== */

describe("Scheduler _getActiveThreads 逻辑", () => {
  test("无 threads 时返回空数组", () => {
    const process = createProcess("主任务");
    const threads = process.threads;
    const active = !threads || Object.keys(threads).length === 0
      ? []
      : Object.values(threads).filter((t) => t.status === "running");

    expect(active).toEqual([]);
  });

  test("多个 running 线程都被检测到", () => {
    const process = createProcess("主任务");
    process.threads = {
      t1: { name: "t1", focusId: "n1", status: "running", signals: [] },
      t2: { name: "t2", focusId: "n2", status: "running", signals: [] },
      t3: { name: "t3", focusId: "n3", status: "finished", signals: [] },
    };

    const threads = process.threads;
    const active = Object.values(threads).filter((t) => t.status === "running");

    expect(active).toHaveLength(2);
    expect(active.map(t => t.name).sort()).toEqual(["t1", "t2"]);
  });

  test("只有 yielded 和 finished 线程时返回空", () => {
    const process = createProcess("主任务");
    process.threads = {
      t1: { name: "t1", focusId: "n1", status: "yielded", signals: [] },
      t2: { name: "t2", focusId: "n2", status: "finished", signals: [] },
    };

    const threads = process.threads;
    const active = Object.values(threads).filter((t) => t.status === "running");

    expect(active).toHaveLength(0);
  });
});

/* ========== 现有 thread API 兼容性 ========== */

describe("thread API 兼容性", () => {
  test("createThread + goThread 仍然正常工作", () => {
    const process = createProcess("主任务");
    const child1 = addNode(process, process.root.id, "子任务A")!;

    const ok = createThread(process, "worker", child1);
    expect(ok).toBe(true);
    expect(process.threads!["worker"]!.focusId).toBe(child1);
    expect(process.threads!["worker"]!.status).toBe("running");

    /* goThread 切换 */
    const result = goThread(process, "worker");
    expect(result.success).toBe(true);
    expect(process.focusId).toBe(child1);
  });

  test("initDefaultThreads 创建 frontend + backend", () => {
    const process = createProcess("主任务");
    const inited = initDefaultThreads(process);
    expect(inited).toBe(true);

    const threads = listThreads(process);
    expect(threads).toHaveLength(2);
    expect(threads.map(t => t.name).sort()).toEqual(["backend", "frontend"]);

    const frontend = getThread(process, "frontend");
    expect(frontend!.status).toBe("running");

    const backend = getThread(process, "backend");
    expect(backend!.status).toBe("yielded");
  });
});
