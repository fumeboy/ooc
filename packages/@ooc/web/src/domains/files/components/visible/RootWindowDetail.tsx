/**
 * Root window 详情面板（视觉体）。
 *
 * Phase 1 / read-only：极简组件，root window 几乎没有业务字段——仅展示 id / title /
 * status / createdAt，末尾给一句说明锚定它是 thread context 入口。signature 与同目录
 * 其它 detail 组件保持一致：`({ window }: { window: ContextWindow }) => JSX`，不带
 * callMethod。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

type RootWindow = Extract<ContextWindow, { class: "root" }>;

export default function RootWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as RootWindow;
  const createdAt = w.createdAt ? new Date(w.createdAt).toLocaleString() : null;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">id</span>
          <span className="llm-input-attr-value">{w.id}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">title</span>
          <span className="llm-input-attr-value">{w.title}</span>
        </div>
        {w.status && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">status</span>
            <span className="llm-input-attr-value">{w.status}</span>
          </div>
        )}
        {createdAt && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">created</span>
            <span className="llm-input-attr-value">{createdAt}</span>
          </div>
        )}
      </div>
      <div className="muted small">Root anchor window — thread context 入口</div>
    </>
  );
}
