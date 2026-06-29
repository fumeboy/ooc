import type { ThreadContext } from "..";
import { useDisplayName } from "../../objects";
import { ChatComposer } from "./ChatComposer";
import { ThreadTimeline } from "./ThreadTimeline";
import { ChatSendProvider } from "../../../shared/ui/ChatSendContext";

/**
 * ChatPanel — chat 主体 (timeline + composer)。
 *
 * pause 按钮 + thread status pill 已外移至 RightPanel.right-footer (footer 与
 * composer 解耦, composer 隐藏时 footer 仍展示)。
 *
 * composer 的 disabled 跟随 thread paused（两类 pause 都 disable）；
 * `awaitingApproval` 由上层（RightPanel）按「是否有未决 permission_card」算好传入，
 * 仅用于切「审批中」vs「系统暂停」文案——避免系统级 pause 误显示审批字样。
 */
export function ChatPanel({
  sessionId,
  objectId,
  threadId,
  thread,
  onSend,
  /** thread 是否卡在 HITL 审批（有未决 permission_card）；由 RightPanel 统一计算下传。 */
  awaitingApproval = false,
  /** 是否显示底部 composer；缺省 true（用于"thread creator 不是 user"时直接收起）。 */
  showComposer = true,
}: {
  sessionId?: string;
  objectId?: string;
  threadId?: string;
  thread?: ThreadContext;
  onSend: (text: string) => Promise<void>;
  awaitingApproval?: boolean;
  showComposer?: boolean;
}) {
  const { displayName: peerDisplayName } = useDisplayName(objectId);
  const threadPaused = thread?.status === "paused";
  return (
    <ChatSendProvider onSend={onSend}>
      <div className="right-body chat-body gap-2">
        {sessionId && objectId ? (
          <>
            <div className="chat-timeline panel">
              <ThreadTimeline thread={thread} sessionId={sessionId} objectId={objectId} threadId={threadId} />
            </div>
            {showComposer && (
              <div className="chat-composer-shell">
                <ChatComposer onSend={onSend} paused={threadPaused} awaitingApproval={awaitingApproval} peerObjectId={objectId} peerDisplayName={peerDisplayName} />
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
