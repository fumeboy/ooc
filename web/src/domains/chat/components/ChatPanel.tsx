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
  /** 是否显示底部 composer；缺省 true（用于"thread creator 不是 user"时直接收起）。 */
  showComposer = true,
}: {
  sessionId?: string;
  objectId?: string;
  thread?: ThreadContext;
  paused?: boolean;
  pauseBusy?: boolean;
  onSend: (text: string) => Promise<void>;
  onTogglePause?: () => Promise<void>;
  showComposer?: boolean;
}) {
  return (
    <div className="right-body chat-body">
      {sessionId && objectId ? (
        <>
          <div className="chat-timeline">
            <ThreadTimeline thread={thread} />
          </div>
          {showComposer && (
            <div className="chat-composer-shell">
              <ChatComposer onSend={onSend} paused={paused} pauseBusy={pauseBusy} onTogglePause={onTogglePause} />
            </div>
          )}
        </>
      ) : (
        <div className="chat-timeline">
          <div className="empty">Select or create a session to chat.</div>
        </div>
      )}
    </div>
  );
}
