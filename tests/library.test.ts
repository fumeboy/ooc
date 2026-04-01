/**
 * Library 系统测试
 *
 * 覆盖：三层 trait 加载链、library index trait 方法
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadAllTraits } from "../src/trait/loader.js";
import { traitId } from "../src/trait/activator.js";
import {
  listLibrarySkills,
  readLibrarySkill,
  listLibraryTraits,
  searchLibrary,
} from "../traits/kernel/library_index/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_library_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/** 创建测试用的 TRAIT.md (新格式 */
const createTrait = (parentDir: string, namespace: string, name: string, content: string, when = "always") => {
  const traitDir = join(parentDir, namespace, name);
  mkdirSync(traitDir, { recursive: true });
  writeFileSync(join(traitDir, "TRAIT.md"), `---
namespace: "${namespace}"
name: "${name}"
type: "how_to_think"
when: ${when}
---
${content}`, "utf-8");
};

/* ========== 三层 trait 加载链 ========== */

describe("loadAllTraits 三层加载", () => {
  test("kernel + library + object 三层合并", async () => {
    const kernelDir = join(TEST_DIR, "kernel");
    const libraryDir = join(TEST_DIR, "library");
    const objectDir = join(TEST_DIR, "object");

    /* kernel trait (新格式：namespace/name) */
    createTrait(kernelDir, "kernel", "computable", "kernel computable");

    /* library trait */
    createTrait(libraryDir, "web", "search", "library web search");

    /* object trait */
    createTrait(objectDir, "custom", "custom", "object custom");

    const traits = await loadAllTraits(objectDir, kernelDir, libraryDir);
    expect(traits).toHaveLength(3);
    const ids = traits.map(traitId).sort();
    expect(ids).toContain("kernel/computable");
    expect(ids).toContain("web/search");
    expect(ids).toContain("custom/custom");
  });

  test("library trait 覆盖 kernel 同名 trait", async () => {
    const kernelDir = join(TEST_DIR, "k1");
    const libraryDir = join(TEST_DIR, "l1");
    const objectDir = join(TEST_DIR, "o1");

    createTrait(kernelDir, "kernel", "computable", "kernel版本");

    createTrait(libraryDir, "kernel", "computable", "library覆盖版本");

    mkdirSync(objectDir, { recursive: true });

    const traits = await loadAllTraits(objectDir, kernelDir, libraryDir);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.readme).toBe("library覆盖版本");
  });

  test("object trait 覆盖 library 同名 trait", async () => {
    const kernelDir = join(TEST_DIR, "k2");
    const libraryDir = join(TEST_DIR, "l2");
    const objectDir = join(TEST_DIR, "o2");

    mkdirSync(kernelDir, { recursive: true });

    createTrait(libraryDir, "search", "search", "library版本");

    createTrait(objectDir, "search", "search", "object覆盖版本");

    const traits = await loadAllTraits(objectDir, kernelDir, libraryDir);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.readme).toBe("object覆盖版本");
  });

  test("object trait 覆盖 kernel（跳过 library 层）", async () => {
    const kernelDir = join(TEST_DIR, "k3");
    const objectDir = join(TEST_DIR, "o3");

    createTrait(kernelDir, "kernel", "computable", "kernel版本");

    createTrait(objectDir, "kernel", "computable", "object覆盖版本");

    const traits = await loadAllTraits(objectDir, kernelDir);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.readme).toBe("object覆盖版本");
  });

  test("libraryDir 不存在时不报错", async () => {
    const kernelDir = join(TEST_DIR, "k4");
    const objectDir = join(TEST_DIR, "o4");

    createTrait(kernelDir, "test", "a", "A");

    mkdirSync(objectDir, { recursive: true });

    const traits = await loadAllTraits(objectDir, kernelDir, join(TEST_DIR, "nonexistent"));
    expect(traits).toHaveLength(1);
    expect(traitId(traits[0]!)).toBe("test/a");
  });
});

/* ========== Library Index Trait 方法 ========== */

describe("library_index trait 方法", () => {
  test("listLibrarySkills 已废弃返回空数组", () => {
    const rootDir = join(TEST_DIR, "root");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });
    writeFileSync(join(rootDir, "library", "skills", "news.md"), "# News Skill", "utf-8");

    const skills = listLibrarySkills({ rootDir });
    // 已废弃的 API 返回空数组
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
    // 已废弃的 API 返回错误提示
    expect(content).toContain("已废弃");
  });

  test("readLibrarySkill 不存在的 skill 返回错误提示", () => {
    const rootDir = join(TEST_DIR, "root3");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });

    const content = readLibrarySkill({ rootDir }, "nonexistent");
    expect(content).toContain("已废弃");
  });

  test("listLibraryTraits 列出 traits (新格式 namespace/name)", () => {
    const rootDir = join(TEST_DIR, "root4");

    // 新格式：library/traits/{namespace}/{name}/TRAIT.md
    createTrait(join(rootDir, "library", "traits"), "web", "search", "web search");
    createTrait(join(rootDir, "library", "traits"), "coding", "coding", "coding helper");

    const traits = listLibraryTraits({ rootDir });
    expect(traits.sort()).toEqual(["coding/coding", "web/search"]);
  });

  test("searchLibrary 搜索 traits（新格式）", () => {
    const rootDir = join(TEST_DIR, "root5");

    // 新格式：library/traits/{namespace}/{name}/TRAIT.md
    createTrait(join(rootDir, "library", "traits"), "news", "news_trait", "新闻聚合，获取最新新闻", "never");
    createTrait(join(rootDir, "library", "traits"), "deep", "deep_reading", "深度阅读，分析文章", "never");

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
