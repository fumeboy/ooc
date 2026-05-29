/**
 * StonesListView — faithful port of ooc-2 stone list visual style.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Box, Database, RefreshCw } from "lucide-react";
import { listStones, type StoneListItem } from "../api";

export function StonesListView() {
  const navigate = useNavigate();
  const [stones, setStones] = useState<StoneListItem[]>([]);
  const [branch, setBranch] = useState("main");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function load(b = branch) {
    setLoading(true);
    setError(undefined);
    try {
      const res = await listStones(b);
      setStones(res.stones);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <Database size={15} className="muted" />
          <div>
            <div className="header-title">Stones</div>
            <div className="muted small">
              {stones.length} object{stones.length !== 1 ? "s" : ""} on branch <strong>{branch}</strong>
            </div>
          </div>
        </div>
        <input
          className="input"
          style={{ width: 80, padding: "4px 8px", fontSize: 11 }}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onBlur={() => load(branch)}
          placeholder="main"
        />
        <button className="btn btn-sm" onClick={() => load(branch)} disabled={loading}>
          <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
        </button>
      </div>

      <div className="main-body">
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        {loading && <div className="empty">Loading stones…</div>}

        {!loading && stones.length === 0 && !error && (
          <div className="empty">
            No stone objects found on branch <strong>{branch}</strong>.
          </div>
        )}

        <div className="object-grid">
          {stones.map((stone) => (
            <button
              key={stone.uri}
              className="object-card"
              onClick={() => navigate(`/stones/${encodeURIComponent(stone.name)}`)}
            >
              <div className="row" style={{ marginBottom: 6 }}>
                <Box size={13} className="muted" />
                <span className="pill" style={{ marginLeft: "auto", fontSize: 10 }}>stone</span>
              </div>
              <div className="object-card-name">{stone.title ?? stone.name}</div>
              {stone.title && stone.title !== stone.name && (
                <div className="object-card-uri" style={{ fontFamily: "inherit", color: "var(--muted-foreground)", fontSize: 12 }}>
                  {stone.name}
                </div>
              )}
              <div className="object-card-uri">{stone.uri}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
