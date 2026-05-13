import type { ThreadContext } from "../../domains/chat";
import { ChatPanel } from "../../domains/chat/components/ChatPanel";

export function RightPanel(props: { sessionId?: string; objectId?: string; thread?: ThreadContext; onSend: (text: string) => Promise<void> }) {
  return <aside className="panel right-panel"><div className="header"><div><div className="header-title">Chat</div><div className="muted small">root thread</div></div></div><ChatPanel {...props} /></aside>;
}

