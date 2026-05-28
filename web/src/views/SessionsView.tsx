import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Layers, Plus, RefreshCw } from "lucide-react";
import { listSessions, createSession, type Session } from "../api";

export function SessionsView() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ objectUri: "ooc://stones/main/objects/supervisor", systemPrompt: "" });
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const res = await listSessions();
      setSessions(res.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate() {
    if (!draft.objectUri.trim()) return;
    setCreating(true);
    setError(undefined);
    try {
      const res = await createSession({
        objectUri: draft.objectUri.trim(),
        systemPrompt: draft.systemPrompt.trim() || undefined,
      });
      setShowForm(false);
      setDraft({ objectUri: "", systemPrompt: "" });
      navigate(`/sessions/${res.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="main-header">
        <Layers size={16} className="muted" />
        <div style={{ flex: 1 }}>
          <div className="main-title">Sessions</div>
          <div className="main-subtitle">{sessions.length} active session{sessions.length !== 1 ? "s" : ""}</div>
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={12} />
          Refresh
        </button>
        <button className="btn btn-sm primary" onClick={() => setShowForm((p) => !p)}>
          <Plus size={12} />
          New
        </button>
      </div>

      <div className="main-body">
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

        {showForm && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">New Session</div>
            <div className="stack">
              <label className="field-label">
                Object URI
                <input
                  className="input"
                  value={draft.objectUri}
                  onChange={(e) => setDraft({ ...draft, objectUri: e.target.value })}
                  placeholder="ooc://stones/main/objects/supervisor"
                />
              </label>
              <label className="field-label">
                System Prompt (optional)
                <textarea
                  className="textarea"
                  value={draft.systemPrompt}
                  onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                  placeholder="Override default system prompt…"
                />
              </label>
              <div className="row">
                <button className="btn btn-sm primary" onClick={handleCreate} disabled={creating || !draft.objectUri.trim()}>
                  {creating ? "Creating…" : "Create"}
                </button>
                <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {loading && <div className="loading">Loading sessions…</div>}

        {!loading && sessions.length === 0 && (
          <div className="empty">
            No sessions yet.<br />
            <span className="small muted">Create one to start a conversation with an OOC Object.</span>
          </div>
        )}

        {sessions.map((session) => (
          <button
            key={session.sessionId}
            className="list-item"
            style={{ width: "100%", marginBottom: 4 }}
            onClick={() => navigate(`/sessions/${session.sessionId}`)}
          >
            <Layers size={14} className="muted" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="list-item-label">{session.sessionId}</div>
              <div className="list-item-meta">
                {session.threadCount > 0 && `${session.threadCount} thread${session.threadCount !== 1 ? "s" : ""} · `}
                {session.createdAt ? new Date(session.createdAt).toLocaleString() : "no timestamp"}
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
