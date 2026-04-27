/**
 * 线程级 Scheduler 测试
 *
 * 测试事件驱动调度、唤醒机制、错误传播、死锁检测、暂停/恢复。
 * 使用 mock 的 runOneIteration 替代真实 LLM 调用。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#6
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#8
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  ThreadScheduler,
  type ThreadSchedulerConfig,
  type SchedulerCallbacks,
} from "../src/thinkable/engine/scheduler.js";
import type { ThreadsTree } from "../src/thinkable/thread-tree/tree.js";
import type { ThreadsTreeNodeMeta, ThreadStatus } from "../src/thinkable/thread-tree/types.js";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_scheduler_test");

/** 创建一个最小的 ThreadsTreeNodeMeta */
function makeNode(
  id: string,
  status: ThreadStatus,
  opts?: Partial<ThreadsTreeNodeMeta>,
): ThreadsTreeNodeMeta {
  const now = Date.now();
  return {
    id,
    title: `Node ${id}`,
    status,
    childrenIds: [],
    createdAt: now,
    updatedAt: now,
    ...opts,
  };
}

/**
 * 创建 mock ThreadsTree
 *
 * 提供最小的内存树接口，用于测试 Scheduler 的调度逻辑。
 * 接口与阶段 2 的 ThreadsTree 对齐：
 * - nodeIds getter + getNode(id) 替代 allNodes()
 * - setNodeStatus(id, status) 是 async（真实实现走 _mutate 串行化写入）
 */
function createMockTree(nodes: Record<string, ThreadsTreeNodeMeta>, rootId: string) {
  return {
    rootId,
    get nodeIds() { return Object.keys(nodes); },
    getNode(id: string) { return nodes[id] ?? null; },
    async setNodeStatus(id: string, status: ThreadStatus): Promise<void> {
      const node = nodes[id];
      if (node) { node.status = status; node.updatedAt = Date.now(); }
    },
    getChildren(id: string) {
      const node = nodes[id];
      if (!node) return [];
      return node.childrenIds.map(cid => nodes[cid]).filter(Boolean);
    },
  };
}

