/**
 * Library Index Trait — 提供 library 公共资源的查询方法
 *
 * 让 OOC 对象能够查找和读取 library 中的 traits 和 UI 组件。
 *
 * 目录结构：
 * library/traits/
 * └── {namespace}/           # 命名空间，如 lark, web, utils
 *     └── {name}/             # trait 名称
 *         ├── TRAIT.md        # 新格式（推荐）
 *         └── SKILL.md        # 兼容格式
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** library 根目录（运行时由 ctx 提供） */
function getLibraryDir(ctx: { rootDir: string }): string {
  return join(ctx.rootDir, "library");
}

/**
 * 检查目录是否是 namespace 目录（包含子 trait 目录）
 */
function isNamespaceDir(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subPath = join(dir, entry.name);
    if (existsSync(join(subPath, "TRAIT.md")) || existsSync(join(subPath, "SKILL.md"))) {
      return true;
    }
  }
  return false;
}

/**
 * 从单个 trait 目录读取描述内容（用于搜索）
 * 优先级：TRAIT.md > SKILL.md
 */
function readTraitContent(traitDir: string): string | null {
  const traitPath = join(traitDir, "TRAIT.md");
  if (existsSync(traitPath)) {
    return readFileSync(traitPath, "utf-8");
  }
  const skillPath = join(traitDir, "SKILL.md");
  if (existsSync(skillPath)) {
    return readFileSync(skillPath, "utf-8");
  }
  return null;
}

/**
 * 列出 library 中所有公共 trait
 * 支持新结构：traits/{namespace}/{name}/TRAIT.md
 *
 * @param ctx - 执行上下文
 * @returns trait 名称列表，格式："namespace/name"
 */
export function listLibraryTraits(ctx: { rootDir: string }): string[] {
  const traitsDir = join(getLibraryDir(ctx), "traits");
  if (!existsSync(traitsDir)) return [];

  const results: string[] = [];

  for (const entry of readdirSync(traitsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const entryPath = join(traitsDir, entry.name);

    if (isNamespaceDir(entryPath)) {
      // 新结构：entry.name 是 namespace，子目录是 trait 名称
      for (const subEntry of readdirSync(entryPath, { withFileTypes: true })) {
        if (!subEntry.isDirectory() || subEntry.name.startsWith(".")) continue;
        const traitDir = join(entryPath, subEntry.name);
        const content = readTraitContent(traitDir);
        if (content) {
          results.push(`${entry.name}/${subEntry.name}`);
        }
      }
    } else {
      // 检查是否是扁平结构的 trait 目录
      const content = readTraitContent(entryPath);
      if (content) {
        results.push(entry.name);
      }
    }
  }

  return results;
}

/**
 * 在 library 中搜索匹配关键词的资源
 * 支持新结构：traits/{namespace}/{name}/TRAIT.md
 *
 * @param ctx - 执行上下文
 * @param keyword - 搜索关键词
 * @returns 匹配的资源列表（类型 + 名称 + 匹配行）
 */
export function searchLibrary(ctx: { rootDir: string }, keyword: string): string {
  const libraryDir = getLibraryDir(ctx);
  const results: string[] = [];
  const kw = keyword.toLowerCase();

  const traitsDir = join(libraryDir, "traits");
  if (existsSync(traitsDir)) {
    for (const entry of readdirSync(traitsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const entryPath = join(traitsDir, entry.name);

      if (isNamespaceDir(entryPath)) {
        // 新结构：entry.name 是 namespace
        for (const subEntry of readdirSync(entryPath, { withFileTypes: true })) {
          if (!subEntry.isDirectory() || subEntry.name.startsWith(".")) continue;
          const traitDir = join(entryPath, subEntry.name);
          const content = readTraitContent(traitDir);
          if (content && content.toLowerCase().includes(kw)) {
            const line = content.split("\n").find((l) => l.toLowerCase().includes(kw))?.trim() ?? "";
            results.push(`[trait] ${entry.name}/${subEntry.name}: ${line.slice(0, 80)}`);
          }
        }
      } else {
        // 扁平结构
        const content = readTraitContent(entryPath);
        if (content && content.toLowerCase().includes(kw)) {
          const line = content.split("\n").find((l) => l.toLowerCase().includes(kw))?.trim() ?? "";
          results.push(`[trait] ${entry.name}: ${line.slice(0, 80)}`);
        }
      }
    }
  }

  if (results.length === 0) return `没有找到与 "${keyword}" 匹配的资源`;
  return results.join("\n");
}

// ========== 以下是已废弃的 API，保留仅用于向后兼容 ==========

/**
 * @deprecated 已废弃，使用 listLibraryTraits 替代
 */
export function listLibrarySkills(_ctx: { rootDir: string }): string[] {
  return [];
}

/**
 * @deprecated 已废弃，使用 readTrait 替代
 */
export function readLibrarySkill(_ctx: { rootDir: string }, name: string): string {
  return `[错误] 已废弃的 API，请使用 readTrait("${name}") 替代`;
}

// ========== Phase 2 新协议：llm_methods 对象导出 ==========

import type { TraitMethod } from "../../src/types/index";

export const llm_methods: Record<string, TraitMethod> = {
  listLibraryTraits: {
    name: "listLibraryTraits",
    description: "列出 library 中的所有 trait（name 格式 namespace/name）",
    params: [],
    fn: ((ctx: { rootDir: string }) => listLibraryTraits(ctx)) as TraitMethod["fn"],
  },
  searchLibrary: {
    name: "searchLibrary",
    description: "按关键词在 library 中搜索 trait",
    params: [{ name: "keyword", type: "string", description: "关键词", required: true }],
    fn: ((ctx: { rootDir: string }, { keyword }: { keyword: string }) =>
      searchLibrary(ctx, keyword)) as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
