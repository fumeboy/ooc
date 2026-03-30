/**
 * Library Index Trait — 提供 library 公共资源的查询方法
 *
 * 让 OOC 对象能够查找和读取 library 中的 traits 和 UI 组件。
 *
 * 注意：原 skills 目录已废弃，所有能力已合并为 trait 格式。
 * 旧 API (listLibrarySkills, readLibrarySkill) 保持向后兼容，
 * 但建议迁移到新的统一 API: readTrait, activateTrait。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** library 根目录（运行时由 ctx 提供） */
function getLibraryDir(ctx: { rootDir: string }): string {
  return join(ctx.rootDir, "library");
}

/**
 * 列出 library 中所有可用的 skill（已废弃，向后兼容）
 * 原 skills 目录已合并到 traits，此方法返回空数组。
 * 请使用 listLibraryTraits() 或直接使用 readTrait()。
 *
 * @deprecated 使用 listLibraryTraits 或 readTrait 替代
 * @param ctx - 执行上下文
 * @returns 空数组（skills 目录已废弃）
 */
export function listLibrarySkills(ctx: { rootDir: string }): string[] {
  /* 原 skills 目录已废弃，返回空数组 */
  const skillsDir = join(getLibraryDir(ctx), "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => f.replace(/\.md$/, ""));
}

/**
 * 读取指定 skill 的完整内容（已废弃，向后兼容）
 * 原 skills 目录已合并到 traits。此方法会尝试：
 * 1. 旧位置 library/skills/{name}.md
 * 2. 新位置 library/traits/{name}/readme.md
 *
 * @deprecated 使用 readTrait 替代
 * @param ctx - 执行上下文
 * @param name - skill 名称（不含 .md 后缀）
 * @returns skill 的 markdown 内容，找不到时返回错误提示
 */
export function readLibrarySkill(ctx: { rootDir: string }, name: string): string {
  const fileName = name.endsWith(".md") ? name : `${name}.md`;

  /* 尝试旧位置（向后兼容） */
  const oldPath = join(getLibraryDir(ctx), "skills", fileName);
  if (existsSync(oldPath)) {
    return readFileSync(oldPath, "utf-8");
  }

  /* 尝试新位置：library/traits/{name}/readme.md */
  const newPath = join(getLibraryDir(ctx), "traits", name, "readme.md");
  if (existsSync(newPath)) {
    return readFileSync(newPath, "utf-8");
  }

  return `[错误] skill/trait "${name}" 不存在（已从 library/skills 迁移到 library/traits）`;
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

  /* 搜索 traits（skills 已合并到 traits） */
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
