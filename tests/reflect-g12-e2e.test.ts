/**
 * ReflectFlow 方案 B — G12 闭环 E2E 集成测试（Phase 5）
 *
 * G12（经验沉淀循环）四步：
 *   经历 → 记录（talkToSelf） → 沉淀（persist_to_memory） → 改变下次 Context（memory 注入）
 *
 * 本文件用**不走 LLM** 的直调方式验证两条路径：
 *
 * **路径 A — 主线程直接沉淀**：
 *   主线程调 reflect_flow.persist_to_memory → memory.md 写入 →
 *   下一次 buildThreadContext（含 paths.stoneDir）的 knowledge 区段含 `name=memory` 窗口
 *
 * **路径 B — 反思线程经调度触发沉淀**：
 *   主线程调 talkToSelf → reflect 线程 inbox 落盘 →
 *   ReflectScheduler.triggerReflect → 注入的 runner（模拟反思线程 ThinkLoop 的结果）
 *   调 persist_to_memory → memory.md 写入 →
 *   下一次 buildThreadContext 的 knowledge 区段含新经验
 *
 * 这两条路径共同验证：**方案 B 的整个闭环数据流（talkToSelf → reflect.ts →
 * Scheduler → 沉淀工具 → memory.md → context-builder）跑通**。
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_ReflectFlow方案B.md
 * @ref docs/哲学文档/gene.md#G12 — 经验沉淀循环
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildThreadContext } from "../src/thread/context-builder.js";
import { ThreadsTree } from "../src/thread/tree.js";
import { ReflectScheduler } from "../src/thread/reflect-scheduler.js";
import { talkToReflect } from "../src/thread/reflect.js";
import type { StoneData } from "../src/types/index.js";
import type { ThreadsTreeFile } from "../src/thread/types.js";

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

function snapshot(tree: ThreadsTree): ThreadsTreeFile {
  const nodes: ThreadsTreeFile["nodes"] = {};
  for (const nodeId of tree.nodeIds) {
    const node = tree.getNode(nodeId);
    if (node) nodes[nodeId] = node;
  }
  return { rootId: tree.rootId, nodes };
}

const TEST_DIR = join(tmpdir(), `ooc-reflect-g12-test-${Date.now().toString(36)}`);

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("G12 闭环 — 路径 A：主线程直接沉淀", () => {
  test("persist_to_memory → 下一次 Context 含新经验", async () => {
    const stoneDir = join(TEST_DIR, "stones", "bruce");
    mkdirSync(stoneDir, { recursive: true });

    /* 1. 主线程沙箱里直调 persist_to_memory */
    const mod: any = await import("../traits/reflective/super/index.js");
    const ctx = { selfDir: stoneDir, stoneName: "bruce" };
    const result: any = await mod.llm_methods.persist_to_memory.fn(ctx, {
      key: "调试新 API 的姿势",
      content: "先看 server 日志，确认 request 到达后再排查后端逻辑；前端报错未必是前端 bug。",
    });
    expect(result.ok).toBe(true);

    /* 2. memory.md 落盘 */
    const memoryPath = join(stoneDir, "memory.md");
    expect(existsSync(memoryPath)).toBe(true);

    /* 3. 构造一个主线程的 Context，验证 memory 窗口被注入 */
    const flowDir = join(TEST_DIR, "bruce-flow");
    mkdirSync(flowDir, { recursive: true });
    const tree = await ThreadsTree.create(flowDir, "bruce 主线程", "测试 G12 A 路径");

    const ctxBuilt = buildThreadContext({
      tree: snapshot(tree),
      threadId: tree.rootId,
      threadData: tree.readThreadData(tree.rootId)!,
      stone: makeStone("bruce"),
      directory: [],
      traits: [],
      paths: { stoneDir },
    });

    const mem = ctxBuilt.knowledge.find((w) => w.name === "memory");
    expect(mem).toBeDefined();
    expect(mem!.content).toContain("调试新 API 的姿势");
    expect(mem!.content).toContain("先看 server 日志");
  });
});

