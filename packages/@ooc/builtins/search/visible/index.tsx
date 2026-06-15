import type { Data as SearchData } from "../types.js";
import React from "react";

/** Search window 详情面板。 */
export default function SearchWindowDetail({ window }: { window: SearchData }) {
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">kind</span>
          <span className="llm-input-attr-value">{window.kind}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">query</span>
          <span className="llm-input-attr-value">{window.query}</span>
        </div>
        {window.searchRoot && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">search_root</span>
            <span className="llm-input-attr-value">{window.searchRoot}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">matches</span>
          <span className="llm-input-attr-value">
            {window.matches.length}{window.truncated ? " (truncated)" : ""}
          </span>
        </div>
      </div>
      {window.matches.length > 0 && (
        <ul className="llm-input-transcript-list">
          {window.matches.map((m) => (
            <li key={m.index} className="llm-input-transcript-item">
              <div className="llm-input-transcript-meta">
                <span className="llm-input-transcript-index">[#{m.index}]</span>
                <span className="llm-input-transcript-dir">{m.path}{m.line ? `:${m.line}` : ""}</span>
              </div>
              {m.snippet && <pre className="llm-input-transcript-content">{m.snippet}</pre>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export { SearchWindowDetail as WindowDetail };
