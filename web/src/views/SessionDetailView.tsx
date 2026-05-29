/**
 * SessionDetailView — lists objects in a session with ooc-2 visual style.
 * Routes to SessionObjectView when an object is clicked.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Box, RefreshCw } from "lucide-react";
import { getFlowObjects, type FlowObject } from "../api";

export function SessionDetailView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [objects, setObjects] = useState<FlowObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function load() {
    if (!sessionId) return;
    setLoading(true);
    setError(undefined);
    try {
      const res = await getFlowObjects(sessionId);
      setObjects(Array.isArray(res?.objects) ? res.objects : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [sessionId]);

  return (
    <>
      <div className="header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="btn"
            style={{ padding: "5px 8px" }}
            onClick={() => navigate("/sessions")}
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <div className="header-title" style={{ fontFamily: "monospace", fontSize: 13 }}>
              {sessionId}
            </div>
            <div className="muted small">{objects.length} object{objects.length !== 1 ? "s" : ""} in session</div>
          </div>
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
          Refresh
        </button>
      </div>

      <div className="main-body">
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        {loading && <div className="empty">Loading objects…</div>}

        {!loading && objects.length === 0 && !error && (
          <div className="empty">No objects in this session yet.</div>
        )}

        <div className="object-grid">
          {objects.map((obj) => (
            <button
              key={obj.uri}
              className="object-card"
              onClick={() => navigate(`/sessions/${sessionId}/objects/${encodeURIComponent(obj.name)}`)}
            >
              <div className="row" style={{ marginBottom: 6 }}>
                <Box size={14} className="muted" />
                <span className="pill" style={{ marginLeft: "auto", fontSize: 10 }}>{obj.kind}</span>
              </div>
              <div className="object-card-name">{obj.name}</div>
              <div className="object-card-uri">{obj.uri}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
