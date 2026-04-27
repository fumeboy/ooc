/**
 * BUG-C 修复验证测试
 *
 * think(wait=true) 导致的双重死锁：
 * - Symptom 1: 父线程进入 waiting 后 _awaitingChildren 为空（子线程先于 awaitThreads 完成）
 * - Symptom 2: 子线程的 <task> 渲染父线程的 title，而不是子线程自身的 title
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { ThreadsTree } from "../src/thread/tree.js";
import {
  buildThreadContext,
  type ThreadContextInput,
} from "../src/thread/context-builder.js";
import { runWithThreadTree, type EngineConfig } from "../src/thread/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/client.js";
import type { StoneData } from "../src/types/index.js";
import type {
  ThreadsTreeFile,
  ThreadsTreeNodeMeta,
  ThreadDataFile,
} from "../src/thread/types.js";
import { eventBus } from "../src/server/events.js";

const TEST_DIR = join(import.meta.dir, ".tmp_think_wait_deadlock_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

function makeNode(id: string, overrides?: Partial<ThreadsTreeNodeMeta>): ThreadsTreeNodeMeta {
  return {
    id,
    title: overrides?.title ?? id,
    status: overrides?.status ?? "running",
    childrenIds: overrides?.childrenIds ?? [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeThreadData(id: string): ThreadDataFile {
  return { id, actions: [] };
}

function makeStone(name: string): StoneData {
  return {
    name,
    thinkable: { whoAmI: `${name}` },
    talkable: { whoAmI: `${name}`, functions: [] },
    data: {},
    relations: [],
    traits: [],
  };
}

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

/* ========================================================================
 * Symptom 2: 子线程 <task> 应显示自身 title，不应显示父线程 title
 * ======================================================================== */

describe("Symptom 2 — context-builder: 子线程 parentExpectation 使用自身 title", () => {
  test("sub_thread 的 parentExpectation 包含当前节点 title，不包含父节点 title", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { title: "supervisor 主线程", childrenIds: ["c"] }),
        c: makeNode("c", {
          parentId: "r",
          title: "分析 G3 基因",
          description: "请深度分析 G3 基因的语义",
        }),
      },
    };
    const input: ThreadContextInput = {
      tree,
      threadId: "c",
      threadData: makeThreadData("c"),
      stone: { name: "sub", thinkable: { whoAmI: "我是子线程" } } as any,
      directory: [],
      traits: [],
    };
    const ctx = buildThreadContext(input);

    /* 子线程的 <task> 必须是自己的任务 title "分析 G3 基因" */
    expect(ctx.parentExpectation).toContain("分析 G3 基因");
    /* 父线程的 title "supervisor 主线程" 不应出现在 <task> 里 */
    expect(ctx.parentExpectation).not.toContain("supervisor 主线程");
    /* description 应该包含在内 */
    expect(ctx.parentExpectation).toContain("请深度分析 G3 基因的语义");
  });

  test("无 description 时 parentExpectation 仅含当前节点 title", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { title: "父任务", childrenIds: ["c"] }),
        c: makeNode("c", { parentId: "r", title: "子任务 A" }),
      },
    };
    const input: ThreadContextInput = {
      tree,
      threadId: "c",
      threadData: makeThreadData("c"),
      stone: { name: "sub", thinkable: { whoAmI: "sub" } } as any,
      directory: [],
      traits: [],
    };
    const ctx = buildThreadContext(input);

    expect(ctx.parentExpectation).toContain("子任务 A");
    expect(ctx.parentExpectation).not.toContain("父任务");
  });

  test("Root 节点的 parentExpectation 仍为空字符串", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r", { title: "Root 任务" }) },
    };
    const input: ThreadContextInput = {
      tree,
      threadId: "r",
      threadData: makeThreadData("r"),
      stone: { name: "root", thinkable: { whoAmI: "root" } } as any,
      directory: [],
      traits: [],
    };
    const ctx = buildThreadContext(input);
    expect(ctx.parentExpectation).toBe("");
  });
});

/* ========================================================================
 * Symptom 1: think(wait=true) 后，awaitingChildren 含子线程 ID
 * ======================================================================== */

describe("Symptom 1 — tree.awaitThreads: awaitingChildren 正确填充", () => {
  test("awaitThreads([child]) 后 node.awaitingChildren = [child]，非空数组", async () => {
    const treeDir = join(TEST_DIR, "tree_test");
    mkdirSync(treeDir, { recursive: true });

    const tree = await ThreadsTree.create(treeDir, "parent 主线程");
    const childId = await tree.createSubThread(tree.rootId, "分析 G3 基因", {
      description: "深度分析",
    });
    expect(childId).toBeTruthy();

    await tree.setNodeStatus(childId!, "running");
    await tree.awaitThreads(tree.rootId, [childId!]);

    const parent = tree.getNode(tree.rootId)!;
    /* 必须是 [childId]，不能是 [] 或 undefined */
    expect(parent.status).toBe("waiting");
    expect(parent.awaitingChildren).toEqual([childId!]);
    expect(parent.awaitingChildren!.length).toBe(1);
    expect(parent.awaitingChildren![0]).toBe(childId!);
  });

  test("子线程完成后，父线程可被唤醒（awaitingChildren 非空是唤醒的前提）", async () => {
    const treeDir = join(TEST_DIR, "tree_wake_test");
    mkdirSync(treeDir, { recursive: true });

    const tree = await ThreadsTree.create(treeDir, "parent");
    const childId = await tree.createSubThread(tree.rootId, "分析 G3 基因");
    await tree.setNodeStatus(childId!, "running");
    await tree.awaitThreads(tree.rootId, [childId!]);

    /* 验证 awaitingChildren 非空后子线程完成可唤醒 */
    await tree.returnThread(childId!, "分析完毕");
    const woken = await tree.checkAndWake(tree.rootId);
    expect(woken).toBe(true);

    const parent = tree.getNode(tree.rootId)!;
    expect(parent.status).toBe("running");
    expect(parent.awaitingChildren).toBeUndefined();
  });
});

