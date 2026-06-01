import type { KnowledgeWindow } from "../types.js";
import React from "react";
import { MarkdownContent } from "@ooc/web/src/shared/ui/MarkdownContent";

/** Knowledge window 详情面板。 */
export default function KnowledgeWindowDetail({ window }: { window: KnowledgeWindow }) {
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">path</span>
          <span className="llm-input-attr-value">{window.path}</span>
        </div>
        {window.source && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">source</span>
            <span className="llm-input-attr-value">{window.source}</span>
          </div>
        )}
        {window.presentation && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">presentation</span>
            <span className="llm-input-attr-value">{window.presentation}</span>
          </div>
        )}
        {window.description && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">description</span>
            <span className="llm-input-attr-value">{window.description}</span>
          </div>
        )}
      </div>
      {window.body && (
        <div className="llm-input-md-body">
          <MarkdownContent content={window.body} />
        </div>
      )}
    </>
  );
}

export { KnowledgeWindowDetail as WindowDetail };
