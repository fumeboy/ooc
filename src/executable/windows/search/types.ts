import type { BaseContextWindow } from "../_shared/types.js";

/**
 * Search window — 把一次 glob / grep 的结果以持久 window 形式留在 context，
 * 让 LLM 可以引用某个 match (open_match index) 而不必从裸文本里 re-parse 路径。
 *
 * - kind 区分搜索类型；同一 type 下未来可加 ast-grep / structural search 等
 * - matches 截断到 200；超过则 truncated=true，LLM 可通过 refine_query 兜底
 * - grep kind 时 match 还携带 line + snippet；glob kind 只有 path
 * - 注册 command：open_match / close
 */
export interface SearchWindow extends BaseContextWindow {
  type: "search";
  status: "open" | "closed";
  kind: "glob" | "grep";
  /** 触发本次搜索的查询：glob pattern 或 grep regex */
  query: string;
  /** 命中条目；按 (path, line) 字典序排好，截断后保留前 200 条 */
  matches: SearchMatch[];
  /** 是否被 200 上限截断 */
  truncated: boolean;
  /** 仅 grep kind：搜索的根目录（便于 LLM 理解 match.path 的相对性） */
  searchRoot?: string;
}

export interface SearchMatch {
  /** 在 matches 数组中的稳定下标，作为 open_match(index) 的引用 */
  index: number;
  /** 命中文件路径 */
  path: string;
  /** 仅 grep kind */
  line?: number;
  /** 仅 grep kind；命中所在行的内容，单行截断到 200 字符 */
  snippet?: string;
}
