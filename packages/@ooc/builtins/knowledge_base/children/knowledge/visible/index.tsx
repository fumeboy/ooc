import type { Data } from "../types.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import React from "react";
import { MarkdownContent } from "@ooc/web/src/shared/ui/MarkdownContent";

/** Knowledge window 详情面板（业务字段读自实例 `data`）。 */
export default function KnowledgeWindowDetail({ window }: { window: OocObjectInstance<Data> }) {
  const data = objectDataOf(window);
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">path</span>
          <span className="llm-input-attr-value">{data.path}</span>
        </div>
        {data.source && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">source</span>
            <span className="llm-input-attr-value">{data.source}</span>
          </div>
        )}
        {data.presentation && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">presentation</span>
            <span className="llm-input-attr-value">{data.presentation}</span>
          </div>
        )}
        {data.description && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">description</span>
            <span className="llm-input-attr-value">{data.description}</span>
          </div>
        )}
      </div>
      {data.body && (
        <div className="llm-input-md-body">
          <MarkdownContent content={data.body} />
        </div>
      )}
    </>
  );
}

export { KnowledgeWindowDetail as WindowDetail };
