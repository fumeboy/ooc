import type { Data } from "../types.js";
import type { FileWin } from "../readable/index.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import React from "react";
import { FileWindowContentView } from "@ooc/web/src/domains/files/components/FileWindowContentView";

/** File window 详情面板。
 *
 * 投影态（lines / columns viewport）归实例 `win`；业务字段（path）归 `data`。 */
export default function FileWindowDetail({ window }: { window: OocObjectInstance<Data, FileWin> }) {
  const lines = window.win?.lines;
  const columns = window.win?.columns;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">path</span>
          <span className="llm-input-attr-value">{window.data.path}</span>
        </div>
        {lines && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">lines</span>
            <span className="llm-input-attr-value">{lines.join("-")}</span>
          </div>
        )}
        {columns && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">columns</span>
            <span className="llm-input-attr-value">{columns.join("-")}</span>
          </div>
        )}
      </div>
      <FileWindowContentView path={window.data.path} lines={lines} columns={columns} />
    </>
  );
}

export { FileWindowDetail as WindowDetail };
