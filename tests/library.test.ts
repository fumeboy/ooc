/**
 * Library 系统测试
 *
 * 覆盖：三层 trait 加载链、library index trait 方法
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadAllTraits } from "../src/trait/loader.js";
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

/* ========== 三层 trait 加载链 ========== */

describe("loadAllTraits 三层加载", () => {
  test("kernel + library + object 三层合并", async () => {
    const kernelDir = join(TEST_DIR, "kernel");
    const libraryDir = join(TEST_DIR, "library");
    const objectDir = join(TEST_DIR, "object");

    /* kernel trait */
    mkdirSync(join(kernelDir, "computable"), { recursive: true });
    writeFileSync(join(kernelDir, "computable", "readme.md"), "---\nwhen: always\n---\nkernel computable", "utf-8");

    /* library trait */
    mkdirSync(join(libraryDir, "web_search"), { recursive: true });
    writeFileSync(join(libraryDir, "web_search", "readme.md"), "---\nwhen: always\n---\nlibrary web_search", "utf-8");

    /* object trait */
    mkdirSync(join(objectDir, "custom"), { recursive: true });
    writeFileSync(join(objectDir, "custom", "readme.md"), "---\nwhen: always\n---\nobject custom", "utf-8");

    const traits = await loadAllTraits(objectDir, kernelDir, libraryDir);
    expect(traits).toHaveLength(3);
    expect(traits.map((t) => t.name).sort()).toEqual(["computable", "custom", "web_search"]);
  });

  test("library trait 覆盖 kernel 同名 trait", async () => {
    const kernelDir = join(TEST_DIR, "k1");
    const libraryDir = join(TEST_DIR, "l1");
    const objectDir = join(TEST_DIR, "o1");

    mkdirSync(join(kernelDir, "computable"), { recursive: true });
    writeFileSync(join(kernelDir, "computable", "readme.md"), "---\nwhen: always\n---\nkernel版本", "utf-8");

    mkdirSync(join(libraryDir, "computable"), { recursive: true });
    writeFileSync(join(libraryDir, "computable", "readme.md"), "---\nwhen: always\n---\nlibrary覆盖版本", "utf-8");

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

    mkdirSync(join(libraryDir, "search"), { recursive: true });
    writeFileSync(join(libraryDir, "search", "readme.md"), "---\nwhen: always\n---\nlibrary版本", "utf-8");

    mkdirSync(join(objectDir, "search"), { recursive: true });
    writeFileSync(join(objectDir, "search", "readme.md"), "---\nwhen: always\n---\nobject覆盖版本", "utf-8");

    const traits = await loadAllTraits(objectDir, kernelDir, libraryDir);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.readme).toBe("object覆盖版本");
  });

  test("object trait 覆盖 kernel（跳过 library 层）", async () => {
    const kernelDir = join(TEST_DIR, "k3");
    const objectDir = join(TEST_DIR, "o3");

    mkdirSync(join(kernelDir, "computable"), { recursive: true });
    writeFileSync(join(kernelDir, "computable", "readme.md"), "---\nwhen: always\n---\nkernel版本", "utf-8");

    mkdirSync(join(objectDir, "computable"), { recursive: true });
    writeFileSync(join(objectDir, "computable", "readme.md"), "---\nwhen: always\n---\nobject覆盖版本", "utf-8");

    /* 不传 libraryDir，向后兼容 */
    const traits = await loadAllTraits(objectDir, kernelDir);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.readme).toBe("object覆盖版本");
  });

  test("libraryDir 不存在时不报错", async () => {
    const kernelDir = join(TEST_DIR, "k4");
    const objectDir = join(TEST_DIR, "o4");

    mkdirSync(join(kernelDir, "a"), { recursive: true });
    writeFileSync(join(kernelDir, "a", "readme.md"), "---\nwhen: always\n---\nA", "utf-8");
    mkdirSync(objectDir, { recursive: true });

    const traits = await loadAllTraits(objectDir, kernelDir, join(TEST_DIR, "nonexistent"));
    expect(traits).toHaveLength(1);
  });
});

/* ========== Library Index Trait 方法 ========== */

describe("library_index trait 方法", () => {
  test("listLibrarySkills 列出 skills", () => {
    const rootDir = join(TEST_DIR, "root");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });
    writeFileSync(join(rootDir, "library", "skills", "news.md"), "# News Skill", "utf-8");
    writeFileSync(join(rootDir, "library", "skills", "search.md"), "# Search Skill", "utf-8");
    writeFileSync(join(rootDir, "library", "skills", "index.md"), "# Index", "utf-8");

    const skills = listLibrarySkills({ rootDir });
    expect(skills.sort()).toEqual(["news", "search"]);
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

  test("readLibrarySkill 读取 skill 内容", () => {
    const rootDir = join(TEST_DIR, "root2");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });
    writeFileSync(join(rootDir, "library", "skills", "deep-reading.md"), "# 深度阅读\n\n详细内容", "utf-8");

    const content = readLibrarySkill({ rootDir }, "deep-reading");
    expect(content).toContain("深度阅读");
  });

  test("readLibrarySkill 不存在的 skill 返回错误提示", () => {
    const rootDir = join(TEST_DIR, "root3");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });

    const content = readLibrarySkill({ rootDir }, "nonexistent");
    expect(content).toContain("不存在");
  });

  test("listLibraryTraits 列出 traits", () => {
    const rootDir = join(TEST_DIR, "root4");
    mkdirSync(join(rootDir, "library", "traits", "web_search"), { recursive: true });
    mkdirSync(join(rootDir, "library", "traits", "coding"), { recursive: true });

    const traits = listLibraryTraits({ rootDir });
    expect(traits.sort()).toEqual(["coding", "web_search"]);
  });

  test("searchLibrary 搜索 skills 和 traits", () => {
    const rootDir = join(TEST_DIR, "root5");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });
    mkdirSync(join(rootDir, "library", "traits", "news_trait"), { recursive: true });
    writeFileSync(join(rootDir, "library", "skills", "news.md"), "# 新闻聚合\n\n获取最新新闻", "utf-8");
    writeFileSync(join(rootDir, "library", "traits", "news_trait", "readme.md"), "---\nwhen: always\n---\n新闻相关能力", "utf-8");

    const results = searchLibrary({ rootDir }, "新闻");
    expect(results).toContain("[skill] news");
    expect(results).toContain("[trait] news_trait");
  });

  test("searchLibrary 无匹配返回提示", () => {
    const rootDir = join(TEST_DIR, "root6");
    mkdirSync(join(rootDir, "library", "skills"), { recursive: true });

    const results = searchLibrary({ rootDir }, "不存在的关键词");
    expect(results).toContain("没有找到");
  });
});
