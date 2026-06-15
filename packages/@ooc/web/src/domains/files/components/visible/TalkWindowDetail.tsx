/**
 * Talk window 详情面板（视觉体）。
 *
 * 从 ContextSnapshotViewer 内联 JSX 抽出（线 A：统一 window 渲染解析层），签名统一为
 * `({ window }: { window: ContextWindow }) => JSX`。talk 的 transcript / 内联 composer
 * 仍由 viewer 正交渲染（交互留原处，仅视觉体迁出）。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

export default function TalkWindowDetail({ window }: { window: ContextWindow }) {
  const data = (window.data ?? {}) as { target?: string; conversationId?: string };
  return (
    <div className="llm-input-attrs">
      <div className="llm-input-attr-row">
        <span className="llm-input-attr-key">target</span>
        <span className="llm-input-attr-value">{data.target}</span>
      </div>
      <div className="llm-input-attr-row">
        <span className="llm-input-attr-key">conversation</span>
        <span className="llm-input-attr-value">{data.conversationId}</span>
      </div>
    </div>
  );
}
