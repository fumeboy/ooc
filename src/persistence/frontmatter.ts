/**
 * Frontmatter 解析器
 *
 * 解析 readme.md 的 YAML frontmatter。
 * frontmatter 中存储 talkable 信息，正文是 thinkable.whoAmI。
 *
 * 格式示例：
 * ---
 * whoAmI: 研究员，擅长信息检索
 * functions:
 *   - name: search
 *     description: 搜索信息
 * ---
 * 你是一个研究员，擅长信息检索和分析...
 *
 * @ref docs/哲学文档/gene.md#G1 — implements — readme.md 格式（thinkable 正文 + talkable frontmatter）
 * @ref docs/哲学文档/gene.md#G7 — implements — readme.md 是对象身份的物理载体
 */

import matter from "gray-matter";
import type { Talkable, Thinkable } from "../types/index.js";

/** readme.md 解析结果 */
export interface ReadmeParseResult {
  /** 思考时的自我认知（正文） */
  thinkable: Thinkable;
  /** 对外可见的介绍（frontmatter） */
  talkable: Talkable;
}

/**
 * 解析 readme.md 文件内容
 *
 * @param content - readme.md 的原始文本
 * @returns 解析出的 thinkable + talkable 信息
 */
export function parseReadme(content: string): ReadmeParseResult {
  const { data, content: body } = matter(content);

  const talkable: Talkable = {
    whoAmI: typeof data.whoAmI === "string" ? data.whoAmI : "",
    functions: Array.isArray(data.functions)
      ? data.functions.map((f: Record<string, unknown>) => ({
          name: String(f.name ?? ""),
          description: String(f.description ?? ""),
        }))
      : [],
  };

  const thinkable: Thinkable = {
    whoAmI: body.trim(),
  };

  return { thinkable, talkable };
}

/**
 * 将 thinkable + talkable 信息序列化为 readme.md 内容
 *
 * @param thinkable - 思考时的自我认知
 * @param talkable - 对外可见的介绍
 * @returns readme.md 的文本内容
 */
export function serializeReadme(thinkable: Thinkable, talkable: Talkable): string {
  const frontmatter: Record<string, unknown> = {};

  if (talkable.whoAmI) {
    frontmatter.whoAmI = talkable.whoAmI;
  }

  if (talkable.functions.length > 0) {
    frontmatter.functions = talkable.functions.map((f) => ({
      name: f.name,
      description: f.description,
    }));
  }

  return matter.stringify(thinkable.whoAmI + "\n", frontmatter);
}
