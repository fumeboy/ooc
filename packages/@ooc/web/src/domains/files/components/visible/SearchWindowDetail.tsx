/**
 * Search window 详情面板(视觉体)。
 *
 * Phase 1: read-only 静态展示 search window 的查询参数(kind / query / searchRoot
 * / truncated) + matches 列表。grep 命中带 snippet,glob 命中只展示 path。matches
 * 超过 50 条时只展示前 50 条并附 "and N more" 提示,避免长列表卡渲染。
 *
 * 签名统一为 `({ window }: { window: ContextWindow }) => JSX`,不带 callMethod。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

type SearchWindow = Extract<ContextWindow, { class: "search" }>;

const MATCH_DISPLAY_LIMIT = 50;
const SNIPPET_CHAR_LIMIT = 100;

/** snippet 单行展示,超过 limit 截断加省略号。 */
function truncateSnippet(snippet: string, limit = SNIPPET_CHAR_LIMIT): string {
  const single = snippet.replace(/\s+/g, " ").trim();
  if (single.length <= limit) return single;
  return `${single.slice(0, limit)}…`;
}

export default function SearchWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as SearchWindow;
  const total = w.matches.length;
  const shown = w.matches.slice(0, MATCH_DISPLAY_LIMIT);
  const overflow = total - shown.length;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">kind</span>
          <span className="llm-input-attr-value">{w.kind}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">query</span>
          <span className="llm-input-attr-value">{w.query}</span>
        </div>
        {w.searchRoot && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">search root</span>
            <span className="llm-input-attr-value" title={w.searchRoot}>{w.searchRoot}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">matches</span>
          <span className="llm-input-attr-value">
            {total}
            {w.truncated ? " (truncated)" : ""}
          </span>
        </div>
        {w.truncated && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">warn</span>
            <span className="llm-input-attr-value muted small">
              结果被后端截断,可能还有更多命中未列出
            </span>
          </div>
        )}
      </div>
      {total === 0 ? (
        <div className="llm-input-empty">no matches</div>
      ) : (
        <ul className="cw-search-match-list">
          {shown.map((m) => {
            const locator = m.line !== undefined ? `${m.path}:${m.line}` : m.path;
            return (
              <li key={`${m.index}:${m.path}:${m.line ?? ""}`} className="cw-search-match-row">
                <span className="cw-search-match-index muted small">#{m.index}</span>
                <span className="cw-search-match-path" title={m.path}>{locator}</span>
                {m.snippet && (
                  <span className="cw-search-match-snippet muted small">
                    {truncateSnippet(m.snippet)}
                  </span>
                )}
              </li>
            );
          })}
          {overflow > 0 && (
            <li className="cw-search-match-row muted small">
              and {overflow} more
            </li>
          )}
        </ul>
      )}
    </>
  );
}