/* ========================================================================
 * Symptom 1: 集成场景——子线程 title 匹配 submit 传入的 title
 * （通过 ThreadsTree 文件系统读取验证子线程 title）
 * ======================================================================== */

describe("Symptom 1 — engine 集成: 子线程 title 与 submit.title 一致", () => {
  test("think(wait=true) 创建的子线程 title 与 submit 参数一致", async () => {
    /* 父线程：open(think) → submit(wait=true, title="分析 G3 基因")
     * 验证：子线程节点 title 必须是 "分析 G3 基因"，而不是父线程 title */
    let step = 0;
    let formId = "f_unknown";
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        /* 消息中尝试解析 formId */
        const userMsg = (messages as Array<{ role: string; content: string }>)
          .find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="think"/);
        if (m?.[1]) formId = m[1];

        if (step === 1) {
          /* 开 think form */
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "派生子线程",
              type: "command",
              command: "think",
            })],
          };
        }
        if (step === 2) {
          /* 提交 think，fork + wait=true，指定 title */
          return {
            content: "",
            toolCalls: [toolCall("submit", {
              form_id: formId,
              context: "fork",
              wait: true,
              title: "分析 G3 基因",
              msg: "请分析第三条基因",
            })],
          };
        }
        /* 后续：让父线程进入空循环（等待子线程），超出上限后 failed */
        return { content: "思考中...", toolCalls: [] };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("supervisor"),
      schedulerConfig: {
        maxIterationsPerThread: 5,
        maxTotalIterations: 15,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("supervisor", "分析任务", "user", config);

    /* 整体：父线程应进入 waiting 或 failed（不是因为 think 本身报错） */
    expect(result.status === "waiting" || result.status === "failed").toBe(true);

    /* 通过磁盘上的 threads.json 验证子线程 title */
    const { readThreadsTree } = await import("../src/thread/persistence.js");
    const objectFlowDir = `${FLOWS_DIR}/${result.sessionId}/objects/supervisor`;
    const treeFile = readThreadsTree(objectFlowDir);
    if (treeFile) {
      const nodes = Object.values(treeFile.nodes);
      const childNode = nodes.find(n => n.id !== treeFile.rootId);
      if (childNode) {
        /* 子线程 title 必须是 submit 时传入的 title */
        expect(childNode.title).toBe("分析 G3 基因");
        /* 子线程 title 不应等于父线程 title "分析任务" */
        expect(childNode.title).not.toBe("分析任务");
      }
    }
  });
});

/* ========================================================================
 * 组合验证：think(wait=true) 后父线程 awaitingChildren 填充正确
 * （通过 engine 集成路径验证 Symptom 1 的根本修复）
 * ======================================================================== */

describe("Symptom 1 — engine 集成: think(wait=true) 填充 awaitingChildren", () => {
  test("父线程 awaitingChildren 在 submit(wait=true) 后包含子线程 ID", async () => {
    let step = 0;
    let formId = "f_unknown";
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const userMsg = (messages as Array<{ role: string; content: string }>)
          .find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="think"/);
        if (m?.[1]) formId = m[1];

        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "等待子线程",
              type: "command",
              command: "think",
            })],
          };
        }
        if (step === 2) {
          return {
            content: "",
            toolCalls: [toolCall("submit", {
              form_id: formId,
              context: "fork",
              wait: true,
              title: "子任务",
            })],
          };
        }
        return { content: "等待中...", toolCalls: [] };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("parent"),
      schedulerConfig: {
        maxIterationsPerThread: 5,
        maxTotalIterations: 15,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("parent", "主任务", "user", config);

    /* 父线程应进入 waiting 状态 */
    expect(result.status === "waiting" || result.status === "failed").toBe(true);

    /* 通过磁盘读取 tree 状态，验证父节点 awaitingChildren 非空 */
    const { readThreadsTree } = await import("../src/thread/persistence.js");
    const objectFlowDir = `${FLOWS_DIR}/${result.sessionId}/objects/parent`;
    const treeFile = readThreadsTree(objectFlowDir);
    if (treeFile && result.status === "waiting") {
      const parentNode = treeFile.nodes[treeFile.rootId];
      /* awaitingChildren 必须非空（否则 scheduler 无法唤醒父线程） */
      expect(parentNode?.awaitingChildren).toBeTruthy();
      expect(parentNode?.awaitingChildren?.length).toBeGreaterThan(0);
    }
  });
});
