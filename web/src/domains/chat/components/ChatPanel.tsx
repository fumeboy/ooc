import type { ThreadContext } from "../model";
import { useDisplayName } from "../../objects";
import { ChatComposer } from "./ChatComposer";
import { ThreadTimeline } from "./ThreadTimeline";
import { ChatSendProvider } from "../../../shared/ui/ChatSendContext";

/**
 * ChatPanel — ooc-3 adaptation of ooc-2 ChatPanel.
 *
 * Uses ThreadTimeline → formatOoc3Thread → TuiBlock for rendering.
 * thread is ThreadContext with _ooc3Thread (the raw ThinkThread) for formatting.
 *
 * Composer visibility: ooc-3 has no creatorObjectId or contextWindows to check,
 * so we show the composer whenever showComposer=true (default). The parent
 * (RightPanel) controls this based on objectId === "user" or session context.
 */
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
  onSend: (text: string) => Promise<void>;
  showComposer?: boolean;
}) {
  const { displayName: peerDisplayName } = useDisplayName(objectId);
  // In ooc-3, thread paused = thread.status === "paused" (HITL/waiting)
  const threadPaused = thread?.status === "paused";
  return (
    <ChatSendProvider onSend={onSend}>
      <div className="right-body chat-body gap-2">
        {sessionId && objectId ? (
          <>
            <div className="chat-timeline panel">
              <ThreadTimeline
                thread={thread}
                sessionId={sessionId}
                objectId={objectId}
                threadId={threadId}
              />
            </div>
            {showComposer && (
              <div className="chat-composer-shell">
                <ChatComposer
                  onSend={onSend}
                  paused={threadPaused}
                  peerObjectId={objectId}
                  peerDisplayName={peerDisplayName}
                />
              </div>
            )}
          </>
        ) : (
          <div className="chat-timeline panel">
            <div className="empty">Select or create a session to chat.</div>
          </div>
        )}
      </div>
    </ChatSendProvider>
  );
}
