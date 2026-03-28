/**
 * Library Index Trait — 提供 library 公共资源的查询方法
 *
 * 让 OOC 对象能够查找和读取 library 中的 skills、traits 和 UI 组件。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** library 根目录（运行时由 ctx 提供） */
function getLibraryDir(ctx: { rootDir: string }): string {
  return join(ctx.rootDir, "library");
}

/**
 * 列出 library 中所有可用的 skill
 * @param ctx - 执行上下文
 * @returns skill 名称列表（不含 .md 后缀）
 */
export function listLibrarySkills(ctx: { rootDir: string }): string[] {
  const skillsDir = join(getLibraryDir(ctx), "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => f.replace(/\.md$/, ""));
}

/**
 * 读取指定 skill 的完整内容
 * @param ctx - 执行上下文
 * @param name - skill 名称（不含 .md 后缀）
 * @returns skill 的 markdown 内容，找不到时返回错误提示
 */
export function readLibrarySkill(ctx: { rootDir: string }, name: string): string {
  const fileName = name.endsWith(".md") ? name : `${name}.md`;
  const filePath = join(getLibraryDir(ctx), "skills", fileName);
  if (!existsSync(filePath)) return `[错误] skill "${name}" 不存在`;
  return readFileSync(filePath, "utf-8");
}

/**
 * 列出 library 中所有公共 trait
 * @param ctx - 执行上下文
 * @returns trait 名称列表
 */
export function listLibraryTraits(ctx: { rootDir: string }): string[] {
  const traitsDir = join(getLibraryDir(ctx), "traits");
  if (!existsSync(traitsDir)) return [];
  return readdirSync(traitsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/**
 * 在 library 中搜索匹配关键词的资源
 * @param ctx - 执行上下文
 * @param keyword - 搜索关键词
 * @returns 匹配的资源列表（类型 + 名称 + 匹配行）
 */
export function searchLibrary(ctx: { rootDir: string }, keyword: string): string {
  const libraryDir = getLibraryDir(ctx);
  const results: string[] = [];
  const kw = keyword.toLowerCase();

  /* 搜索 skills */
  const skillsDir = join(libraryDir, "skills");
  if (existsSync(skillsDir)) {
    for (const file of readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
      const content = readFileSync(join(skillsDir, file), "utf-8");
      if (content.toLowerCase().includes(kw)) {
        const name = file.replace(/\.md$/, "");
        /* 找到匹配的第一行 */
        const line = content.split("\n").find((l) => l.toLowerCase().includes(kw))?.trim() ?? "";
        results.push(`[skill] ${name}: ${line.slice(0, 80)}`);
      }
    }
  }

  /* 搜索 traits */
  const traitsDir = join(libraryDir, "traits");
  if (existsSync(traitsDir)) {
    for (const dir of readdirSync(traitsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const readmePath = join(traitsDir, dir.name, "readme.md");
      if (existsSync(readmePath)) {
        const content = readFileSync(readmePath, "utf-8");
        if (content.toLowerCase().includes(kw)) {
          const line = content.split("\n").find((l) => l.toLowerCase().includes(kw))?.trim() ?? "";
          results.push(`[trait] ${dir.name}: ${line.slice(0, 80)}`);
        }
      }
    }
  }

  if (results.length === 0) return `没有找到与 "${keyword}" 匹配的资源`;
  return results.join("\n");
}
