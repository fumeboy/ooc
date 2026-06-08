import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
import type { TranscriptViewport } from "@ooc/core/extendable/_shared/transcript-viewport.js";

/**
 * search_window 的 matches 渲染视口（R1b: 复用 TranscriptViewport 的 tail/range 协议）。
 *
 * - 默认 { tail: 50 } —— 仅渲染末 50 个 match
 * - LLM 通过 set_results_window 命令切换：matches_tail / matches_start + matches_end
 * - 算法复用 _shared/transcript-viewport.ts（applyTranscriptViewport<M>）
 * - 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol
 */
export type ResultsViewport = TranscriptViewport;

/**
 * Search window — 把一次 glob / grep 的结果以持久 window 形式留在 context，
 * 让 LLM 可以引用某个 match (open_match index) 而不必从裸文本里 re-parse 路径。
 *
 * - kind 区分搜索类型；同一 type 下未来可加 ast-grep / structural search 等
 * - matches 截断到 200；超过则 truncated=true，LLM 可通过 refine_query 兜底
 * - grep kind 时 match 还携带 line + snippet；glob kind 只有 path
 * - resultsViewport: 默认 { tail: 50 } —— 用 set_results_window 调整可见区间
 * - 注册 method：open_match / close / set_results_window
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
  /**
   * @deprecated 移到 state.resultsViewport（WindowDisplayState）；保留以兼容旧 thread.json。
   * matches 渲染视口；由 readable 维度的 window method `set_results_window` 调整。
   */
  resultsViewport?: ResultsViewport;
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
