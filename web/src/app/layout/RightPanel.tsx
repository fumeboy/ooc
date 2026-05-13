import type { ThreadContext } from "../../domains/chat";
import { ChatPanel } from "../../domains/chat/components/ChatPanel";

export function RightPanel(props: {
  sessionId?: string;
  objectId?: string;
  thread?: ThreadContext;
  paused?: boolean;
  pauseBusy?: boolean;
  onSend: (text: string) => Promise<void>;
  onTogglePause?: () => Promise<void>;
}) {
  const status = props.thread?.status;

  return <aside className="panel right-panel"><div className="assistant-head"><div className="avatar">S</div><div><div className="header-title">{props.objectId ?? "supervisor"}</div><div className="muted small">{props.sessionId ?? "root thread"}</div></div>{status && <span className={`status-pill status-pill-thread status-${status}`}>{status}</span>}</div><ChatPanel {...props} /></aside>;
}
