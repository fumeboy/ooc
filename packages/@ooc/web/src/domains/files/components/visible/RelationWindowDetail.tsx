/**
 * Relation window 详情面板。
 *
 * 从 ContextSnapshotViewer 内联组件抽出（线 A：统一 window 渲染解析层），签名统一为
 * `({ window }: { window: ContextWindow }) => JSX`，供 builtin-visible-registry 注册。
 *
 * 2026-05-27 修订（撤回 R8-5 + 删除占位文案）：
 * - peer_readme section 重新挂回（render: stones/<peer>/readme.md, 只读）；
 *   default visibility 让大量 sibling/child relation 自动派生，没 readme 内容
 *   则空壳，违背 default visibility 初衷
 * - 缺失的 section 不再渲染占位文案；exists=false 或 body 空直接跳过整段
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";
import { MarkdownContent } from "../../../../shared/ui/MarkdownContent";
import { useDisplayName } from "../../../objects";

type RelationWindow = Extract<ContextWindow, { type: "relation" }>;

export default function RelationWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as RelationWindow;
  const { displayName } = useDisplayName(w.peerId);
  return (
    <div className="llm-input-md-body" style={{ padding: "8px 12px" }}>
      <div className="llm-input-attrs" style={{ marginBottom: 8 }}>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">peer</span>
          <span className="llm-input-attr-value">
            {displayName !== w.peerId ? `${displayName} (${w.peerId})` : w.peerId}
          </span>
        </div>
      </div>

      {w.peerReadmeExists && w.peerReadmeBody ? (
        <>
          <h3 style={{ marginTop: 16 }}>peer · readme</h3>
          {w.peerReadmePath ? (
            <div className="muted small" style={{ marginBottom: 4 }}>{w.peerReadmePath}</div>
          ) : null}
          <MarkdownContent content={w.peerReadmeBody} />
        </>
      ) : null}

      {w.selfLongTermExists && w.selfLongTermBody ? (
        <>
          <h3 style={{ marginTop: 16 }}>self · long_term</h3>
          {w.selfLongTermPath ? (
            <div className="muted small" style={{ marginBottom: 4 }}>{w.selfLongTermPath}</div>
          ) : null}
          <MarkdownContent content={w.selfLongTermBody} />
        </>
      ) : null}

      {w.selfSessionExists && w.selfSessionBody ? (
        <>
          <h3 style={{ marginTop: 16 }}>self · session</h3>
          {w.selfSessionPath ? (
            <div className="muted small" style={{ marginBottom: 4 }}>{w.selfSessionPath}</div>
          ) : null}
          <MarkdownContent content={w.selfSessionBody} />
        </>
      ) : null}
    </div>
  );
}
