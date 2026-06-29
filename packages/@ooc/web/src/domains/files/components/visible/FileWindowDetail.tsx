/**
 * File window 详情面板(视觉体)。
 *
 * Phase 1: read-only 静态展示 file window 元属性(path / lines viewport / columns
 * viewport / status / createdAt)。文件正文本身由 FileWindowContentView 在 viewer
 * 别处渲,本面板只展示"打开了哪个文件、可视范围在哪儿"。
 *
 * 签名统一为 `({ window }: { window: ContextWindow }) => JSX`,不带 callMethod。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

type FileWindow = Extract<ContextWindow, { class: "file" }>;

/** 长 path 首尾 truncate;> 80 字符时只保留 prefix + … + suffix。 */
function truncatePath(path: string, limit = 80): string {
  if (path.length <= limit) return path;
  const keep = Math.floor((limit - 1) / 2);
  return `${path.slice(0, keep)}…${path.slice(path.length - keep)}`;
}

export default function FileWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as FileWindow;
  const pathDisplay = truncatePath(w.path);
  const linesDisplay = w.lines ? `[${w.lines[0]}, ${w.lines[1]})` : undefined;
  const columnsDisplay = w.columns ? `[${w.columns[0]}, ${w.columns[1]})` : undefined;
  const createdAtDisplay = w.createdAt
    ? new Date(w.createdAt).toLocaleString()
    : undefined;
  return (
    <div className="llm-input-attrs">
      <div className="llm-input-attr-row">
        <span className="llm-input-attr-key">path</span>
        <span className="llm-input-attr-value" title={w.path}>{pathDisplay}</span>
      </div>
      <div className="llm-input-attr-row">
        <span className="llm-input-attr-key">status</span>
        <span className="llm-input-attr-value">{w.status}</span>
      </div>
      {linesDisplay && (
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">lines</span>
          <span className="llm-input-attr-value">{linesDisplay}</span>
        </div>
      )}
      {columnsDisplay && (
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">columns</span>
          <span className="llm-input-attr-value">{columnsDisplay}</span>
        </div>
      )}
      {createdAtDisplay && (
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">created at</span>
          <span className="llm-input-attr-value">{createdAtDisplay}</span>
        </div>
      )}
    </div>
  );
}
