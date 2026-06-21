import type { Data as SearchData } from "../types.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import React from "react";

/** Search window 详情面板（业务字段读自实例 `data`）。 */
export default function SearchWindowDetail({ window }: { window: OocObjectInstance<SearchData> }) {
  const data = objectDataOf(window);
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">kind</span>
          <span className="llm-input-attr-value">{data.kind}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">query</span>
          <span className="llm-input-attr-value">{data.query}</span>
        </div>
        {data.searchRoot && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">search_root</span>
            <span className="llm-input-attr-value">{data.searchRoot}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">matches</span>
          <span className="llm-input-attr-value">
            {data.matches.length}{data.truncated ? " (truncated)" : ""}
          </span>
        </div>
      </div>
      {data.matches.length > 0 && (
        <ul className="llm-input-transcript-list">
          {data.matches.map((m) => (
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
