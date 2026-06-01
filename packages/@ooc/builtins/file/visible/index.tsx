import type { FileWindow } from "../types.js";
import React from "react";
import { FileWindowContentView } from "@ooc/web/src/domains/files/components/FileWindowContentView";

/** File window 详情面板。 */
export default function FileWindowDetail({ window }: { window: FileWindow }) {
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">path</span>
          <span className="llm-input-attr-value">{window.path}</span>
        </div>
        {window.lines && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">lines</span>
            <span className="llm-input-attr-value">{window.lines.join("-")}</span>
          </div>
        )}
        {window.columns && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">columns</span>
            <span className="llm-input-attr-value">{window.columns.join("-")}</span>
          </div>
        )}
      </div>
      <FileWindowContentView path={window.path} lines={window.lines} columns={window.columns} />
    </>
  );
}

export { FileWindowDetail as WindowDetail };
