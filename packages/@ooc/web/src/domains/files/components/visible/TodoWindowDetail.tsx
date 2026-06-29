/**
 * Todo window 详情面板（视觉体）。
 *
 * Phase 1 read-only:attrs 区展示 content / status / createdAt / activatesOn,
 * 签名对齐其他 visible 组件 `({ window }: { window: ContextWindow }) => JSX`。
 * 不带 callMethod,后续 Phase 2 才接 done/reopen 等交互。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

type TodoWindow = Extract<ContextWindow, { class: "todo" }>;

export default function TodoWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as TodoWindow;
  const createdAt = w.createdAt ? new Date(w.createdAt).toLocaleString() : null;
  const activatesOn = w.activatesOn && w.activatesOn.length > 0 ? w.activatesOn.join(", ") : null;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">status</span>
          <span className="llm-input-attr-value">
            <span data-status={w.status}>{w.status}</span>
          </span>
        </div>
        {createdAt && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">created</span>
            <span className="llm-input-attr-value">{createdAt}</span>
          </div>
        )}
        {activatesOn && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">activates on</span>
            <span className="llm-input-attr-value">{activatesOn}</span>
          </div>
        )}
      </div>
      {w.content ? (
        <pre className="llm-input-pre">{w.content}</pre>
      ) : (
        <div className="llm-input-empty">content 为空。</div>
      )}
    </>
  );
}
