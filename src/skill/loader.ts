/**
 * Skill 加载器
 *
 * 从 library/skills/ 目录扫描并加载 SKILL.md 文件。
 * 启动时只读 frontmatter（name + description + when），body 按需加载。
 *
 * @ref docs/superpowers/specs/2026-04-10-skill-system-design.md#3.1
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { SkillDefinition } from "./types.js";

/**
 * 扫描目录加载所有 Skill 的索引信息
 *
 * @param skillsDir - skills 根目录（如 library/skills/）
 * @returns SkillDefinition 列表
 */
export function loadSkills(skillsDir: string): SkillDefinition[] {
  if (!existsSync(skillsDir)) return [];

  const results: SkillDefinition[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;

    const entryPath = join(skillsDir, entry.name);

    /* symlink 安全检查 */
    if (entry.isSymbolicLink()) {
      try {
        if (!statSync(entryPath).isDirectory()) continue;
      } catch {
        continue;
      }
    }

    const skillPath = join(entryPath, "SKILL.md");
    if (!existsSync(skillPath)) continue;

    try {
      const raw = readFileSync(skillPath, "utf-8");
      const { data } = matter(raw);

      const name = typeof data.name === "string" ? data.name : entry.name;
      const description = typeof data.description === "string" ? data.description : "";

      const skill: SkillDefinition = { name, description, dir: entryPath };
      if (typeof data.when === "string") {
        skill.when = data.when;
      }

      results.push(skill);
    } catch {
      /* 解析失败，跳过 */
    }
  }

  return results;
}

/**
 * 按需读取 SKILL.md 的 body 内容
 *
 * @param skillDir - skill 目录路径
 * @returns body 文本，文件不存在返回 null
 */
export function loadSkillBody(skillDir: string): string | null {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;

  try {
    const raw = readFileSync(skillPath, "utf-8");
    const { content } = matter(raw);
    return content.trim() || null;
  } catch {
    return null;
  }
}
