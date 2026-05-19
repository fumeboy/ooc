/**
 * Mention parsing —— 从 comment text 中抽出 @objectId 列表。
 *
 * 纯字符串处理,不查 stones 目录(那是 service 层做的存在性校验)。
 *
 * 正则 `(?:^|\s)@([a-zA-Z][a-zA-Z0-9_-]*)\b`:
 * - 前置空白或行首要求,避开 `user@example.com` / `@deprecated function`
 *   等 false positive
 * - 首字符必须字母,后续允许字母 / 数字 / 下划线 / 短横线
 * - 与 objectId 命名约定一致
 */

const MENTION_PATTERN = /(?:^|\s)@([a-zA-Z][a-zA-Z0-9_-]*)\b/g;

/** 从 text 中解析所有 mention(去重保持首次出现顺序)。 */
export function parseMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