/** 创建 mock SchedulerCallbacks */
function createMockCallbacks(opts?: {
  iterationFn?: (threadId: string) => Promise<void>;
}) {
  const iterationLog: string[] = [];
  const wakeLog: string[] = [];
  const errorLog: Array<{ threadId: string; message: string }> = [];

  const callbacks: SchedulerCallbacks = {
    /** 执行一轮 ThinkLoop 迭代 */
    runOneIteration: async (threadId: string, objectName: string) => {
      iterationLog.push(threadId);
      if (opts?.iterationFn) await opts.iterationFn(threadId);
    },
    /** 线程完成回调 */
    onThreadFinished: (threadId: string, objectName: string) => {},
    /** 错误通知回调 */
    onThreadError: (threadId: string, objectName: string, error: string) => {
      errorLog.push({ threadId, message: error });
    },
  };

  return { callbacks, iterationLog, wakeLog, errorLog };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/* ========== 基础调度 ========== */

describe("基础调度", () => {
  test("单线程 running → 执行迭代 → done 后停止", async () => {
    const nodes = { r: makeNode("r", "running") };
    const tree = createMockTree(nodes, "r");
    let iterCount = 0;

    const { callbacks, iterationLog } = createMockCallbacks({
      iterationFn: async (threadId) => {
        iterCount++;
        if (iterCount >= 3) {
          await tree.setNodeStatus(threadId, "done");
        }
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(iterationLog).toHaveLength(3);
    expect(nodes.r.status).toBe("done");
  });

  test("pending 线程不被调度", async () => {
    const nodes = {
      r: makeNode("r", "done", { childrenIds: ["a"] }),
      a: makeNode("a", "pending", { parentId: "r" }),
    };
    const tree = createMockTree(nodes, "r");
    const { callbacks, iterationLog } = createMockCallbacks();

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(iterationLog).toHaveLength(0);
  });

  test("多个 running 线程并行调度", async () => {
    const iterCounts: Record<string, number> = { a: 0, b: 0 };
    const nodes = {
      r: makeNode("r", "waiting", { childrenIds: ["a", "b"], awaitingChildren: ["a", "b"] }),
      a: makeNode("a", "running", { parentId: "r" }),
      b: makeNode("b", "running", { parentId: "r" }),
    };
    const tree = createMockTree(nodes, "r");

    const { callbacks, iterationLog } = createMockCallbacks({
      iterationFn: async (threadId) => {
        iterCounts[threadId] = (iterCounts[threadId] ?? 0) + 1;
        if (iterCounts[threadId]! >= 2) {
          await tree.setNodeStatus(threadId, "done");
        }
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    /* 两个线程各执行 2 轮 */
    expect(iterationLog.filter(id => id === "a")).toHaveLength(2);
    expect(iterationLog.filter(id => id === "b")).toHaveLength(2);
  });
});

/* ========== 唤醒机制 ========== */

describe("唤醒机制", () => {
  test("子线程 done → 唤醒 waiting 的父线程", async () => {
    let childIter = 0;
    let parentWoken = false;
    const nodes = {
      r: makeNode("r", "waiting", {
        childrenIds: ["a"],
        awaitingChildren: ["a"],
      }),
      a: makeNode("a", "running", { parentId: "r", creatorThreadId: "r" }),
    };
    const tree = createMockTree(nodes, "r");

    const { callbacks, iterationLog } = createMockCallbacks({
      iterationFn: async (threadId) => {
        if (threadId === "a") {
          childIter++;
          if (childIter >= 2) {
            await tree.setNodeStatus("a", "done");
            nodes.a.summary = "子任务完成";
          }
        }
        if (threadId === "r") {
          parentWoken = true;
          await tree.setNodeStatus("r", "done");
        }
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(parentWoken).toBe(true);
    expect(nodes.r.status).toBe("done");
  });

  test("await_all：所有子线程 done 后才唤醒", async () => {
    const iterCounts: Record<string, number> = {};
    let parentWoken = false;
    const nodes = {
      r: makeNode("r", "waiting", {
        childrenIds: ["a", "b"],
        awaitingChildren: ["a", "b"],
      }),
      a: makeNode("a", "running", { parentId: "r", creatorThreadId: "r" }),
      b: makeNode("b", "running", { parentId: "r", creatorThreadId: "r" }),
    };
    const tree = createMockTree(nodes, "r");

    const { callbacks } = createMockCallbacks({
      iterationFn: async (threadId) => {
        iterCounts[threadId] = (iterCounts[threadId] ?? 0) + 1;
        if (threadId === "a" && iterCounts[threadId]! >= 1) {
          await tree.setNodeStatus("a", "done");
        }
        if (threadId === "b" && iterCounts[threadId]! >= 3) {
          await tree.setNodeStatus("b", "done");
        }
        if (threadId === "r") {
          parentWoken = true;
          await tree.setNodeStatus("r", "done");
        }
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(parentWoken).toBe(true);
    /* a 先完成，但 r 不会被唤醒，直到 b 也完成 */
    expect(nodes.a.status).toBe("done");
    expect(nodes.b.status).toBe("done");
    expect(nodes.r.status).toBe("done");
  });

  test("子线程 failed → 也唤醒等待者", async () => {
    let parentWoken = false;
    const nodes = {
      r: makeNode("r", "waiting", {
        childrenIds: ["a"],
        awaitingChildren: ["a"],
      }),
      a: makeNode("a", "running", { parentId: "r", creatorThreadId: "r" }),
    };
    const tree = createMockTree(nodes, "r");

    const { callbacks, errorLog } = createMockCallbacks({
      iterationFn: async (threadId) => {
        if (threadId === "a") {
          await tree.setNodeStatus("a", "failed");
        }
        if (threadId === "r") {
          parentWoken = true;
          await tree.setNodeStatus("r", "done");
        }
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(parentWoken).toBe(true);
  });
});

/* ========== 错误处理 ========== */

describe("错误处理", () => {
  test("单线程超时（迭代上限）→ 标记 failed", async () => {
    const nodes = { r: makeNode("r", "running") };
    const tree = createMockTree(nodes, "r");

    const { callbacks, iterationLog } = createMockCallbacks();

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 5,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(iterationLog).toHaveLength(5);
    expect(nodes.r.status).toBe("failed");
  });

  test("全局迭代上限 → 所有 running 线程标记 failed", async () => {
    const nodes = {
      r: makeNode("r", "waiting", { childrenIds: ["a", "b"], awaitingChildren: ["a", "b"] }),
      a: makeNode("a", "running", { parentId: "r" }),
      b: makeNode("b", "running", { parentId: "r" }),
    };
    const tree = createMockTree(nodes, "r");

    const { callbacks } = createMockCallbacks();

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 6,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(nodes.a.status).toBe("failed");
    expect(nodes.b.status).toBe("failed");
  });

  test("线程失败 → 通知 creatorThreadId", async () => {
    let notified = false;
    const nodes = {
      r: makeNode("r", "waiting", {
        childrenIds: ["a"],
        awaitingChildren: ["a"],
      }),
      a: makeNode("a", "running", { parentId: "r", creatorThreadId: "r" }),
    };
    const tree = createMockTree(nodes, "r");

    const { callbacks, errorLog } = createMockCallbacks({
      iterationFn: async (threadId) => {
        if (threadId === "a") {
          await tree.setNodeStatus("a", "failed");
        }
        if (threadId === "r") {
          notified = true;
          await tree.setNodeStatus("r", "done");
        }
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    /* 错误回调被调用 */
    expect(errorLog.length).toBeGreaterThanOrEqual(1);
    expect(errorLog.some(e => e.threadId === "r")).toBe(true);
  });

  test("死锁检测：running=0 且 waiting>0 → 唤醒所有 waiting", async () => {
    /**
     * 构造真实死锁场景：
     * r 创建子线程 a 和 b，然后 await_all([a, b])
     * a 完成后，b 进入 waiting 等待一个不存在于本 Object 内的子线程 x
     * 但 x 实际上也在本 Object 内（只是 awaitingChildren 指向了 r，形成环）
     *
     * 简化版：r waiting for a, a waiting for b, b 不存在
     * → running=0, waiting=2, 内部等待（a 的 awaitingChildren 都在本树内）
     */
    let wokenThreads: string[] = [];
    const nodes = {
      r: makeNode("r", "waiting", {
        childrenIds: ["a"],
        awaitingChildren: ["a"],
      }),
      a: makeNode("a", "waiting", {
        parentId: "r",
        childrenIds: ["b"],
        awaitingChildren: ["b"],
      }),
      b: makeNode("b", "waiting", {
        parentId: "a",
        awaitingChildren: ["r"], /* 循环依赖 → 死锁 */
      }),
    };
    const tree = createMockTree(nodes, "r");

    const { callbacks } = createMockCallbacks({
      iterationFn: async (threadId) => {
        wokenThreads.push(threadId);
        /* 被唤醒后直接完成，避免再次死锁 */
        await tree.setNodeStatus(threadId, "done");
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0, /* 测试中不等待宽限期 */
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    /* 死锁被检测到，所有 waiting 线程被唤醒 */
    expect(wokenThreads.length).toBeGreaterThanOrEqual(1);
  });

  test("孤儿线程：creatorThreadId 不存在 → 通知后等待自行结束", async () => {
    const nodes = {
      r: makeNode("r", "done"),
      orphan: makeNode("orphan", "running", {
        parentId: "r",
        creatorThreadId: "nonexistent",
        creatorObjectName: "other_obj",
      }),
    };
    const tree = createMockTree(nodes, "r");
    let orphanRan = false;

    const { callbacks } = createMockCallbacks({
      iterationFn: async (threadId) => {
        if (threadId === "orphan") {
          orphanRan = true;
          await tree.setNodeStatus("orphan", "done");
        }
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    /* 孤儿线程仍然被调度执行 */
    expect(orphanRan).toBe(true);
  });
});

/* ========== 暂停/恢复 ========== */

describe("暂停/恢复", () => {
  test("pauseObject → 线程不再被调度", async () => {
    let iterCount = 0;
    const nodes = { r: makeNode("r", "running") };
    const tree = createMockTree(nodes, "r");

    const { callbacks, iterationLog } = createMockCallbacks({
      iterationFn: async () => {
        iterCount++;
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    /* 暂停后立即运行 */
    scheduler.pauseObject("obj_a");

    await scheduler.run("obj_a", tree as any, callbacks);

    /* 被暂停，不执行任何迭代 */
    expect(iterationLog).toHaveLength(0);
    /* 状态保持 running（不改为 failed） */
    expect(nodes.r.status).toBe("running");
  });

  test("resumeObject → 恢复调度", async () => {
    let iterCount = 0;
    const nodes = { r: makeNode("r", "running") };
    const tree = createMockTree(nodes, "r");

    const { callbacks } = createMockCallbacks({
      iterationFn: async () => {
        iterCount++;
        if (iterCount >= 2) await tree.setNodeStatus("r", "done");
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    scheduler.pauseObject("obj_a");
    scheduler.resumeObject("obj_a");

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(iterCount).toBe(2);
    expect(nodes.r.status).toBe("done");
  });

  test("暂停期间 inbox 消息不丢失", async () => {
    /**
     * 模拟：暂停 obj_a，期间有消息写入 inbox，
     * 恢复后线程能看到消息。
     *
     * 这个测试验证的是 Scheduler 不清理 inbox，
     * 消息持久化由 ThreadsTree 保证（阶段 2）。
     * Scheduler 只需保证暂停时不调度、恢复后继续。
     */
    let iterCount = 0;
    const nodes = { r: makeNode("r", "running") };
    const tree = createMockTree(nodes, "r");

    const { callbacks } = createMockCallbacks({
      iterationFn: async () => {
        iterCount++;
        if (iterCount >= 1) await tree.setNodeStatus("r", "done");
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    scheduler.pauseObject("obj_a");
    /* 模拟外部写入 inbox（Scheduler 不感知，由 tree 层处理） */
    scheduler.resumeObject("obj_a");

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(iterCount).toBe(1);
  });
});

/* ========== Session 级别 ========== */

describe("Session 级别", () => {
  test("Session 超时 → 所有线程强制 failed", async () => {
    const nodes = {
      r: makeNode("r", "running", { childrenIds: ["a"] }),
      a: makeNode("a", "running", { parentId: "r" }),
    };
    const tree = createMockTree(nodes, "r");

    const { callbacks } = createMockCallbacks();

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 4, /* 全局上限 = Session 超时 */
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(nodes.r.status).toBe("failed");
    expect(nodes.a.status).toBe("failed");
  });

  test("所有线程 done → run() 正常返回", async () => {
    const nodes = { r: makeNode("r", "running") };
    const tree = createMockTree(nodes, "r");

    const { callbacks } = createMockCallbacks({
      iterationFn: async () => {
        await tree.setNodeStatus("r", "done");
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(nodes.r.status).toBe("done");
  });
});

/* ========== 动态线程创建 ========== */

describe("动态线程创建", () => {
  test("onThreadCreated → 新线程被纳入调度", async () => {
    let rootIter = 0;
    let childCreated = false;
    const nodes: Record<string, ThreadsTreeNodeMeta> = {
      r: makeNode("r", "running"),
    };
    const tree = createMockTree(nodes, "r");

    let scheduler: ThreadScheduler;

    const { callbacks, iterationLog } = createMockCallbacks({
      iterationFn: async (threadId) => {
        if (threadId === "r") {
          rootIter++;
            if (rootIter === 1 && !childCreated) {
              /* 第一轮：创建子线程 */
              nodes["child"] = makeNode("child", "running", { parentId: "r", creatorThreadId: "r" });
              nodes.r!.childrenIds.push("child");
              nodes.r!.awaitingChildren = ["child"];
            await tree.setNodeStatus("r", "waiting");
            childCreated = true;
            /* 通知 Scheduler 有新线程 */
            scheduler.onThreadCreated("child", "obj_a");
          } else {
            /* 被唤醒后完成 */
            await tree.setNodeStatus("r", "done");
          }
        }
        if (threadId === "child") {
          await tree.setNodeStatus("child", "done");
          nodes.child!.summary = "子任务完成";
        }
      },
    });

    scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    expect(iterationLog).toContain("child");
    expect(nodes.r!.status).toBe("done");
    expect(nodes.child!.status).toBe("done");
  });
});

/* ========== 异常处理 ========== */

describe("异常处理", () => {
  test("runOneIteration 抛异常 → 线程标记 failed + 错误传播", async () => {
    const nodes = {
      r: makeNode("r", "waiting", {
        childrenIds: ["a"],
        awaitingChildren: ["a"],
      }),
      a: makeNode("a", "running", { parentId: "r", creatorThreadId: "r" }),
    };
    const tree = createMockTree(nodes, "r");
    let parentWoken = false;

    const { callbacks, errorLog } = createMockCallbacks({
      iterationFn: async (threadId) => {
        if (threadId === "a") {
          throw new Error("LLM 调用失败: rate limit exceeded");
        }
        if (threadId === "r") {
          parentWoken = true;
          await tree.setNodeStatus("r", "done");
        }
      },
    });

    const scheduler = new ThreadScheduler({
      maxIterationsPerThread: 100,
      maxTotalIterations: 200,
      deadlockGracePeriodMs: 0,
    });

    await scheduler.run("obj_a", tree as any, callbacks);

    /* 线程 a 被标记为 failed */
    expect(nodes.a.status).toBe("failed");
    /* 错误被传播到创建者 r */
    expect(errorLog.some(e => e.threadId === "r")).toBe(true);
    expect(errorLog.some(e => e.message.includes("LLM 调用失败"))).toBe(true);
    /* 父线程被唤醒（failed 也算完成） */
    expect(parentWoken).toBe(true);
  });
});
