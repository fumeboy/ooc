/**
 * SessionObjectView — chat panel for a session object.
 * Faithful port of ooc-2 chat experience adapted to ooc-3 API.
 *
 * Layout: breadcrumb-bar + right-column with ChatPanel (timeline + composer).
 * Polling: refreshes thread every 3s when status is running.
 * Talk: POST /api/talk with target stone URI + sessionId.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Network, RefreshCw } from "lucide-react";
import {
  getFlowObject,
  getThread,
  talkTo,
  type FlowObjectDetail,
  type ThreadMessage,
  type ThreadState,
} from "../api";
import { ChatPanel } from "../components/chat/ChatPanel";

function StatusPill({ status }: { status: string }) {
  const statusClass = (() => {
    if (status === "running") return "status-running";
    if (status === "done") return "status-done";
    if (status === "failed") return "status-failed";
    if (status === "paused") return "status-paused";
    if (status === "waiting") return "status-waiting";
    return "";
  })();
  return <span className={`status-pill status-pill-thread ${statusClass}`}>{status}</span>;
}

export function SessionObjectView() {
  const { sessionId, objectName } = useParams<{ sessionId: string; objectName: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<FlowObjectDetail | null>(null);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  async function loadDetail() {
    if (!sessionId || !objectName) return;
    setLoadingDetail(true);
    try {
      const res = await getFlowObject(sessionId, objectName);
      setDetail(res);
      if (res.threadIds.length > 0 && !activeThreadId) {
        setActiveThreadId(res.threadIds[0]!);
      } else if (res.activeThreads.length > 0 && !activeThreadId) {
        setActiveThreadId(res.activeThreads[0]!.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDetail(false);
    }
  }

  const loadThread = useCallback(async (tid: string) => {
    if (!sessionId || !objectName) return;
    setLoadingThread(true);
    try {
      const res = await getThread(sessionId, objectName, tid);
      setThread(res.thread);
    } catch {
      // thread may not exist yet
    } finally {
      setLoadingThread(false);
    }
  }, [sessionId, objectName]);

  useEffect(() => { void loadDetail(); }, [sessionId, objectName]);
  useEffect(() => { if (activeThreadId) void loadThread(activeThreadId); }, [activeThreadId, loadThread]);

  // Polling when running
  useEffect(() => {
    if (!activeThreadId || thread?.status !== "running") return;
    const timer = window.setInterval(() => { void loadThread(activeThreadId); }, 3000);
    return () => clearInterval(timer);
  }, [activeThreadId, thread?.status, loadThread]);

  // Scroll to bottom on new messages
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length]);

  async function handleSend(text: string) {
    if (!text.trim() || !objectName || !sessionId) return;
    const targetUri = `ooc://stones/main/objects/${objectName}`;
    setSending(true);
    setError(undefined);
    try {
      await talkTo({ target: targetUri, content: text.trim(), sessionId });
      if (activeThreadId) await loadThread(activeThreadId);
      else await loadDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const messages: ThreadMessage[] = thread?.messages ?? [];
  const allThreadIds = [
    ...(detail?.threadIds ?? []),
    ...(detail?.activeThreads.map((t) => t.id) ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <>
      {/* breadcrumb bar */}
      <div className="breadcrumb-bar panel">
        <span className="breadcrumb-segments">
          <span className="breadcrumb-segment-wrap">
            <a
              href="/sessions"
              className="breadcrumb-segment is-link"
              onClick={(e) => { e.preventDefault(); navigate("/sessions"); }}
            >sessions</a>
          </span>
          <span className="breadcrumb-segment-wrap">
            <span className="breadcrumb-sep"> › </span>
            <a
              href={`/sessions/${sessionId}`}
              className="breadcrumb-segment is-link"
              title={sessionId}
              onClick={(e) => { e.preventDefault(); navigate(`/sessions/${sessionId}`); }}
            >
              {sessionId && sessionId.length > 24 ? sessionId.slice(0, 23) + "…" : sessionId}
            </a>
          </span>
          <span className="breadcrumb-segment-wrap">
            <span className="breadcrumb-sep"> › </span>
            <span className="breadcrumb-segment">{objectName}</span>
          </span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {thread && <StatusPill status={thread.status} />}
          {loadingThread && <span className="pill">updating…</span>}
          {error && <span className="muted small" title={error}>error</span>}
          <button
            className="refresh"
            onClick={() => { if (activeThreadId) void loadThread(activeThreadId); else void loadDetail(); }}
            disabled={loadingDetail || loadingThread}
            aria-label="Refresh"
            title="Refresh"
          >↻</button>
        </div>
      </div>

      {/* thread switcher if multiple threads */}
      {allThreadIds.length > 1 && (
        <div style={{ padding: "4px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
          {allThreadIds.map((tid) => (
            <button
              key={tid}
              className={`btn btn-sm${activeThreadId === tid ? " primary" : ""}`}
              onClick={() => setActiveThreadId(tid)}
            >
              {tid}
            </button>
          ))}
        </div>
      )}

      {/* main content: three-column right panel style */}
      <div className="right-column gap-1" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 6px 6px" }}>
        {/* header */}
        <div className="right-header panel" aria-label="object panel header">
          <div className="right-header-title" title={objectName}>
            <span className="right-header-label">object: </span>
            <span className="right-header-object">{objectName}</span>
          </div>
          <div className="right-header-actions">
            <button
              type="button"
              className="right-header-action"
              title="Back to session"
              onClick={() => navigate(`/sessions/${sessionId}`)}
            >
              <ArrowLeft size={13} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* chat panel */}
        <div className="right-panel" style={{ flex: 1, minHeight: 0 }}>
          {loadingDetail && <div className="empty">Loading…</div>}
          {!loadingDetail && (
            <ChatPanel
              objectId={objectName}
              messages={messages}
              threadStatus={thread?.status}
              onSend={handleSend}
              showComposer={!sending}
            />
          )}
        </div>

        {/* footer */}
        <div className="right-footer panel" aria-label="object panel footer">
          <div className="right-footer-status">
            {thread?.status ? (
              <span className={`status-pill status-pill-thread status-${thread.status}`}>
                {thread.status}
              </span>
            ) : (
              <span className="muted small">—</span>
            )}
          </div>
          <div className="right-footer-actions">
            <span className="muted small">
              {messages.length} msg{messages.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
