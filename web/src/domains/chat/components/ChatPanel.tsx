/**
 * ChatPanel — (Batch 2 placeholder)
 * Full TuiBlock-based chat timeline + composer implementation in Batch 2.
 */
import type { ThreadContext } from "../model";
import { ChatSendProvider } from "../../../shared/ui/ChatSendContext";

export function ChatPanel({
  sessionId,
  objectId,
  threadId,
  thread,
  onSend,
  showComposer = true,
}: {
  sessionId?: string;
  objectId?: string;
  threadId?: string;
  thread?: ThreadContext;
  onSend?: (text: string) => Promise<void>;
  showComposer?: boolean;
}) {
  const send = onSend ?? (async () => {});
  return (
    <ChatSendProvider onSend={send}>
      <div className="chat-panel" style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 12px" }}>
        <div className="chat-timeline" style={{ flex: 1, overflowY: "auto" }}>
          {thread?.messages?.length ? (
            <div className="muted small" style={{ padding: "8px 0" }}>
              Thread {objectId}/{threadId}: {thread.messages.length} messages — (Batch 2) full TuiBlock renderer coming.
            </div>
          ) : (
            <div className="muted small" style={{ padding: "8px 0" }}>
              {sessionId ? `Session ${sessionId}` : "No session"} — no messages yet.
            </div>
          )}
          {thread?.status && (
            <div className="muted small">Status: {thread.status}</div>
          )}
        </div>
        {showComposer && onSend && (
          <ChatComposerPlaceholder onSend={onSend} />
        )}
      </div>
    </ChatSendProvider>
  );
}

function ChatComposerPlaceholder({ onSend }: { onSend: (text: string) => Promise<void> }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
      <div className="muted small">(Batch 2) Chat composer coming — send messages to agents here.</div>
    </div>
  );
}
