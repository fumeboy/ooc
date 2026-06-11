/**
 * @mention 解析 —— canonical 源（从 `persistable/mention.ts` 迁入）。
 *
 * 纯字符串处理，不查 stones 目录（存在性校验是 service 层职责）。
 *
 * 正则 `(?:^|\s)@([a-zA-Z][a-zA-Z0-9_-]*)\b`:
 * - 前置空白或行首要求，避开 `user@example.com` / `@deprecated function`
 *   等 false positive
 * - 首字符必须字母，后续允许字母 / 数字 / 下划线 / 短横线
 * - 与 objectId 命名约定一致
 */

/** mention 抽取正则；导出便于测试。 */
export const MENTION_PATTERN = /(?:^|\s)@([a-zA-Z][a-zA-Z0-9_-]*)\b/g;

/** 从 text 中解析所有 mention（去重保持首次出现顺序）。 */
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
