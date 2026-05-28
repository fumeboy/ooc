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
      setObjects(res.objects);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [sessionId]);

  return (
    <>
      <div className="main-header">
        <button className="btn-icon" onClick={() => navigate("/sessions")}>
          <ArrowLeft size={15} />
        </button>
        <div style={{ flex: 1 }}>
          <div className="main-title" style={{ fontFamily: "monospace", fontSize: 13 }}>
            {sessionId}
          </div>
          <div className="main-subtitle">{objects.length} object{objects.length !== 1 ? "s" : ""} in session</div>
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <div className="main-body">
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        {loading && <div className="loading">Loading objects…</div>}

        {!loading && objects.length === 0 && (
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
