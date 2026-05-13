import type { ThreadContext } from "../../domains/chat";
import { ChatPanel } from "../../domains/chat/components/ChatPanel";

export function RightPanel(props: { sessionId?: string; objectId?: string; thread?: ThreadContext; onSend: (text: string) => Promise<void> }) {
  return <aside className="panel right-panel"><div className="assistant-head"><div className="avatar">S</div><div><div className="header-title">{props.objectId ?? "supervisor"}</div><div className="muted small">{props.sessionId ?? "root thread"}</div></div><span className="status-pill pause">pause</span></div><ChatPanel {...props} /></aside>;
}
