/**
 * reflective/super 沉淀工具单元测试
 *
 * 覆盖范围：
 * 1. persist_to_memory 基本 append 行为
 * 2. 行号前缀污染的 sanity check（bugfix 2026-04-22）
 *    - 整段带 `NN | ` 前缀时剥离
 *    - 纯文本不受影响
 *    - 非连续行号不误伤（保留原文）
 * 3. create_trait 同样走 sanity check（保持一致）
 * 4. stripLineNumberPrefix 单独的单元测试
 *
 * @ref docs/工程管理/迭代/all/20260422_bugfix_memory行号污染.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  llm_methods,
  stripLineNumberPrefix,
} from "../traits/reflective/super/index.js";

function makeTmpRoot(prefix = "super-persist-test"): string {
  const base = join(
    tmpdir(),
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(base, { recursive: true });
  return base;
}

describe("stripLineNumberPrefix — 行号前缀剥离", () => {
  test("整段都是 `NN | xxx` 格式 → 剥离所有前缀", () => {
    const polluted = [
      "  1 | # 标题",
      "  2 | ",
      "  3 | 内容行 A",
      "  4 | 内容行 B",
    ].join("\n");
    const cleaned = stripLineNumberPrefix(polluted);
    expect(cleaned).toBe(["# 标题", "", "内容行 A", "内容行 B"].join("\n"));
  });

  test("单行行号前缀 → 剥离", () => {
    expect(stripLineNumberPrefix("42 | hello")).toBe("hello");
  });

  test("纯文本 → 保持不变", () => {
    const raw = "# 标题\n\n这是一条经验记录。\n";
    expect(stripLineNumberPrefix(raw)).toBe(raw);
  });

  test("非连续行号（只有部分行带前缀） → 保持不变（不误伤）", () => {
    const mixed = [
      "这是一条笔记",
      "  1 | 提到了某段代码",
      "继续写",
    ].join("\n");
    expect(stripLineNumberPrefix(mixed)).toBe(mixed);
  });

  test("markdown 表格里带 pipe 的数字行 → 保持不变", () => {
    const table = [
      "| 编号 | 描述 |",
      "| --- | --- |",
      "| 1 | 首行 |",
      "| 2 | 次行 |",
    ].join("\n");
    /* 表格行是 `| 1 | 首行 |`——leading whitespace 为空，正则要求 `\s*\d+\s*\|` 开头，
       会匹配到 `| 1 | ...`？否——正则 `^\s*\d+\s*\|` 开头必须是数字，
       表格行开头是 `|` 字符，不是数字，所以不会匹配。 */
    expect(stripLineNumberPrefix(table)).toBe(table);
  });

  test("空字符串 → 空字符串", () => {
    expect(stripLineNumberPrefix("")).toBe("");
  });

  test("末尾有空白行 → 剥离后保留行数（不 trim）", () => {
    const polluted = ["  1 | a", "  2 | b", "  3 | "].join("\n");
    const cleaned = stripLineNumberPrefix(polluted);
    expect(cleaned).toBe(["a", "b", ""].join("\n"));
  });
});

describe("persist_to_memory — 基本落盘", () => {
  let selfDir: string;

  beforeEach(() => {
    const root = makeTmpRoot();
    selfDir = join(root, "stones", "bruce");
    mkdirSync(selfDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(selfDir)) rmSync(selfDir, { recursive: true, force: true });
  });

  test("首次写入 → 创建 memory.md 并包含 key/content", async () => {
    const fn = llm_methods.persist_to_memory!.fn;
    const result = (await fn(
      { selfDir, stoneName: "bruce" },
      { key: "测试经验", content: "这是一条纯文本经验" },
    )) as any;

    expect(result.ok).toBe(true);
    const memPath = join(selfDir, "memory.md");
    expect(existsSync(memPath)).toBe(true);

    const body = readFileSync(memPath, "utf-8");
    expect(body).toContain("## 测试经验");
    expect(body).toContain("这是一条纯文本经验");
  });

  test("追加写入 → memory.md 保留旧条目", async () => {
    const fn = llm_methods.persist_to_memory!.fn;
    await fn({ selfDir, stoneName: "bruce" }, { key: "经验 1", content: "内容 1" });
    await fn({ selfDir, stoneName: "bruce" }, { key: "经验 2", content: "内容 2" });

    const body = readFileSync(join(selfDir, "memory.md"), "utf-8");
    expect(body).toContain("## 经验 1");
    expect(body).toContain("## 经验 2");
    expect(body).toContain("内容 1");
    expect(body).toContain("内容 2");
  });
});

