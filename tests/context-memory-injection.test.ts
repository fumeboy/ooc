/**
 * Context memory.md 注入测试（SuperFlow 沿用原方案 B Phase 3 行为）
 *
 * 验证 buildThreadContext 在 paths.stoneDir 指向的目录下读到 memory.md 时，
 * 把其内容作为独立 knowledge 窗口注入，供 LLM 在下一次 Context 中读到。
 * memory.md 由 super 线程通过 reflective/super.persist_to_memory 写入。
 *
 * @ref docs/工程管理/迭代/all/20260422_refactor_SuperFlow转型.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildThreadContext } from "../src/thinkable/context/builder.js";
import { ThreadsTree } from "../src/thread/tree.js";
import type { StoneData } from "../src/types/index.js";
import type { ThreadsTreeFile } from "../src/thread/types.js";

/** 把 ThreadsTree 转为 snapshot（与 engine 里的 buildTreeFileSnapshot 等价） */
function snapshot(tree: ThreadsTree): ThreadsTreeFile {
  const nodes: ThreadsTreeFile["nodes"] = {};
  for (const nodeId of tree.nodeIds) {
    const node = tree.getNode(nodeId);
    if (node) nodes[nodeId] = node;
  }
  return { rootId: tree.rootId, nodes };
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

const TEST_DIR = join(tmpdir(), `ooc-ctx-memory-test-${Date.now().toString(36)}`);

async function createTree(name: string): Promise<{ tree: ThreadsTree; flowDir: string }> {
  const flowDir = join(TEST_DIR, `${name}-flow`);
  mkdirSync(flowDir, { recursive: true });
  const tree = await ThreadsTree.create(flowDir, `${name} 主线程`, "初始消息");
  return { tree, flowDir };
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("buildThreadContext - memory.md 注入", () => {
  test("存在 memory.md 时，knowledge 区段包含 name=memory 的窗口", async () => {
    const { tree } = await createTree("bruce");
    const stoneDir = join(TEST_DIR, "stones", "bruce");
    mkdirSync(stoneDir, { recursive: true });
    writeFileSync(join(stoneDir, "memory.md"), "## 经验 A\n\n内容 A\n", "utf-8");

    const ctx = buildThreadContext({
      tree: snapshot(tree),
      threadId: tree.rootId,
      threadData: tree.readThreadData(tree.rootId)!,
      stone: makeStone("bruce"),
      directory: [],
      traits: [],
      paths: { stoneDir },
    });

    const mem = ctx.knowledge.find(w => w.name === "memory");
    expect(mem).toBeDefined();
    expect(mem!.content).toContain("## 经验 A");
    expect(mem!.content).toContain("内容 A");
  });

  test("memory.md 不存在时，knowledge 区段不注入", async () => {
    const { tree } = await createTree("bruce");
    const stoneDir = join(TEST_DIR, "stones", "bruce");
    mkdirSync(stoneDir, { recursive: true });
    /* 不写 memory.md */

    const ctx = buildThreadContext({
      tree: snapshot(tree),
      threadId: tree.rootId,
      threadData: tree.readThreadData(tree.rootId)!,
      stone: makeStone("bruce"),
      directory: [],
      traits: [],
      paths: { stoneDir },
    });

    const mem = ctx.knowledge.find(w => w.name === "memory");
    expect(mem).toBeUndefined();
  });

  test("paths.stoneDir 缺失时不报错，也不注入 memory", async () => {
    const { tree } = await createTree("bruce");

    const ctx = buildThreadContext({
      tree: snapshot(tree),
      threadId: tree.rootId,
      threadData: tree.readThreadData(tree.rootId)!,
      stone: makeStone("bruce"),
      directory: [],
      traits: [],
      /* 没有 paths */
    });

    const mem = ctx.knowledge.find(w => w.name === "memory");
    expect(mem).toBeUndefined();
  });

  test("memory.md 超大时截断到上限（防 Context 膨胀）", async () => {
    const { tree } = await createTree("bruce");
    const stoneDir = join(TEST_DIR, "stones", "bruce");
    mkdirSync(stoneDir, { recursive: true });
    const big = "## 经验\n\n" + "x".repeat(5000) + "\n";
    writeFileSync(join(stoneDir, "memory.md"), big, "utf-8");

    const ctx = buildThreadContext({
      tree: snapshot(tree),
      threadId: tree.rootId,
      threadData: tree.readThreadData(tree.rootId)!,
      stone: makeStone("bruce"),
      directory: [],
      traits: [],
      paths: { stoneDir },
    });

    const mem = ctx.knowledge.find(w => w.name === "memory");
    expect(mem).toBeDefined();
    /* 严格来说截断上限 4000 字符 + 前缀说明；放宽到 4200 覆盖前缀余量 */
    expect(mem!.content.length).toBeLessThanOrEqual(4200);
    /* 内容确实被截断：原文 5000+ 字符，Context 中 < 5000 */
    expect(mem!.content.length).toBeLessThan(5000);
  });
});
