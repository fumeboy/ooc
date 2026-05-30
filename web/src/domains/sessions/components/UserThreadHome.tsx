/**
 * UserThreadHome — Session index: shows all objects + threads in the session.
 *
 * In ooc-3 this replaces the StaffView (Batch 5) with a simpler list.
 * Each row: objectId + threadId → click navigates to thread_context view.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { ThreadContext } from "../../chat/model";
import { fetchSessionThreads } from "../../chat/query";
import { toPath } from "../../../app/routing";
import { displayNameOf, useDisplayNames } from "../../objects";

export function UserThreadHome({
  sessionId,
  thread,
  selfObjectId,
  onUserReply,
}: {
  sessionId: string;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<{ objectId: string; threadId: string; status?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSessionThreads(sessionId)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  const objectIds = items.map((i) => i.objectId);
  const names = useDisplayNames(objectIds);

  function selectThread(objectId: string, threadId: string) {
    navigate(toPath({ kind: "flowsView", view: "thread_context", sessionId, objectId, threadId }));
  }

  if (loading) {
    return (
      <div className="section compact" style={{ padding: 24 }}>
        <span className="muted small">Loading session threads…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="section compact" style={{ padding: 24 }}>
        <div className="error">Error loading threads: {error}</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="section compact" style={{ padding: 24 }}>
        <strong>Session: {sessionId}</strong>
        <p className="muted small" style={{ marginTop: 8 }}>No threads found in this session.</p>
      </div>
    );
  }

  return (
    <div className="section compact" style={{ padding: "16px 24px" }}>
      <div style={{ marginBottom: 12 }}>
        <strong>Session threads</strong>
        <span className="muted small" style={{ marginLeft: 8 }}>{sessionId}</span>
      </div>
      <div className="stack gap-1">
        {items.map((item) => {
          const name = names[item.objectId] ?? item.objectId;
          const isActive = item.objectId === selfObjectId && item.threadId === thread?.id;
          return (
            <button
              key={`${item.objectId}/${item.threadId}`}
              type="button"
              className={`thread-list-item${isActive ? " is-active" : ""}`}
              onClick={() => selectThread(item.objectId, item.threadId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: isActive ? "var(--accent-bg, #e8f0fe)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{name}</div>
                <div className="muted small" style={{ fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.threadId}
                </div>
              </div>
              {item.status && (
                <span className={`status-pill status-${item.status}`} style={{ fontSize: 11 }}>
                  {item.status}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