describe("persist_to_memory — 行号前缀 sanity check（bugfix）", () => {
  let selfDir: string;

  beforeEach(() => {
    const root = makeTmpRoot();
    selfDir = join(root, "stones", "supervisor");
    mkdirSync(selfDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(selfDir)) rmSync(selfDir, { recursive: true, force: true });
  });

  test("content 整段带行号前缀 → 自动剥离后落盘", async () => {
    const fn = llm_methods.persist_to_memory!.fn;
    const polluted = [
      "  1 | # Supervisor 项目知识",
      "  2 | ",
      "  3 | ## 组织结构速查",
    ].join("\n");

    const result = (await fn(
      { selfDir, stoneName: "supervisor" },
      { key: "污染重现", content: polluted },
    )) as any;
    expect(result.ok).toBe(true);

    const body = readFileSync(join(selfDir, "memory.md"), "utf-8");
    /* 干净内容应存在 */
    expect(body).toContain("# Supervisor 项目知识");
    expect(body).toContain("## 组织结构速查");
    /* 污染前缀不应存在 */
    expect(body).not.toMatch(/^\s*\d+\s*\|/m);
  });

  test("key 带行号前缀 → 同样剥离", async () => {
    const fn = llm_methods.persist_to_memory!.fn;
    const result = (await fn(
      { selfDir, stoneName: "supervisor" },
      { key: "  1 | 污染的标题", content: "正文" },
    )) as any;
    expect(result.ok).toBe(true);

    const body = readFileSync(join(selfDir, "memory.md"), "utf-8");
    expect(body).toContain("## 污染的标题");
    expect(body).not.toMatch(/^\s*\d+\s*\|\s*污染的标题/m);
  });

  test("剥离后 content 变空字符串 → 拒绝写入", async () => {
    const fn = llm_methods.persist_to_memory!.fn;
    /* 纯行号占位，剥离后每行都是空 */
    const empty = "  1 | \n  2 | \n  3 | ";
    const result = (await fn(
      { selfDir, stoneName: "supervisor" },
      { key: "empty-test", content: empty },
    )) as any;

    /* 注意 trim() 后仍保留换行，但 content.trim() 应为空 → 拒绝 */
    expect(result.ok).toBe(false);
    expect(result.error).toContain("content");
  });

  test("纯文本 content → 不受 sanity check 影响", async () => {
    const fn = llm_methods.persist_to_memory!.fn;
    const clean = "这是一条纯文本经验，不含任何 pipe 前缀。";
    const result = (await fn(
      { selfDir, stoneName: "supervisor" },
      { key: "clean", content: clean },
    )) as any;
    expect(result.ok).toBe(true);

    const body = readFileSync(join(selfDir, "memory.md"), "utf-8");
    expect(body).toContain(clean);
  });
});

describe("集成：readFile → persist_to_memory 污染链路（真实 bug 复现）", () => {
  let rootDir: string;
  let selfDir: string;

  beforeEach(() => {
    rootDir = makeTmpRoot("integration");
    selfDir = join(rootDir, "stones", "supervisor");
    mkdirSync(selfDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(rootDir)) rmSync(rootDir, { recursive: true, force: true });
  });

  test("readFile 返回的带行号 content 作为 persist_to_memory.content → memory.md 干净", async () => {
    /* 模拟真实污染路径：某对象先 readFile 读了一个文件，拿到带行号的 content */
    const fileOps = await import("../traits/computable/file_ops/index.js");
    const srcFile = join(rootDir, "source.md");
    const originalText = "# 项目知识\n\n## 组织结构\n\n- sophia: 哲学层\n- kernel: 核心思想层\n";
    const { writeFileSync: wf } = await import("node:fs");
    wf(srcFile, originalText, "utf-8");

    const readRes = (await fileOps.readFile({ rootDir }, "source.md")) as any;
    expect(readRes.ok).toBe(true);
    /* 带行号返回，直接传给 persist_to_memory 会造成污染（修复前场景） */
    expect(readRes.data.content).toMatch(/^\s*\d+\s*\|/m);

    /* 把带行号的 content 原样作为 persist_to_memory 的输入 */
    const fn = llm_methods.persist_to_memory!.fn;
    const result = (await fn(
      { selfDir, stoneName: "supervisor" },
      { key: "从 readFile 读到的项目知识", content: readRes.data.content },
    )) as any;
    expect(result.ok).toBe(true);

    /* memory.md 必须干净——不含任何行号前缀 */
    const body = readFileSync(join(selfDir, "memory.md"), "utf-8");
    expect(body).not.toMatch(/^\s*\d+\s*\|/m);
    /* 并且原文本核心内容仍然保留 */
    expect(body).toContain("# 项目知识");
    expect(body).toContain("## 组织结构");
    expect(body).toContain("sophia: 哲学层");
    expect(body).toContain("kernel: 核心思想层");
  });
});

describe("create_trait — 行号前缀 sanity check（一致性）", () => {
  let selfDir: string;

  beforeEach(() => {
    const root = makeTmpRoot();
    selfDir = join(root, "stones", "supervisor");
    mkdirSync(selfDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(selfDir)) rmSync(selfDir, { recursive: true, force: true });
  });

  test("TRAIT.md content 带行号前缀 → 剥离后写入", async () => {
    const fn = llm_methods.create_trait!.fn;
    const polluted = [
      "  1 | ---",
      "  2 | namespace: self",
      "  3 | name: test",
      "  4 | ---",
      "  5 | # Test Trait",
    ].join("\n");

    const result = (await fn(
      { selfDir, stoneName: "supervisor" },
      { relativePath: "self/test", content: polluted },
    )) as any;
    expect(result.ok).toBe(true);

    const traitPath = join(selfDir, "traits", "self", "test", "TRAIT.md");
    expect(existsSync(traitPath)).toBe(true);
    const body = readFileSync(traitPath, "utf-8");
    expect(body).toContain("namespace: self");
    expect(body).not.toMatch(/^\s*\d+\s*\|/m);
  });
});
