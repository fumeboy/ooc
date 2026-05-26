/**
 * ThreadInspectDetail — Session Threads Index 右栏只读检查面板。
 *
 * 当 SelectionDetail 选中 `thread:<obj>:<tid>` 时渲染本组件,
 * 展示该 thread 的 status / created / parent / talkPeers / shares 等信息，
 * 并嵌入 ThreadDetailTabs（Context Snapshot + Loop Timeline）作为深入入口。
 *
 * 设计参考: docs/2026-05-26-session-threads-index-design.md §6.3。
 *
 * 不允许"发消息"操作 — 那是 ChatPanel 的职责（仅 user.root 的 talk_window 可用）。
 */

import { useNavigate } from "react-router";
import type { ListThreadsItem } from "../types";
import { useDisplayName } from "../../objects";
import { usePollingThread } from "../../chat";
import { ThreadDetailTabs } from "./ThreadDetailTabs";
import { humanizeThreadId } from "../../../app/layout/threadDisplay";
import { toPath } from "../../../app/routing";

interface ThreadInspectDetailProps {
  sessionId: string;
  item: ListThreadsItem;
  selfObjectId?: string;
}

export function ThreadInspectDetail({
  sessionId,
  item,
  selfObjectId,
}: ThreadInspectDetailProps) {
  const { displayName } = useDisplayName(item.objectId);
  // 复用现有 polling 拿 ThreadContext, 喂给 ThreadDetailTabs / LoopTimeline
  const { thread } = usePollingThread(sessionId, item.objectId, item.threadId);
  const status = item.status ?? "unknown";

  return (
    <div className="thread-inspect-detail">
      <div className="thread-inspect-detail-header">
        <div className="thread-inspect-detail-ident">
          <span className="thread-inspect-detail-object" title={item.objectId}>
            {displayName}
          </span>
          <span className="thread-inspect-detail-sep">/</span>
          <span className="thread-inspect-detail-thread" title={item.threadId}>
            {humanizeThreadId(item.threadId)}
          </span>
          <span className={`thread-inspect-detail-status thread-inspect-detail-status-${status}`}>
            {status}
          </span>
        </div>
      </div>

      <dl className="thread-inspect-detail-meta">
        {item.createdAt !== undefined && (
          <>
            <dt>Created</dt>
            <dd>{formatTimestamp(item.createdAt)}</dd>
          </>
        )}
        {item.parentThreadId && (
          <>
            <dt>Parent</dt>
            <dd>
              <ThreadRefLink
                sessionId={sessionId}
                objectId={item.objectId}
                threadId={item.parentThreadId}
                label={humanizeThreadId(item.parentThreadId)}
              />
            </dd>
          </>
        )}
        {item.creatorObjectId && item.creatorThreadId && (
          <>
            <dt>Creator</dt>
            <dd>
              <ThreadRefLink
                sessionId={sessionId}
                objectId={item.creatorObjectId}
                threadId={item.creatorThreadId}
                label={`${item.creatorObjectId}/${humanizeThreadId(item.creatorThreadId)}`}
              />
            </dd>
          </>
        )}
        {item.childThreadIds && item.childThreadIds.length > 0 && (
          <>
            <dt>Children</dt>
            <dd>{item.childThreadIds.length}</dd>
          </>
        )}
        {item.isSuperFlow && (
          <>
            <dt>Flow</dt>
            <dd>super flow (reflectable)</dd>
          </>
        )}
      </dl>

      {(item.talkPeers?.length ?? 0) > 0 && (
        <section className="thread-inspect-detail-section">
          <h4 className="thread-inspect-detail-section-head">Talk peers ({item.talkPeers!.length})</h4>
          <ul className="thread-inspect-detail-list">
            {item.talkPeers!.map((p) => (
              <li key={p.windowId}>
                <ThreadRefLink
                  sessionId={sessionId}
                  objectId={p.targetObjectId}
                  threadId={p.targetThreadId}
                  label={`${p.targetObjectId}${
                    p.targetThreadId ? "/" + humanizeThreadId(p.targetThreadId) : ""
                  }`}
                />
                <span className="muted small"> · {p.windowId}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {((item.shares?.holding.length ?? 0) > 0 || (item.shares?.lentOut.length ?? 0) > 0) && (
        <section className="thread-inspect-detail-section">
          <h4 className="thread-inspect-detail-section-head">Shares</h4>
          {(item.shares?.holding.length ?? 0) > 0 && (
            <div className="thread-inspect-detail-shares-group">
              <span className="muted small">Borrowed (ref holding):</span>
              <ul className="thread-inspect-detail-list">
                {item.shares!.holding.map((h) => (
                  <li key={h.windowId}>
                    <code title={h.windowId}>{h.windowId}</code>
                    {h.ownerObjectId && h.ownerThreadId && (
                      <>
                        {" from "}
                        <ThreadRefLink
                          sessionId={sessionId}
                          objectId={h.ownerObjectId}
                          threadId={h.ownerThreadId}
                          label={`${h.ownerObjectId}/${humanizeThreadId(h.ownerThreadId)}`}
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(item.shares?.lentOut.length ?? 0) > 0 && (
            <div className="thread-inspect-detail-shares-group">
              <span className="muted small">Lent out:</span>
              <ul className="thread-inspect-detail-list">
                {item.shares!.lentOut.map((l) => (
                  <li key={l.windowId}>
                    <code title={l.windowId}>{l.windowId}</code>
                    {l.borrowerObjectId && l.borrowerThreadId && (
                      <>
                        {" → "}
                        <ThreadRefLink
                          sessionId={sessionId}
                          objectId={l.borrowerObjectId}
                          threadId={l.borrowerThreadId}
                          label={`${l.borrowerObjectId}/${humanizeThreadId(l.borrowerThreadId)}`}
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="thread-inspect-detail-tabs-wrap">
        <ThreadDetailTabs
          sessionId={sessionId}
          objectId={item.objectId}
          threadId={item.threadId}
          thread={thread}
          selfObjectId={selfObjectId}
        />
      </div>
    </div>
  );
}

/**
 * 跳到另一个 thread 的 SelectionDetail —— 用 ?selected=thread:<obj>:<tid>
 * 协议保持在同一 sessionId 内浏览。
 */
function ThreadRefLink({
  sessionId,
  objectId,
  threadId,
  label,
}: {
  sessionId: string;
  objectId: string;
  threadId?: string;
  label: string;
}) {
  const navigate = useNavigate();
  if (!threadId) {
    // 无 targetThreadId —— 比如新 talk_window 还没派送过；只能高亮 object 不能选 thread
    return <span title={objectId}>{label}</span>;
  }
  return (
    <button
      type="button"
      className="thread-inspect-detail-link"
      onClick={() =>
        navigate(
          toPath({
            kind: "flowsView",
            view: "index",
            sessionId,
            objectId,
            threadId,
          }),
        )
      }
      title={`${objectId}/${threadId}`}
    >
      {label}
    </button>
  );
}

function formatTimestamp(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleString();
  } catch {
    return String(ms);
  }
}
