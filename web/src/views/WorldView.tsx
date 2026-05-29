/**
 * WorldView — shows world config info (ooc-3 /api/world endpoint).
 */
import { useEffect, useState } from "react";
import { Globe2, RefreshCw } from "lucide-react";
import { getWorld, type WorldConfig } from "../api";

export function WorldView() {
  const [config, setConfig] = useState<WorldConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const res = await getWorld();
      setConfig(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <>
      <div className="header">
        <Globe2 size={15} className="muted" />
        <div style={{ flex: 1 }}>
          <div className="header-title">World</div>
          <div className="muted small">OOC-3 world configuration</div>
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
        </button>
      </div>

      <div className="main-body">
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        {loading && <div className="empty">Loading…</div>}

        {config && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="section">
              <div className="section-title">World Info</div>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 12px", fontSize: 12 }}>
                <span className="muted">World root</span>
                <code style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{config.worldRoot}</code>
                <span className="muted">Branch</span>
                <code style={{ fontFamily: "monospace", fontSize: 11 }}>{config.branch}</code>
                <span className="muted">Status</span>
                <span className={`status-pill ${config.ok ? "online" : ""}`} style={{ width: "fit-content" }}>
                  {config.ok ? "online" : "error"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
