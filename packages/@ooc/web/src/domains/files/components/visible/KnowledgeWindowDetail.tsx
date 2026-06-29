/**
 * Knowledge window 详情面板（视觉体）。
 *
 * Phase 1 / read-only：展示 path / source / presentation / description / createdAt 等
 * 元信息 + body（如有）。body 走 MarkdownContent 渲染，长正文（>400 char）默认折叠
 * 仅显示前 400 char，点击 "展开全文" 切换；折叠按钮使用语义化 className
 * `cw-knowledge-expand`。signature 与同目录其它 detail 组件保持一致：
 * `({ window }: { window: ContextWindow }) => JSX`，不带 callMethod。
 */
import React, { useState } from "react";
import type { ContextWindow } from "../../context-snapshot";
import { MarkdownContent } from "../../../../shared/ui/MarkdownContent";

type KnowledgeWindow = Extract<ContextWindow, { class: "knowledge" }>;

const KNOWLEDGE_PREVIEW_LIMIT = 400;
const KNOWLEDGE_DESC_LIMIT = 200;

export default function KnowledgeWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as KnowledgeWindow;
  const source = w.source ?? "explicit";
  const description = w.description;
  const truncatedDesc =
    description && description.length > KNOWLEDGE_DESC_LIMIT
      ? description.slice(0, KNOWLEDGE_DESC_LIMIT) + "…"
      : description;
  const createdAt = w.createdAt ? new Date(w.createdAt).toLocaleString() : null;

  const [expanded, setExpanded] = useState(false);
  const body = w.body ?? "";
  const longBody = body.length > KNOWLEDGE_PREVIEW_LIMIT;
  const previewBody = longBody && !expanded ? body.slice(0, KNOWLEDGE_PREVIEW_LIMIT) + "…" : body;

  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">path</span>
          <span className="llm-input-attr-value">{w.path}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">source</span>
          <span className="llm-input-attr-value">
            <span className={`cw-knowledge-source cw-knowledge-source-${source}`}>{source}</span>
          </span>
        </div>
        {w.presentation && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">presentation</span>
            <span className="llm-input-attr-value">{w.presentation}</span>
          </div>
        )}
        {truncatedDesc && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">description</span>
            <span className="llm-input-attr-value">{truncatedDesc}</span>
          </div>
        )}
        {createdAt && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">created</span>
            <span className="llm-input-attr-value">{createdAt}</span>
          </div>
        )}
      </div>
      {body.length === 0 ? (
        source === "explicit" ? (
          <div className="llm-input-empty">body 为空 — 由 stone knowledge loader 解析</div>
        ) : (
          <div className="llm-input-empty">body 为空</div>
        )
      ) : (
        <div className="llm-input-md-body">
          <MarkdownContent content={previewBody} />
          {longBody && (
            <button
              type="button"
              className="cw-knowledge-expand"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起" : `展开全文 (${body.length} 字)`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
