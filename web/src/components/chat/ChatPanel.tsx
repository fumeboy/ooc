/**
 * ChatPanel — chat body = timeline + optional composer.
 * Adapted from ooc-2; ooc-3 uses ThreadMessage[] directly.
 */
import type { ThreadMessage } from "../../api";
import { ChatComposer } from "./ChatComposer";
import { ThreadTimeline } from "./ThreadTimeline";

export function ChatPanel({
  objectId,
  messages,
  threadStatus,
  onSend,
  showComposer = true,
}: {
  objectId?: string;
  messages?: ThreadMessage[];
  threadStatus?: string;
  onSend: (text: string) => Promise<void>;
  showComposer?: boolean;
}) {
  const threadPaused = threadStatus === "paused";
  const isEmpty = !objectId;

  return (
    <div className="right-body chat-body gap-2">
      {isEmpty ? (
        <div className="chat-timeline panel">
          <div className="empty">Select or create a session to chat.</div>
        </div>
      ) : (
        <>
          <div className="chat-timeline panel">
            <ThreadTimeline messages={messages ?? []} />
          </div>
          {showComposer && (
            <div className="chat-composer-shell">
              <ChatComposer
                onSend={onSend}
                paused={threadPaused}
                peerObjectId={objectId}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
