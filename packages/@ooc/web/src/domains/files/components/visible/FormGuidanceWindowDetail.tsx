/**
 * Form guidance window 详情面板。
 *
 * 从 ContextSnapshotViewer 内联 JSX 抽出（线 A：统一 window 渲染解析层），签名统一为
 * `({ window }: { window: ContextWindow }) => JSX`。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

export default function FormGuidanceWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as ContextWindow & {
    boundFormId?: string;
    relevance?: { priorityHint?: string };
    provenance?: { reason?: { sourceId?: string } };
  };
  return (
    <div className="llm-input-guidance">
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">bound_to_form</span>
          <span className="llm-input-attr-value">{w.boundFormId ?? "—"}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">priority</span>
          <span className="llm-input-attr-value">{w.relevance?.priorityHint ?? "normal"}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">source</span>
          <span className="llm-input-attr-value">{w.provenance?.reason?.sourceId ?? "—"}</span>
        </div>
      </div>
      <div className="llm-input-guidance-title">{w.title}</div>
    </div>
  );
}
