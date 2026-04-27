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
import type { Talkable, Thinkable } from "../shared/types/index.js";

/** readme.md 解析结果 */
export interface ReadmeParseResult {
  /** 思考时的自我认知（正文） */
  thinkable: Thinkable;
  /** 对外可见的介绍（frontmatter） */
  talkable: Talkable;
  /**
   * 对象级默认激活的 trait 列表（frontmatter: activated_traits）
   *
   * 为什么放在 readme.md 而不是 data.json：
   * - data.json 在很多项目里被 gitignore 作为运行时状态
   * - readme.md 是对象身份文件，必须入库
   * - 把"默认激活 trait"视为对象身份的一部分
   */
  activatedTraits: string[];
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

  /* activated_traits：对象级默认激活 trait 清单（frontmatter 数组） */
  const activatedTraits: string[] = Array.isArray(data.activated_traits)
    ? (data.activated_traits as unknown[])
        .filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  return { thinkable, talkable, activatedTraits };
}

/**
 * 将 thinkable + talkable 信息序列化为 readme.md 内容
 *
 * @param thinkable - 思考时的自我认知
 * @param talkable - 对外可见的介绍
 * @returns readme.md 的文本内容
 */
export function serializeReadme(
  thinkable: Thinkable,
  talkable: Talkable,
  activatedTraits?: string[],
): string {
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

  if (activatedTraits && activatedTraits.length > 0) {
    frontmatter.activated_traits = activatedTraits;
  }

  return matter.stringify(thinkable.whoAmI + "\n", frontmatter);
}
