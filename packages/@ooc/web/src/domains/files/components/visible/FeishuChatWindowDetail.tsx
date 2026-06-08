/**
 * Feishu chat window 详情面板：行式消息流。
 *
 * 从 ContextSnapshotViewer 内联组件抽出（线 A：统一 window 渲染解析层），签名统一为
 * `({ window }: { window: ContextWindow }) => JSX`。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

type FeishuChatWindow = Extract<ContextWindow, { type: "feishu_chat" }>;

export default function FeishuChatWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as FeishuChatWindow;
  const lastRefresh = w.lastRefreshAtMs
    ? new Date(w.lastRefreshAtMs).toLocaleString()
    : "(never)";
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">chat</span>
          <span className="llm-input-attr-value">{w.chatName} ({w.chatId})</span>
        </div>
        {w.chatType && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">chat type</span>
            <span className="llm-input-attr-value">{w.chatType}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">mode</span>
          <span className="llm-input-attr-value">
            {w.mode}
            {w.mode === "tail" && w.tailCount ? ` (${w.tailCount})` : ""}
            {w.mode === "search" && w.searchQuery ? ` "${w.searchQuery}"` : ""}
            {w.mode === "thread" && w.threadAnchorMessageId ? ` @${w.threadAnchorMessageId}` : ""}
          </span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">last refresh</span>
          <span className="llm-input-attr-value">{lastRefresh}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">buffer size</span>
          <span className="llm-input-attr-value">{w.buffer.length} message{w.buffer.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      {w.buffer.length === 0 ? (
        <div className="llm-input-empty">buffer 为空,先 refresh。</div>
      ) : (
        <ul className="cw-feishu-msg-list">
          {w.buffer.map((m) => {
            const time = new Date(m.createTimeMs).toLocaleTimeString();
            return (
              <li key={m.messageId} className="cw-feishu-msg-row">
                <span className="cw-feishu-msg-time">{time}</span>
                <span className="cw-feishu-msg-sender">{m.sender}</span>
                {m.senderKind && (
                  <span className="cw-feishu-msg-kind" data-kind={m.senderKind}>
                    {m.senderKind}
                  </span>
                )}
                {m.replyToMessageId && (
                  <span className="cw-feishu-msg-reply muted small">↪ {m.replyToMessageId}</span>
                )}
                <span className="cw-feishu-msg-text">{m.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
