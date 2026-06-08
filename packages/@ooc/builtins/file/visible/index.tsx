import type { FileWindow } from "../types.js";
import React from "react";
import { FileWindowContentView } from "@ooc/web/src/domains/files/components/FileWindowContentView";

/** File window 详情面板。
 *
 * 展示参数（lines / columns）现归 `window.state`（WindowDisplayState）；旧 thread.json
 * 仍可能平铺在 window 顶层，故 `window.state?.X ?? window.X` 向后兼容读取。 */
export default function FileWindowDetail({ window }: { window: FileWindow }) {
  const lines = window.state?.lines ?? window.lines;
  const columns = window.state?.columns ?? window.columns;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">path</span>
          <span className="llm-input-attr-value">{window.path}</span>
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
      <FileWindowContentView path={window.path} lines={lines} columns={columns} />
    </>
  );
}

export { FileWindowDetail as WindowDetail };
