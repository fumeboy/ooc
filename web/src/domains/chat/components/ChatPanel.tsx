import type { ThreadContext } from "..";
import { ChatComposer } from "./ChatComposer";
import { ThreadTimeline } from "./ThreadTimeline";

export function ChatPanel({ sessionId, objectId, thread, onSend }: { sessionId?: string; objectId?: string; thread?: ThreadContext; onSend: (text: string) => Promise<void> }) {
  return (
    <div className="right-body chat-body">
      <div className="section compact">
        <div className="row space-between">
          <strong>Root Thread</strong>
          {thread?.status && <span className="pill">{thread.status}</span>}
        </div>
      </div>
      {sessionId && objectId ? (
        <>
          <div className="chat-timeline">
            <ThreadTimeline thread={thread} />
          </div>
          <div className="chat-composer-shell">
            <ChatComposer onSend={onSend} />
          </div>
        </>
      ) : (
        <div className="chat-timeline">
          <div className="empty">Select or create a session to chat.</div>
        </div>
      )}
    </div>
  );
}
