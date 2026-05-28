import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, RefreshCw, Send } from "lucide-react";
import {
  getFlowObject,
  getThread,
  talkTo,
  type FlowObjectDetail,
  type ThreadMessage,
  type ThreadState,
} from "../api";

function messageContent(msg: ThreadMessage): string {
  if (typeof msg.content === "string") return msg.content;
  try {
    return JSON.stringify(msg.content, null, 2);
  } catch {
    return String(msg.content);
  }
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "running" ? "pill running" : status === "done" ? "pill done" : status === "failed" ? "pill failed" : "pill";
  return <span className={cls}>{status}</span>;
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
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [talkResponse, setTalkResponse] = useState<string | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  async function loadDetail() {
    if (!sessionId || !objectName) return;
    setLoadingDetail(true);
    try {
      const res = await getFlowObject(sessionId, objectName);
      setDetail(res);
      // Auto-select first thread
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

  useEffect(() => {
    if (activeThreadId) void loadThread(activeThreadId);
  }, [activeThreadId, loadThread]);

  // Polling: refresh thread every 3s when running
  useEffect(() => {
    if (!activeThreadId || thread?.status !== "running") return;
    const timer = window.setInterval(() => {
      void loadThread(activeThreadId);
    }, 3000);
    return () => clearInterval(timer);
  }, [activeThreadId, thread?.status, loadThread]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length]);

  async function handleSend() {
    if (!text.trim() || !objectName || !sessionId) return;
    const targetUri = `ooc://flows/${sessionId}/objects/${objectName}`;
    setSending(true);
    setError(undefined);
    setTalkResponse(undefined);
    try {
      const res = await talkTo({ target: targetUri, content: text.trim(), sessionId });
      setTalkResponse(res.response);
      setText("");
      // Refresh thread after talk
      if (activeThreadId) await loadThread(activeThreadId);
      else await loadDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      void handleSend();
    }
  }

  const displayMessages = thread?.messages ?? [];

  return (
    <>
      <div className="main-header">
        <button className="btn-icon" onClick={() => navigate(`/sessions/${sessionId}`)}>
          <ArrowLeft size={15} />
        </button>
        <div style={{ flex: 1 }}>
          <div className="main-title">{objectName}</div>
          <div className="main-subtitle row" style={{ gap: 6 }}>
            <span className="muted small" style={{ fontFamily: "monospace", fontSize: 11 }}>
              {sessionId}
            </span>
            {thread && <StatusPill status={thread.status} />}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => { void loadDetail(); }} disabled={loadingDetail}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Thread selector */}
      {(detail?.threadIds.length ?? 0) > 1 && (
        <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
          {detail!.threadIds.map((tid) => (
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

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 0, minHeight: 0 }}>
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        {loadingDetail && <div className="loading">Loading…</div>}

        {!loadingDetail && displayMessages.length === 0 && (
          <div className="empty">No messages yet. Send a talk message below.</div>
        )}

        <div className="thread-messages">
          {displayMessages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="message-role">{msg.role}</div>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {messageContent(msg)}
              </div>
            </div>
          ))}
        </div>

        {talkResponse && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="detail-section-title">Talk Response</div>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{talkResponse}</div>
          </div>
        )}

        {loadingThread && (
          <div style={{ textAlign: "center", padding: "8px", color: "var(--muted-fg)", fontSize: 12 }}>
            Updating…
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="composer">
        <textarea
          className="composer-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Talk to ${objectName}… (Ctrl+Enter to send)`}
          disabled={sending}
        />
        <button
          className="btn primary"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          style={{ flexShrink: 0 }}
        >
          {sending ? <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={14} />}
        </button>
      </div>
    </>
  );
}
