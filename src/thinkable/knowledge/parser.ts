import yaml from "js-yaml";
import { parseActivatesOn } from "./triggers";
import type { KnowledgeFrontmatter } from "./types";

/**
 * 把 .md 文本拆成 frontmatter 与 body。
 *
 * 边界处理：
 * - 没有 frontmatter（不以 `---\n` 开头）→ 整篇作为 body，frontmatter = {}
 * - frontmatter 未闭合（找不到第二个 `\n---\n`）→ 视为没有 frontmatter
 * - yaml 语法错 → frontmatter = {}，body 仍正常返回
 *
 * activates_on 校验：
 * - 由 `parseActivatesOn`（来自 triggers.ts）做语义校验
 * - 旧 schema（`show_description_when` / `show_content_when`）或未知 trigger → throw
 *   （上层 loader 决定是否 catch；不静默忽略 = silent-swallow ban）
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
    return { frontmatter: validateFrontmatter(safeLoadYaml(fmText)), body: "" };
  }
  const fmText = text.slice(4, end);
  const body = text.slice(end + 5);
  return { frontmatter: validateFrontmatter(safeLoadYaml(fmText)), body };
}

function safeLoadYaml(text: string): KnowledgeFrontmatter {
  try {
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as KnowledgeFrontmatter;
    }
  } catch {
    // yaml 损坏 → 静默退到空 frontmatter（无 schema 信息可断言）
  }
  return {};
}

/**
 * 校验 frontmatter.activates_on（如有）。
 *
 * 命中旧 schema / 非法 trigger 时 throw —— 上层 loader 把异常转换为
 * 带文件路径的 warning（见 loader.ts 调用点）。这里不静默吞错。
 */
function validateFrontmatter(fm: KnowledgeFrontmatter): KnowledgeFrontmatter {
  if (fm.activates_on !== undefined) {
    // 校验只是要 fail-loud；这里调用一次，让 parser 阶段就拒绝旧格式。
    // 上层会 catch 并附上文件路径；parser 不知道文件路径，只能在错误里说 schema。
    parseActivatesOn(fm.activates_on, "<unknown file>");
  }
  return fm;
}
