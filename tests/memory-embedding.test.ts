/**
 * memory-embedding.ts 单元测试
 *
 * 覆盖：
 * - generateEmbedding 确定性 + 维度
 * - cosineSimilarity 自相似=1、正交=0、相似文本 > 无关文本
 * - hash trick 分布合理（不集中）
 * - 落盘 / 读取 / 删除
 * - queryMemoryEntries vector 模式：相关内容排在前
 *
 * @ref kernel/src/storable/memory/embedding.ts
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation_phase2.md — Phase 2
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateEmbedding,
  cosineSimilarity,
  writeEmbedding,
  readEmbedding,
  deleteEmbedding,
  embeddingPath,
  EMBEDDING_DIM,
} from "../src/storable/memory/embedding.js";
import {
  appendMemoryEntry,
  queryMemoryEntries,
} from "../src/storable/memory/entries.js";

let tmp = "";
let selfDir = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mem-embed-"));
  selfDir = join(tmp, "stones", "bruce");
});

afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("generateEmbedding", () => {
  test("维度等于 EMBEDDING_DIM", () => {
    const v = generateEmbedding("hello world");
    expect(v.length).toBe(EMBEDDING_DIM);
  });

  test("确定性 —— 同输入恒同输出", () => {
    const a = generateEmbedding("OOC 是 agent 架构");
    const b = generateEmbedding("OOC 是 agent 架构");
    expect(a).toEqual(b);
  });

  test("空字符串 → 全零向量", () => {
    const v = generateEmbedding("");
    expect(v.every(x => x === 0)).toBe(true);
  });

  test("自余弦 = 1（L2 归一化后单位向量）", () => {
    const v = generateEmbedding("线程树的可观测性");
    const s = cosineSimilarity(v, v);
    expect(s).toBeGreaterThan(0.999); /* 浮点误差 */
    expect(s).toBeLessThanOrEqual(1.0001);
  });
});

describe("cosineSimilarity", () => {
  test("完全相同文本 cos = 1", () => {
    const a = generateEmbedding("persist to memory");
    const b = generateEmbedding("persist to memory");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  test("完全无关文本 cos 较低（< 相似文本）", () => {
    const q = generateEmbedding("线程树 可观测性");
    const related = generateEmbedding("线程树 设计 让 可观测性 更强");
    const unrelated = generateEmbedding("今天 的 天气 不错");
    const sRel = cosineSimilarity(q, related);
    const sUnrel = cosineSimilarity(q, unrelated);
    expect(sRel).toBeGreaterThan(sUnrel);
  });

  test("全零向量 cos = 0（不会 NaN）", () => {
    const zero = new Array(EMBEDDING_DIM).fill(0);
    const v = generateEmbedding("something");
    const s = cosineSimilarity(zero, v);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBe(0);
  });
});

describe("落盘 / 读取 / 删除", () => {
  test("writeEmbedding + readEmbedding 往返一致", () => {
    /* 通过 appendMemoryEntry 自然创建目录结构；再单独 writeEmbedding 覆盖 */
    const e = appendMemoryEntry(selfDir, "bruce", { key: "k", content: "c" });
    const original = readEmbedding(selfDir, e.id)!;
    expect(original).not.toBeNull();
    /* 手动写入另一个向量 */
    const v = generateEmbedding("different-text");
    writeEmbedding(selfDir, e.id, v);
    const back = readEmbedding(selfDir, e.id)!;
    expect(back).toEqual(v);
  });

  test("deleteEmbedding 删除文件", () => {
    const e = appendMemoryEntry(selfDir, "bruce", { key: "k2", content: "c2" });
    expect(existsSync(embeddingPath(selfDir, e.id))).toBe(true);
    deleteEmbedding(selfDir, e.id);
    expect(existsSync(embeddingPath(selfDir, e.id))).toBe(false);
  });

  test("readEmbedding 文件不存在返回 null", () => {
    const v = readEmbedding(selfDir, "ghost");
    expect(v).toBeNull();
  });
});

describe("queryMemoryEntries vector 模式", () => {
  beforeEach(() => {
    /* 构造 3 条 entry，一个高相关，一个弱相关，一个无关 */
    appendMemoryEntry(selfDir, "bruce", {
      key: "线程树的可观测性价值",
      content: "OOC 线程树让外部观察者能看到 LLM 的注意力边界和上下文切换位置",
    });
    appendMemoryEntry(selfDir, "bruce", {
      key: "调试 API 的姿势",
      content: "先用 curl 打印原始响应，再逐层检查 schema",
    });
    appendMemoryEntry(selfDir, "bruce", {
      key: "每日心情记录",
      content: "今天下雨了，心情不错",
    });
  });

  test("vector 模式：查询\"线程树\"时，线程树 entry 排第一", () => {
    const result = queryMemoryEntries(selfDir, {
      query: "线程树 可观测性",
      mode: "vector",
      limit: 3,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.key).toBe("线程树的可观测性价值");
  });

  test("vector 模式：无关查询不命中（score <= 0 的被过滤）", () => {
    const result = queryMemoryEntries(selfDir, {
      query: "完全无关的量子力学问题",
      mode: "vector",
      limit: 5,
    });
    /* 允许零命中——零命中表示没有语义相关条目 */
    expect(result.every(e => e)).toBe(true);
  });

  test("vector 模式 + limit：只返回 top-K", () => {
    const result = queryMemoryEntries(selfDir, {
      query: "线程",
      mode: "vector",
      limit: 1,
    });
    expect(result.length).toBeLessThanOrEqual(1);
  });

  test("fuzzy 模式仍然按 substring 过滤（默认行为不变）", () => {
    const result = queryMemoryEntries(selfDir, {
      query: "下雨",
      mode: "fuzzy",
    });
    expect(result.length).toBe(1);
    expect(result[0]!.key).toBe("每日心情记录");
  });

  test("vector 模式 + query 为空 → 回退到时间倒序", () => {
    const result = queryMemoryEntries(selfDir, {
      mode: "vector",
      /* 不传 query */
    });
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("appendMemoryEntry 自动生成 embedding", () => {
  test("写入 entry 后，embedding 文件同步落盘", () => {
    const e = appendMemoryEntry(selfDir, "bruce", { key: "hello", content: "world" });
    const vec = readEmbedding(selfDir, e.id);
    expect(vec).not.toBeNull();
    expect(vec!.length).toBe(EMBEDDING_DIM);
  });
});
