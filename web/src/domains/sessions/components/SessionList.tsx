import { flowTitle, type FlowSession } from "../../flows";

function getDateLabel(ts: number) {
  const now = new Date();
  const date = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (target.getTime() === today.getTime()) return "今天";
  if (target.getTime() === yesterday.getTime()) return "昨天";
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);
  if (diffDays < 7) return "最近 7 天";
  if (diffDays < 30) return "最近 30 天";
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function SessionList({ flows, activeSessionId, onSelect }: { flows: FlowSession[]; activeSessionId?: string; onSelect: (flow: FlowSession) => void }) {
  const dateGrouped = new Map<string, FlowSession[]>();
  const sortedFlows = [...flows].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const flow of sortedFlows) {
    const label = getDateLabel(flow.createdAt);
    if (!dateGrouped.has(label)) dateGrouped.set(label, []);
    dateGrouped.get(label)?.push(flow);
  }

  return (
    <div className="session-list-shell">
      <div className="session-list-header">
        <span className="session-list-title">Sessions</span>
      </div>
      <nav className="session-list-nav">
        {sortedFlows.length === 0 ? (
          <p className="session-list-empty">No sessions yet</p>
        ) : (
          Array.from(dateGrouped.entries()).map(([label, items]) => (
            <div key={label} className="session-list-group">
              <div className="session-list-group-label">{label}</div>
              <div className="session-list-group-items">
                {items.map((flow) => (
                  <button
                    key={flow.sessionId}
                    className={`list-button session-list-item ${flow.sessionId === activeSessionId ? "active" : ""}`}
                    onClick={() => onSelect(flow)}
                  >
                    <div className="session-list-item-row">
                      <span className="session-list-item-label">{flowTitle(flow)}</span>
                    </div>
                    <div className="session-list-item-meta">{flow.sessionId}</div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
