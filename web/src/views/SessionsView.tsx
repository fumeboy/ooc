/**
 * SessionsView — ooc-2-style welcome + create session form.
 * Uses ooc-3 /api/sessions endpoints.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { listSessions, createSession, listStones, type Session, type StoneListItem } from "../api";

function defaultSessionId(): string {
  return `web-${Date.now()}`;
}

export function SessionsView() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stones, setStones] = useState<StoneListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    sessionId: defaultSessionId(),
    objectUri: "",
    systemPrompt: "",
  });

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const [sessRes, stonesRes] = await Promise.all([listSessions(), listStones()]);
      setSessions(sessRes.sessions);
      setStones(stonesRes.stones);
      if (!draft.objectUri && stonesRes.stones.length > 0) {
        const first = stonesRes.stones[0]!;
        setDraft((d) => ({ ...d, objectUri: `ooc://stones/main/objects/${first.name}` }));
      }
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
      navigate(`/sessions/${encodeURIComponent(res.sessionId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="main-body">
      <div className="welcome-shell">
        <div className="welcome-stack">
          <div className="welcome-hero">
            <strong className="welcome-title">Welcome to OOC-3</strong>
            <div className="welcome-copy">
              Create your first session, or pick one from the sidebar to continue.
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="panel ui-card welcome-card">
            <div className="welcome-card-head">
              <strong>Create session</strong>
              <div className="muted small">
                Choose an object and type your first message — we'll start a new session.
              </div>
            </div>

            <fieldset className="welcome-form-grid welcome-form-fieldset" disabled={creating}>
              <div className="welcome-form-field">
                <label className="ui-label" htmlFor="session-id">Session ID</label>
                <input
                  id="session-id"
                  className="input ui-input"
                  value={draft.sessionId}
                  onChange={(e) => setDraft({ ...draft, sessionId: e.target.value })}
                  placeholder="session id"
                />
              </div>

              <div className="welcome-form-field">
                <label className="ui-label" htmlFor="object-uri">Talk to (object URI)</label>
                {stones.length > 0 ? (
                  <div className="ui-select-shell">
                    <select
                      id="object-uri"
                      className="input ui-select"
                      value={draft.objectUri}
                      onChange={(e) => setDraft({ ...draft, objectUri: e.target.value })}
                    >
                      {stones.map((stone) => (
                        <option
                          key={stone.uri}
                          value={`ooc://stones/main/objects/${stone.name}`}
                        >
                          {stone.title ?? stone.name}
                        </option>
                      ))}
                    </select>
                    <span className="ui-select-icon">▾</span>
                  </div>
                ) : (
                  <input
                    id="object-uri"
                    className="input ui-input"
                    value={draft.objectUri}
                    onChange={(e) => setDraft({ ...draft, objectUri: e.target.value })}
                    placeholder="ooc://stones/main/objects/supervisor"
                  />
                )}
              </div>

              <div className="welcome-form-field">
                <label className="ui-label" htmlFor="system-prompt">System Prompt (optional)</label>
                <textarea
                  id="system-prompt"
                  className="textarea ui-textarea"
                  value={draft.systemPrompt}
                  onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                  placeholder="Override default system prompt…"
                />
              </div>

              <div className="welcome-form-actions">
                <button
                  type="button"
                  className="btn primary btn-lg welcome-submit-btn"
                  disabled={creating || !draft.objectUri.trim() || !draft.sessionId.trim()}
                  onClick={handleCreate}
                >
                  {creating ? "Creating…" : "Create session"}
                </button>
              </div>
            </fieldset>
          </div>

          {!loading && sessions.length > 0 && (
            <div className="panel ui-card welcome-card">
              <div className="welcome-card-head">
                <strong>Recent sessions</strong>
                <div className="muted small">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {sessions.slice(0, 8).map((s) => (
                  <button
                    key={s.sessionId}
                    className="list-button"
                    onClick={() => navigate(`/sessions/${encodeURIComponent(s.sessionId)}`)}
                  >
                    <div style={{ fontSize: 12, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.sessionId}
                    </div>
                    {s.threadCount > 0 && (
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                        {s.threadCount} thread{s.threadCount !== 1 ? "s" : ""}
                        {s.createdAt ? " · " + new Date(s.createdAt).toLocaleString() : ""}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