describe("G12 闭环 — 路径 B：反思线程经调度触发沉淀", () => {
  test("talkToSelf → Scheduler → runner(persist_to_memory) → 下次 Context 含新经验", async () => {
    const stoneDir = join(TEST_DIR, "stones", "bruce");
    mkdirSync(stoneDir, { recursive: true });

    /* 模拟 runner：当 scheduler 触发反思时，调 persist_to_memory 把 inbox 消息
     * 沉淀为经验，并把 inbox 标为已处理。
     *
     * 真实场景是 runner 跑 LLM → LLM 决定是否调 persist_to_memory；这里用直接调
     * 短路，验证调度 → 沉淀的管道连通。 */
    const mod: any = await import("../traits/reflective/super/index.js");

    const scheduler = new ReflectScheduler(async ({ stoneDir: sd, stoneName, tree }) => {
      const data = tree.readThreadData(tree.rootId);
      const unread = (data?.inbox ?? []).filter((m) => m.status === "unread");
      for (const msg of unread) {
        /* 用消息内容作为经验 */
        await mod.llm_methods.persist_to_memory.fn(
          { selfDir: sd, stoneName },
          {
            key: `来自 ${msg.from} 的反思`,
            content: msg.content,
          },
        );
        /* 标为已处理（ack） */
        tree.markInbox(tree.rootId, msg.id, "ack", "runner 已沉淀为 memory");
      }
    });

    scheduler.register("bruce", stoneDir);

    /* 1. 主线程 talkToSelf → inbox 落盘 */
    await talkToReflect(stoneDir, "bruce", "bruce 学到：在调 shell 工具前先用 type 查证命令存在");

    /* 2. Scheduler trigger → runner 执行 → persist_to_memory 写 memory.md */
    await scheduler.triggerReflect("bruce");

    /* 3. memory.md 包含经验 */
    const memoryPath = join(stoneDir, "memory.md");
    expect(existsSync(memoryPath)).toBe(true);
    const memContent = readFileSync(memoryPath, "utf-8");
    expect(memContent).toContain("来自 bruce 的反思");
    expect(memContent).toContain("type 查证命令存在");

    /* 4. 下一次主线程 Context 含 memory 窗口 */
    const flowDir = join(TEST_DIR, "bruce-flow");
    mkdirSync(flowDir, { recursive: true });
    const tree = await ThreadsTree.create(flowDir, "bruce 主线程", "新任务");

    const builtCtx = buildThreadContext({
      tree: snapshot(tree),
      threadId: tree.rootId,
      threadData: tree.readThreadData(tree.rootId)!,
      stone: makeStone("bruce"),
      directory: [],
      traits: [],
      paths: { stoneDir },
    });
    const mem = builtCtx.knowledge.find((w) => w.name === "memory");
    expect(mem).toBeDefined();
    expect(mem!.content).toContain("type 查证命令存在");
  });

  test("多次 talkToSelf 经一次 scanAll 都被沉淀", async () => {
    const stoneDir = join(TEST_DIR, "stones", "bruce");
    mkdirSync(stoneDir, { recursive: true });
    const mod: any = await import("../traits/reflective/super/index.js");

    const scheduler = new ReflectScheduler(async ({ stoneDir: sd, stoneName, tree }) => {
      const data = tree.readThreadData(tree.rootId);
      for (const msg of (data?.inbox ?? []).filter((m) => m.status === "unread")) {
        await mod.llm_methods.persist_to_memory.fn(
          { selfDir: sd, stoneName },
          { key: `经验 ${msg.id.slice(-4)}`, content: msg.content },
        );
        tree.markInbox(tree.rootId, msg.id, "ack", "done");
      }
    });

    scheduler.register("bruce", stoneDir);

    await talkToReflect(stoneDir, "bruce", "第一条");
    await talkToReflect(stoneDir, "bruce", "第二条");
    await talkToReflect(stoneDir, "bruce", "第三条");

    await scheduler.scanAll();

    const memContent = readFileSync(join(stoneDir, "memory.md"), "utf-8");
    expect(memContent).toContain("第一条");
    expect(memContent).toContain("第二条");
    expect(memContent).toContain("第三条");
  });
});
