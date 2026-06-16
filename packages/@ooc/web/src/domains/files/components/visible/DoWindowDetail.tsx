/**
 * Do window 详情面板（视觉体）。
 *
 * 从 ContextSnapshotViewer 内联 JSX 抽出（线 A：统一 window 渲染解析层），签名统一为
 * `({ window }: { window: ContextWindow }) => JSX`。do window 的 transcript 由 viewer 正交渲染。
 */
import React from "react";
import { type ContextWindow, isCreatorWindowId } from "../../context-snapshot";

export default function DoWindowDetail({ window }: { window: ContextWindow }) {
  const data = (window.data ?? {}) as { targetThreadId?: string };
  return (
    <div className="llm-input-attrs">
      <div className="llm-input-attr-row">
        <span className="llm-input-attr-key">target_thread</span>
        <span className="llm-input-attr-value">{data.targetThreadId}</span>
      </div>
      {isCreatorWindowId(window.id) && (
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">role</span>
          <span className="llm-input-attr-value">creator window（不可关闭）</span>
        </div>
      )}
    </div>
  );
}
