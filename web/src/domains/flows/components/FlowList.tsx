import { flowTitle, type FlowSession } from "..";

export function FlowList({ flows, activeSessionId, onSelect }: { flows: FlowSession[]; activeSessionId?: string; onSelect: (flow: FlowSession) => void }) {
  return <div className="stack">{flows.map((flow) => <button key={flow.sessionId} className={`list-button ${flow.sessionId === activeSessionId ? "active" : ""}`} onClick={() => onSelect(flow)}><strong>{flowTitle(flow)}</strong><div className="muted small">{flow.sessionId}</div></button>)}</div>;
}

