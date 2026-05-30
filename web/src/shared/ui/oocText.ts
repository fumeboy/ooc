/**
 * 把一段消息文本按裸 `ooc://client/...` URI 切分为 [text, oocLink, text, ...] 段。
 *
 * 为什么需要：ReactMarkdown 不会把裸 `ooc://...` 文本 autolink（GFM 只 autolink http(s)）。
 * 所以在交给 markdown 渲染前，先把可识别的裸 ooc URI 拆出来单独渲成 <Link>，其余原样走 markdown。
 * （markdown 链接形态 `[x](ooc://...)` 不走这里——由 MarkdownContent 的自定义 `a` component 处理。）
 *
 * 纯函数，便于单测。
 */

import { parseOocUri } from "./oocUri";

export type OocTextSegment =
  | { kind: "text"; text: string }
  | { kind: "ooc"; uri: string; route: string };

// 裸 URI 边界：协议前缀 + 非空白/非闭合标点的连续串。末尾标点（. , ) ] 等）不吞进 URI。
const OOC_TOKEN_RE = /ooc:\/\/client\/[^\s<>()\[\]"']+/g;
// 句末标点：从匹配末尾剥掉，避免 "…/user." 把句号吞进 URI。
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

/**
 * 切分文本。只在 token 能被 parseOocUri 成功解析时才产出 `ooc` 段；
 * 无法识别的 `ooc://...`（如 ooc://world/...、缺段）当作普通文本保留（降级，不抛错）。
 */
export function splitOocText(content: string): OocTextSegment[] {
  const segments: OocTextSegment[] = [];
  let lastIdx = 0;
  for (const match of content.matchAll(OOC_TOKEN_RE)) {
    const start = match.index ?? 0;
    const uri = match[0].replace(TRAILING_PUNCT_RE, "");
    const route = parseOocUri(uri);
    if (route === null) continue; // 不识别 → 留在后续 text 段里
    if (start > lastIdx) {
      segments.push({ kind: "text", text: content.slice(lastIdx, start) });
    }
    segments.push({ kind: "ooc", uri, route });
    lastIdx = start + uri.length;
  }
  if (lastIdx < content.length) {
    segments.push({ kind: "text", text: content.slice(lastIdx) });
  }
  return segments;
}

/** content 是否含至少一个可识别的裸 ooc://client URI —— fast path 判定用。 */
export function hasOocUri(content: string): boolean {
  if (!content.includes("ooc://client/")) return false;
  return splitOocText(content).some((s) => s.kind === "ooc");
}
