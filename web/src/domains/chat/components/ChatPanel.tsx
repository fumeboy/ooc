import type { ThreadContext } from "..";
import { useDisplayName } from "../../objects";
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
  const { displayName: peerDisplayName } = useDisplayName(objectId);
  return (<>
    <div className="right-body chat-body gap-1">
      {sessionId && objectId ? (
        <>
          <div className="chat-timeline panel">
            <ThreadTimeline thread={thread} />
          </div>
          {showComposer && (
            <div className="chat-composer-shell">
              <ChatComposer onSend={onSend} paused={paused} pauseBusy={pauseBusy} onTogglePause={onTogglePause} peerObjectId={objectId} peerDisplayName={peerDisplayName} />
            </div>
          )}
        </>
      ) : (
        <div className="chat-timeline panel">
          <div className="empty">Select or create a session to chat.</div>
        </div>
      )}
    </div>
  </>);
}
