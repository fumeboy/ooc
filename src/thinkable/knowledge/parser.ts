import yaml from "js-yaml";
import type { KnowledgeFrontmatter } from "./types";

/**
 * 把 .md 文本拆成 frontmatter 与 body。
 *
 * 边界处理：
 * - 没有 frontmatter（不以 `---\n` 开头）→ 整篇作为 body，frontmatter = {}
 * - frontmatter 未闭合（找不到第二个 `\n---\n`）→ 视为没有 frontmatter
 * - yaml 语法错 → frontmatter = {}，body 仍正常返回
 */
export function parseKnowledgeFile(text: string): {
  frontmatter: KnowledgeFrontmatter;
  body: string;
} {
  if (!text.startsWith("---\n")) {
    return { frontmatter: {}, body: text };
  }
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    // 退化处理：可能以 `---` 结尾但没有最终 newline
    const tailEnd = text.indexOf("\n---", 4);
    if (tailEnd === -1 || tailEnd + 4 !== text.length) {
      return { frontmatter: {}, body: text };
    }
    // 文档只有 frontmatter，没有 body
    const fmText = text.slice(4, tailEnd);
    return { frontmatter: safeLoadYaml(fmText), body: "" };
  }
  const fmText = text.slice(4, end);
  const body = text.slice(end + 5);
  return { frontmatter: safeLoadYaml(fmText), body };
}

function safeLoadYaml(text: string): KnowledgeFrontmatter {
  try {
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as KnowledgeFrontmatter;
    }
  } catch {
    // yaml 损坏 → 静默退到空 frontmatter
  }
  return {};
}
