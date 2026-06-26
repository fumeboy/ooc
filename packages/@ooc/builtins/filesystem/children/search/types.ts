/**
 * search —— object data 结构（types.ts = 纯 Data）。
 *
 * 把一次 glob / grep 的结果以持久 object 形式留在 context，让 LLM 可以引用某个
 * match（open_match index）而不必从裸文本里 re-parse 路径。
 *
 * 只含**业务字段**；**不含**窗的元信息字段（id/class/title/status/createdAt）——那些由 runtime 管理。
 * 展示态（matches 渲染视口）也不在此，归 readable 的投影态 `win`（见 readable/index.ts 的 `SearchWin`）。
 *
 * - kind      : 区分搜索类型；同一 type 下未来可加 ast-grep / structural search 等
 * - query     : 触发本次搜索的查询：glob pattern 或 grep regex
 * - matches   : 命中条目；按 (path, line) 字典序排好，截断后保留前 200 条
 * - truncated : 是否被 200 上限截断（LLM 可通过 refine_query 兜底）
 * - searchRoot: 搜索的根目录（便于 LLM 理解 match.path 的相对性；open_match 据此解析绝对路径）
 */
export interface Data {
  kind: "glob" | "grep";
  query: string;
  matches: SearchMatch[];
  truncated: boolean;
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

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
