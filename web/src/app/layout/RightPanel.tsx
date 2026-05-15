import type { ThreadContext } from "../../domains/chat";
import { ChatPanel } from "../../domains/chat/components/ChatPanel";
import type { SessionThread } from "../state";

/**
 * RightPanel — chat 主面板。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：
 * 顶部加 thread switcher（select），列出当前 session 下所有 (objectId, threadId)；
 * 切换后由 onSelectThread 通知外层重新 loadThread。
 */
export function RightPanel(props: {
  sessionId?: string;
  objectId?: string;
  threadId?: string;
  thread?: ThreadContext;
  sessionThreads?: SessionThread[];
  paused?: boolean;
  pauseBusy?: boolean;
  onSend: (text: string) => Promise<void>;
  onTogglePause?: () => Promise<void>;
  onSelectThread?: (sel: SessionThread) => void;
}) {
  const status = props.thread?.status;
  const threads = props.sessionThreads ?? [];
  const activeKey = props.objectId && props.threadId ? `${props.objectId}/${props.threadId}` : "";

  return (
    <aside className="panel right-panel">
      <div className="assistant-head">
        <div className="avatar">S</div>
        <div className="assistant-head-meta">
          <div className="header-title">{props.objectId ?? "supervisor"}</div>
          <div className="muted small">{props.sessionId ?? "root thread"}</div>
        </div>
        {status && <span className={`status-pill status-pill-thread status-${status}`}>{status}</span>}
        {threads.length > 1 && props.onSelectThread && (
          <select
            className="thread-switcher"
            value={activeKey}
            onChange={(event) => {
              const [objectId, threadId] = event.target.value.split("/");
              if (objectId && threadId) props.onSelectThread!({ objectId, threadId });
            }}
            title="切换 thread"
          >
            {threads.map((t) => {
              const key = `${t.objectId}/${t.threadId}`;
              return (
                <option key={key} value={key}>
                  {t.objectId} · {t.threadId}
                </option>
              );
            })}
          </select>
        )}
      </div>
      <ChatPanel
        sessionId={props.sessionId}
        objectId={props.objectId}
        thread={props.thread}
        paused={props.paused}
        pauseBusy={props.pauseBusy}
        onSend={props.onSend}
        onTogglePause={props.onTogglePause}
      />
    </aside>
  );
}
