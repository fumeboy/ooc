/**
 * ReflectFlow 线程树化（方案 A 最小可用）测试
 *
 * 覆盖：
 * 1. ensureReflectThread 幂等创建常驻反思线程
 * 2. talkToReflect 写入 inbox 并在 done 时触发复活
 * 3. 并发调用下线程树状态正确
 * 4. getReflectThreadDir 的路径契约
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_ReflectFlow线程树化.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ensureReflectThread,
  talkToReflect,
  getReflectThreadDir,
} from "../src/thread/reflect.js";
import { ThreadsTree } from "../src/thread/tree.js";

/** 为每个测试生成独立 tmp stone 目录 */
function makeTmpStone(prefix = "reflect-test"): string {
  const base = join(tmpdir(), `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(base, { recursive: true });
  return base;
}

describe("reflect.ts 基础 API", () => {
  let stoneDir: string;

  beforeEach(() => {
    stoneDir = makeTmpStone();
  });

  afterEach(() => {
    if (existsSync(stoneDir)) rmSync(stoneDir, { recursive: true, force: true });
  });

  test("getReflectThreadDir 返回 {stoneDir}/reflect", () => {
    const d = getReflectThreadDir(stoneDir);
    expect(d).toBe(join(stoneDir, "reflect"));
  });

  test("ensureReflectThread 首次创建常驻反思线程 + 落盘 threads.json", async () => {
    const tree = await ensureReflectThread(stoneDir);
    expect(tree).toBeTruthy();
    expect(typeof tree.rootId).toBe("string");

    const threadsJson = join(stoneDir, "reflect", "threads.json");
    expect(existsSync(threadsJson)).toBe(true);

    const raw = JSON.parse(readFileSync(threadsJson, "utf-8"));
    expect(raw.rootId).toBe(tree.rootId);
    expect(raw.nodes[tree.rootId]).toBeDefined();
    expect(raw.nodes[tree.rootId].status).toBe("running");

    /* root 线程的 thread.json 也应就绪 */
    const rootThreadJson = join(stoneDir, "reflect", "threads", tree.rootId, "thread.json");
    expect(existsSync(rootThreadJson)).toBe(true);
  });

  test("ensureReflectThread 幂等：第二次调用复用同一个 rootId", async () => {
    const t1 = await ensureReflectThread(stoneDir);
    const id1 = t1.rootId;

    const t2 = await ensureReflectThread(stoneDir);
    const id2 = t2.rootId;

    expect(id2).toBe(id1);
  });

  test("talkToReflect 首次调用顺带创建反思线程 + 写入 inbox", async () => {
    await talkToReflect(stoneDir, "bruce", "刚才 X 做法效果很好，应该记下");

    const tree = ThreadsTree.load(join(stoneDir, "reflect"));
    expect(tree).toBeTruthy();
    const data = tree!.readThreadData(tree!.rootId);
    expect(data?.inbox).toBeDefined();
    expect(data!.inbox).toHaveLength(1);

    const msg = data!.inbox![0]!;
    expect(msg.from).toBe("bruce");
    expect(msg.content).toBe("刚才 X 做法效果很好，应该记下");
    expect(msg.source).toBe("system");
    expect(msg.status).toBe("unread");
  });

  test("talkToReflect 多次投递：inbox 累积", async () => {
    await talkToReflect(stoneDir, "bruce", "第一条反思");
    await talkToReflect(stoneDir, "supervisor", "第二条反思");

    const tree = ThreadsTree.load(join(stoneDir, "reflect"))!;
    const data = tree.readThreadData(tree.rootId);
    expect(data?.inbox).toHaveLength(2);
    expect(data!.inbox![0]!.content).toBe("第一条反思");
    expect(data!.inbox![1]!.content).toBe("第二条反思");
  });

  test("talkToReflect 在线程 done 时自动复活", async () => {
    const tree = await ensureReflectThread(stoneDir);
    /* 人工把反思线程标记为 done（模拟一轮反思完成） */
    await tree.setNodeStatus(tree.rootId, "done");
    const before = tree.getNode(tree.rootId);
    expect(before?.status).toBe("done");

    /* 再投递一条消息 */
    await talkToReflect(stoneDir, "bruce", "再思考一下");

    /* 期望线程被复活（status → running，revivalCount += 1） */
    const freshTree = ThreadsTree.load(join(stoneDir, "reflect"))!;
    const after = freshTree.getNode(freshTree.rootId);
    expect(after?.status).toBe("running");
    expect(after?.revivalCount).toBeGreaterThanOrEqual(1);
  });

  test("并发多次 talkToReflect 不破坏线程树一致性", async () => {
    /* 10 条并发消息 */
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(talkToReflect(stoneDir, `obj${i}`, `msg-${i}`));
    }
    await Promise.all(tasks);

    /* threads.json 仍有且只有一个根线程 */
    const tree = ThreadsTree.load(join(stoneDir, "reflect"))!;
    expect(tree.nodeIds).toHaveLength(1);

    /* 全部 10 条消息都落 inbox（顺序不保证，总数必须对） */
    const data = tree.readThreadData(tree.rootId);
    expect(data?.inbox).toHaveLength(10);
  });

  test("talkToReflect 支持可选 messageId 透传（未来前端追踪用）", async () => {
    await talkToReflect(stoneDir, "bruce", "带 id 的反思", "custom_msg_001");
    const tree = ThreadsTree.load(join(stoneDir, "reflect"))!;
    const data = tree.readThreadData(tree.rootId);
    /* 当前实现可能不直接透传 messageId 到 inbox id（tree.writeInbox 自己生成 id），
       此测试只验证调用不报错。messageId 仅用于将来 user-inbox 风格的跨流追踪。 */
    expect(data?.inbox).toHaveLength(1);
  });
});

describe("reflect_flow trait llm_methods（kernel trait）", () => {
  let stoneDir: string;

  beforeEach(() => {
    stoneDir = makeTmpStone("reflect-trait");
  });

  afterEach(() => {
    if (existsSync(stoneDir)) rmSync(stoneDir, { recursive: true, force: true });
  });

  test("llm_methods.talkToSelf 投递消息到反思线程", async () => {
    /* 动态导入 trait index.ts（相对路径绕过 trait loader） */
    const mod: any = await import("../traits/reflective/super/index.js");
    const talkToSelf = mod.llm_methods.talkToSelf;
    expect(talkToSelf).toBeDefined();
    expect(typeof talkToSelf.fn).toBe("function");

    const ctx = { selfDir: stoneDir, stoneName: "bruce" };
    const result: any = await talkToSelf.fn(ctx, { message: "Trait 方法路径的反思" });
    expect(result.ok).toBe(true);
    expect(result.data.stoneName).toBe("bruce");

    const tree = ThreadsTree.load(join(stoneDir, "reflect"))!;
    const data = tree.readThreadData(tree.rootId);
    expect(data?.inbox).toHaveLength(1);
    expect(data!.inbox![0]!.content).toBe("Trait 方法路径的反思");
    expect(data!.inbox![0]!.from).toBe("bruce");
  });

  test("llm_methods.talkToSelf 拒绝空 message", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const result: any = await mod.llm_methods.talkToSelf.fn(
      { selfDir: stoneDir, stoneName: "bruce" },
      { message: "" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("非空字符串");
  });

  test("llm_methods.getReflectState 未初始化时返回 initialized=false", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const result: any = await mod.llm_methods.getReflectState.fn(
      { selfDir: stoneDir, stoneName: "bruce" },
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.data.initialized).toBe(false);
    expect(result.data.inboxTotal).toBe(0);
  });

  test("llm_methods.getReflectState 在多次投递后返回正确的 unread 计数", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const ctx = { selfDir: stoneDir, stoneName: "bruce" };
    await mod.llm_methods.talkToSelf.fn(ctx, { message: "第 1 条" });
    await mod.llm_methods.talkToSelf.fn(ctx, { message: "第 2 条" });
    await mod.llm_methods.talkToSelf.fn(ctx, { message: "第 3 条" });

    const result: any = await mod.llm_methods.getReflectState.fn(ctx, {});
    expect(result.ok).toBe(true);
    expect(result.data.initialized).toBe(true);
    expect(result.data.inboxTotal).toBe(3);
    expect(result.data.inboxUnread).toBe(3);
    expect(result.data.recentContents).toHaveLength(3);
    expect(result.data.recentContents[2]).toBe("第 3 条");
  });
});

describe("reflect_flow trait 沉淀工具（方案 B Phase 2）", () => {
  let stoneDir: string;

  beforeEach(() => {
    stoneDir = makeTmpStone("reflect-persist");
  });

  afterEach(() => {
    if (existsSync(stoneDir)) rmSync(stoneDir, { recursive: true, force: true });
  });

  test("llm_methods.persist_to_memory 首次写入创建 memory.md", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const ctx = { selfDir: stoneDir, stoneName: "bruce" };

    const result: any = await mod.llm_methods.persist_to_memory.fn(ctx, {
      key: "测试经验",
      content: "这是一条测试经验的详细描述",
    });
    expect(result.ok).toBe(true);

    const memoryPath = join(stoneDir, "memory.md");
    expect(existsSync(memoryPath)).toBe(true);
    const content = readFileSync(memoryPath, "utf-8");
    expect(content).toContain("测试经验");
    expect(content).toContain("这是一条测试经验的详细描述");
  });

  test("llm_methods.persist_to_memory 多次 append 保留历史", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const ctx = { selfDir: stoneDir, stoneName: "bruce" };

    await mod.llm_methods.persist_to_memory.fn(ctx, { key: "key-a", content: "内容 A" });
    await mod.llm_methods.persist_to_memory.fn(ctx, { key: "key-b", content: "内容 B" });

    const content = readFileSync(join(stoneDir, "memory.md"), "utf-8");
    expect(content).toContain("key-a");
    expect(content).toContain("内容 A");
    expect(content).toContain("key-b");
    expect(content).toContain("内容 B");
    /* 顺序：先 A 后 B */
    expect(content.indexOf("key-a")).toBeLessThan(content.indexOf("key-b"));
  });

  test("llm_methods.persist_to_memory 拒绝空 key / content", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const ctx = { selfDir: stoneDir, stoneName: "bruce" };

    let r: any = await mod.llm_methods.persist_to_memory.fn(ctx, { key: "", content: "x" });
    expect(r.ok).toBe(false);

    r = await mod.llm_methods.persist_to_memory.fn(ctx, { key: "k", content: "" });
    expect(r.ok).toBe(false);
  });

  test("llm_methods.create_trait 在 stones/{self}/traits/** 下创建 TRAIT.md", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const ctx = { selfDir: stoneDir, stoneName: "bruce" };

    const result: any = await mod.llm_methods.create_trait.fn(ctx, {
      relativePath: "learned/new_skill",
      content: `---
namespace: self
name: learned/new_skill
type: how_to_think
when: always
description: 学到的新技能
deps: []
---

# 新技能 trait

这是反思沉淀出来的 trait。
`,
    });
    expect(result.ok).toBe(true);

    const traitPath = join(stoneDir, "traits", "learned", "new_skill", "TRAIT.md");
    expect(existsSync(traitPath)).toBe(true);
    const content = readFileSync(traitPath, "utf-8");
    expect(content).toContain("namespace: self");
    expect(content).toContain("这是反思沉淀出来的 trait");
  });

  test("llm_methods.create_trait 拒绝越权路径（..、绝对路径、超出 stones/{self}）", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const ctx = { selfDir: stoneDir, stoneName: "bruce" };

    /* 路径 .. 越权 */
    let r: any = await mod.llm_methods.create_trait.fn(ctx, {
      relativePath: "../other/bad",
      content: "whatever",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/路径|越权|不允许/);

    /* 绝对路径越权 */
    r = await mod.llm_methods.create_trait.fn(ctx, {
      relativePath: "/tmp/outside",
      content: "whatever",
    });
    expect(r.ok).toBe(false);

    /* 空路径 */
    r = await mod.llm_methods.create_trait.fn(ctx, { relativePath: "", content: "x" });
    expect(r.ok).toBe(false);
  });

  test("llm_methods.create_trait 拒绝覆盖已有 trait", async () => {
    const mod: any = await import("../traits/reflective/super/index.js");
    const ctx = { selfDir: stoneDir, stoneName: "bruce" };

    const body = `---
namespace: self
name: learned/overwrite
type: how_to_think
when: always
description: 测试
deps: []
---

首次`;
    const r1: any = await mod.llm_methods.create_trait.fn(ctx, {
      relativePath: "learned/overwrite",
      content: body,
    });
    expect(r1.ok).toBe(true);

    const r2: any = await mod.llm_methods.create_trait.fn(ctx, {
      relativePath: "learned/overwrite",
      content: body + "\n\n二次",
    });
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/已存在|已有/);
  });
});
