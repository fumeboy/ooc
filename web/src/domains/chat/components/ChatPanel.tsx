import type { ThreadContext } from "..";
import { ChatComposer } from "./ChatComposer";
import { ThreadTimeline } from "./ThreadTimeline";

export function ChatPanel({
  sessionId,
  objectId,
  thread,
  paused = false,
  pauseBusy = false,
  onSend,
  onTogglePause,
}: {
  sessionId?: string;
  objectId?: string;
  thread?: ThreadContext;
  paused?: boolean;
  pauseBusy?: boolean;
  onSend: (text: string) => Promise<void>;
  onTogglePause?: () => Promise<void>;
}) {
  return (
    <div className="right-body chat-body">
      {sessionId && objectId ? (
        <>
          <div className="chat-timeline">
            <ThreadTimeline thread={thread} />
          </div>
          <div className="chat-composer-shell">
            <ChatComposer onSend={onSend} paused={paused} pauseBusy={pauseBusy} onTogglePause={onTogglePause} />
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
