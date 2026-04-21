/**
 * Library 系统测试
 *
 * Phase 1 改造后：所有 library 下的 TRAIT.md frontmatter 必须 `namespace: library`。
 * trait 的完整 name 由目录结构决定（如 library/traits/web/search → name: web/search）。
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllTraits } from "../src/trait/loader.js";
import { traitId } from "../src/trait/activator.js";
import {
  listLibrarySkills,
  readLibrarySkill,
  listLibraryTraits,
  searchLibrary,
} from "../traits/library_index/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_library_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/**
 * 在 parentDir 下创建一个 trait 目录
 *
 * @param parentDir - 父目录（通常是 `kernel/traits` 或 `library/traits` 或对象 traits/）
 * @param namespace - 写入 frontmatter 的 namespace（kernel | library | self）
 * @param relName - 相对名（可含 / 分级，如 "web/search"）
 */
const createTrait = (
  parentDir: string,
  namespace: "kernel" | "library" | "self",
  relName: string,
  content: string,
  when = "always",
) => {
  const traitDir = join(parentDir, ...relName.split("/"));
  mkdirSync(traitDir, { recursive: true });
  writeFileSync(
    join(traitDir, "TRAIT.md"),
    `---
namespace: ${namespace}
name: ${relName}
type: how_to_think
when: ${when}
---
${content}`,
    "utf-8",
  );
};

/* ========== 三层 trait 加载链 ========== */

describe("loadAllTraits 三层加载", () => {
  test("kernel + library + object 三层合并", async () => {
    const kernelDir = join(TEST_DIR, "kernel");
    const libraryDir = join(TEST_DIR, "library");
    const objectDir = join(TEST_DIR, "object");

    createTrait(kernelDir, "kernel", "computable", "kernel computable");
    createTrait(libraryDir, "library", "web/search", "library web search");
    createTrait(objectDir, "self", "reporter", "object reporter");

    const { traits } = await loadAllTraits(objectDir, kernelDir, libraryDir);
    expect(traits).toHaveLength(3);
    const ids = traits.map(traitId).sort();
    expect(ids).toContain("kernel:computable");
    expect(ids).toContain("library:web/search");
    expect(ids).toContain("self:reporter");
  });

  test("library trait 覆盖 kernel 同 traitId 的 trait（若 id 相同才覆盖）", async () => {
    // 新协议下，traitId 含 namespace，所以 kernel:foo 与 library:foo 是不同 traitId，
    // 不构成覆盖。此测试验证：同 traitId 时才覆盖（同 namespace 下）。
    const kernelDir = join(TEST_DIR, "k1");
    const libraryDir = join(TEST_DIR, "l1");
    const objectDir = join(TEST_DIR, "o1");

    createTrait(kernelDir, "kernel", "foo", "kernel版本");
    createTrait(libraryDir, "library", "foo", "library版本");

    mkdirSync(objectDir, { recursive: true });

    const { traits } = await loadAllTraits(objectDir, kernelDir, libraryDir);
    expect(traits).toHaveLength(2);
    const byId = new Map(traits.map((t) => [traitId(t), t.readme]));
    expect(byId.get("kernel:foo")).toBe("kernel版本");
    expect(byId.get("library:foo")).toBe("library版本");
  });

  test("self trait 与同 traitId 时覆盖（只验证同 namespace 场景）", async () => {
    const kernelDir = join(TEST_DIR, "k2");
    const libraryDir = join(TEST_DIR, "l2");
    const objectDir = join(TEST_DIR, "o2");

    mkdirSync(kernelDir, { recursive: true });

    createTrait(libraryDir, "library", "search", "library版本");
    createTrait(objectDir, "self", "search", "self 版本");

    const { traits } = await loadAllTraits(objectDir, kernelDir, libraryDir);
    // 两个 traitId 不同：library:search + self:search
    expect(traits).toHaveLength(2);
    const byId = new Map(traits.map((t) => [traitId(t), t.readme]));
    expect(byId.get("library:search")).toBe("library版本");
    expect(byId.get("self:search")).toBe("self 版本");
  });

  test("libraryDir 不存在时不报错", async () => {
    const kernelDir = join(TEST_DIR, "k4");
    const objectDir = join(TEST_DIR, "o4");

    createTrait(kernelDir, "kernel", "a", "A");

    mkdirSync(objectDir, { recursive: true });

    const { traits } = await loadAllTraits(objectDir, kernelDir, join(TEST_DIR, "nonexistent"));
    expect(traits).toHaveLength(1);
    expect(traitId(traits[0]!)).toBe("kernel:a");
  });
});

/* ========== Library Index Trait 方法 ========== */

describe("library_index trait 方法", () => {
  test("listLibrarySkills 已废弃返回空数组", () => {
    const rootDir = join(TEST_DIR, "root");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });
    writeFileSync(join(rootDir, "library", "skills", "news.md"), "# News Skill", "utf-8");

    const skills = listLibrarySkills({ rootDir });
    expect(skills).toEqual([]);
  });

  test("listLibrarySkills 空目录返回空数组", () => {
    const rootDir = join(TEST_DIR, "root_empty");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });

    const skills = listLibrarySkills({ rootDir });
    expect(skills).toEqual([]);
  });

  test("listLibrarySkills 目录不存在返回空数组", () => {
    const rootDir = join(TEST_DIR, "nonexistent_root");
    const skills = listLibrarySkills({ rootDir });
    expect(skills).toEqual([]);
  });

  test("readLibrarySkill 已废弃返回错误提示", () => {
    const rootDir = join(TEST_DIR, "root2");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });
    writeFileSync(join(rootDir, "library", "skills", "deep-reading.md"), "# 深度阅读\n\n详细内容", "utf-8");

    const content = readLibrarySkill({ rootDir }, "deep-reading");
    expect(content).toContain("已废弃");
  });

  test("readLibrarySkill 不存在的 skill 返回错误提示", () => {
    const rootDir = join(TEST_DIR, "root3");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });

    const content = readLibrarySkill({ rootDir }, "nonexistent");
    expect(content).toContain("已废弃");
  });

  test("listLibraryTraits 列出 traits（library 下的 ns/name 形式目录）", () => {
    const rootDir = join(TEST_DIR, "root4");

    createTrait(join(rootDir, "library", "traits"), "library", "web/search", "web search");
    createTrait(join(rootDir, "library", "traits"), "library", "coding/coding", "coding helper");

    const traits = listLibraryTraits({ rootDir });
    expect(traits.sort()).toEqual(["coding/coding", "web/search"]);
  });

  test("searchLibrary 搜索 traits", () => {
    const rootDir = join(TEST_DIR, "root5");

    createTrait(join(rootDir, "library", "traits"), "library", "news/news_trait", "新闻聚合，获取最新新闻", "never");
    createTrait(join(rootDir, "library", "traits"), "library", "deep/deep_reading", "深度阅读，分析文章", "never");

    const results = searchLibrary({ rootDir }, "新闻");
    expect(results).toContain("news/news_trait");
    expect(results).not.toContain("deep/deep_reading");
  });

  test("searchLibrary 无匹配返回提示", () => {
    const rootDir = join(TEST_DIR, "root6");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });

    const results = searchLibrary({ rootDir }, "不存在的关键词");
    expect(results).toContain("没有找到");
  });
});
