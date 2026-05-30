/**
 * ThreadDetailTabs — ooc-3 adaptation.
 *
 * Shows a "Context Snapshot" tab (ChatPanel with full thread timeline).
 * Loop Timeline tab is deferred to Batch 5 (requires debug-loop infrastructure).
 *
 * The main content is the thread messages rendered via formatOoc3Thread → TuiBlock.
 */
import { useState } from "react";
import type { ThreadContext } from "../../chat/model";
import { ThreadTimeline } from "../../chat/components/ThreadTimeline";
import { ChatComposer } from "../../chat/components/ChatComposer";
import { ChatSendProvider } from "../../../shared/ui/ChatSendContext";
import { useDisplayName } from "../../objects";

type Tab = "thread" | "meta";

export function ThreadDetailTabs({
  sessionId,
  objectId,
  threadId,
  thread,
  selfObjectId,
  onUserReply,
}: {
  sessionId: string;
  objectId: string;
  threadId: string;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("thread");
  const { displayName: peerDisplayName } = useDisplayName(objectId);
  const send = onUserReply ?? (async () => {});
  const showComposer = Boolean(onUserReply);
  const threadPaused = thread?.status === "paused";

  return (
    <div className="thread-detail-tabs" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="tab-bar panel" style={{ display: "flex", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          className={`tab-btn${tab === "thread" ? " is-active" : ""}`}
          onClick={() => setTab("thread")}
        >
          Thread
        </button>
        <button
          type="button"
          className={`tab-btn${tab === "meta" ? " is-active" : ""}`}
          onClick={() => setTab("meta")}
        >
          Meta
        </button>
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "thread" && (
          <ChatSendProvider onSend={send}>
            <div className="right-body chat-body gap-2" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div className="chat-timeline panel" style={{ flex: 1, overflowY: "auto" }}>
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
                    onSend={send}
                    paused={threadPaused}
                    peerObjectId={objectId}
                    peerDisplayName={peerDisplayName}
                  />
                </div>
              )}
            </div>
          </ChatSendProvider>
        )}
        {tab === "meta" && (
          <div className="section compact" style={{ padding: 16, overflowY: "auto" }}>
            <ThreadMetaView
              sessionId={sessionId}
              objectId={objectId}
              threadId={threadId}
              thread={thread}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadMetaView({ sessionId, objectId, threadId, thread }: {
  sessionId: string;
  objectId: string;
  threadId: string;
  thread?: ThreadContext;
}) {
  const raw = thread?._ooc3Thread;
  return (
    <div className="stack gap-2">
      <div>
        <div className="muted small">session</div>
        <code>{sessionId}</code>
      </div>
      <div>
        <div className="muted small">object</div>
        <code>{objectId}</code>
      </div>
      <div>
        <div className="muted small">thread</div>
        <code>{threadId}</code>
      </div>
      {raw && (
        <>
          <div>
            <div className="muted small">status</div>
            <span className={`status-pill status-${raw.status}`}>{raw.status}</span>
          </div>
          <div>
            <div className="muted small">ticks</div>
            <code>{raw.ticks} / {raw.maxTicks}</code>
          </div>
          <div>
            <div className="muted small">messages</div>
            <code>{raw.messages.length}</code>
          </div>
          <div>
            <div className="muted small">objectUri</div>
            <code style={{ wordBreak: "break-all" }}>{raw.objectUri}</code>
          </div>
          {raw.lastError && (
            <div>
              <div className="muted small">lastError</div>
              <pre className="tui-pre" style={{ color: "var(--error, red)" }}>{raw.lastError}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
