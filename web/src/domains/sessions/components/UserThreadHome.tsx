/**
 * UserThreadHome —— 当 user thread（caller=user，objectId="user"，threadId="root"）
 * 打开时取代 ContextSnapshotViewer 的默认主视图，呈现 talk-first 体验：
 *
 *   +-----------------------------------------------+
 *   | Talk threads      | Issues (8 most recent)    |
 *   |  [open chat]      |  ● #N title (open)        |
 *   |  · transcript     |  ○ #M title (closed)      |
 *   |                   |  [View all issues →]      |
 *   +-----------------------------------------------+
 *
 * "Advanced view" 按钮切换回原 ContextSnapshotViewer（thread context tree），
 * 状态用本地 useState（不进 URL；刷新回归默认 talk-first 视图）。
 *
 * 数据来源：
 * - thread.contextWindows 中所有 type=talk window → talk thread cards
 * - useIssues(sessionId) → 侧栏 issue 列表
 *
 * 跳转：
 * - "Open chat" 按钮 → navigate 到 `/flows/<sid>?objectId=<peer>&threadId=<peerThread>`，
 *   但 user.root 上的 talk_window 只持有 `target` (peer objectId) 与 `conversationId`，
 *   不直接持有对端 threadId。退而求其次：navigate 到 `/flows/<sid>?objectId=<peer>`
 *   → shell 的 effect 用默认 threadId=root 派生，足够进入对端 chat 视图。
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, MessageSquare, Network, CircleDot, FileWarning } from "lucide-react";
import type { ThreadContext, ContextWindow, ThreadMessage } from "../../chat";
import { ContextSnapshotViewer } from "../../files/components/ContextSnapshotViewer";
import type { ContextSnapshot } from "../../files/context-snapshot";
import { useDisplayName } from "../../objects";
import { useIssues, createIssue } from "../../issues";
import { timeAgo } from "../../issues/components/IssueDetailView";
import { toPath } from "../../../app/routing";

interface UserThreadHomeProps {
  sessionId: string;
  thread?: ThreadContext;
  onUserReply?: (text: string) => Promise<void>;
}

export function UserThreadHome({ sessionId, thread, onUserReply }: UserThreadHomeProps) {
  const [advancedView, setAdvancedView] = useState(false);

  if (advancedView && thread) {
    const snapshot: ContextSnapshot = {
      id: thread.id,
      status: thread.status,
      contextWindows: (thread.contextWindows ?? []) as ContextSnapshot["contextWindows"],
      inbox: thread.inbox,
      outbox: thread.outbox,
      events: thread.events,
    };
    return (
      <div className="user-thread-home">
        <div className="user-thread-home-header">
          <div>
            <h2 className="user-thread-home-title">Context Tree (advanced)</h2>
            <div className="muted small">Raw view: thread.json 全树结构</div>
          </div>
          <button
            type="button"
            className="btn small"
            onClick={() => setAdvancedView(false)}
            title="Switch back to talk + issues home"
          >
            ← Back to talk view
          </button>
        </div>
        <ContextSnapshotViewer
          snapshot={snapshot}
          selfObjectId="user"
          onUserReply={onUserReply}
        />
      </div>
    );
  }

  const talkWindows = (thread?.contextWindows ?? []).filter(
    (w): w is Extract<ContextWindow, { type: "talk" }> => w.type === "talk",
  );

  return (
    <div className="user-thread-home">
      <div className="user-thread-home-header">
        <div>
          <h2 className="user-thread-home-title">User session</h2>
          <div className="muted small">
            <code title={sessionId}>{sessionId}</code>
            {thread?.status && (
              <>
                {" · "}
                <span className="pill">{thread.status}</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={() => setAdvancedView(true)}
          title="Switch to raw context tree view"
        >
          <Network size={12} style={{ marginRight: 4 }} />
          Advanced view
        </button>
      </div>

      <div className="user-thread-home-grid">
        <section className="user-thread-home-talks">
          <div className="user-thread-home-section-head">
            <MessageSquare size={13} />
            <span>Conversations</span>
            <span className="muted small">{talkWindows.length} talk window{talkWindows.length === 1 ? "" : "s"}</span>
          </div>
          {talkWindows.length === 0 ? (
            <div className="user-thread-home-empty">
              No conversations yet. Use the welcome page to seed a new session.
            </div>
          ) : (
            <ul className="user-thread-home-talk-list">
              {talkWindows.map((w) => (
                <TalkWindowCard
                  key={w.id}
                  sessionId={sessionId}
                  window={w}
                  inbox={thread?.inbox ?? []}
                  outbox={thread?.outbox ?? []}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="user-thread-home-issues">
          <IssuesPanel sessionId={sessionId} />
        </aside>
      </div>

      <NewWindowComposer sessionId={sessionId} onUserReply={onUserReply} />
    </div>
  );
}

/**
 * NewWindowComposer —— user thread home 底部输入区域，发起新 talk / 新 issue。
 *
 * - "Chat" tab: 输入消息文字 → 调 onUserReply（user.root 的 talk_window 派单）
 *   不切 target object —— 默认走当前 user.root 既有的 supervisor talk window
 *   （session 默认接入的 conversational entry）。
 *   后续要扩展到 "切换 target" 时再加 dropdown，避免一开始就过设计。
 * - "Issue" tab: title + body → createIssue API（当前 session 下创建 Issue，
 *   createdByObjectId 默认 supervisor）
 */
function NewWindowComposer({
  sessionId,
  onUserReply,
}: {
  sessionId: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"chat" | "issue">("chat");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>(undefined);
  // chat tab state
  const [chatText, setChatText] = useState("");
  // issue tab state
  const [issueTitle, setIssueTitle] = useState("");
  const [issueBody, setIssueBody] = useState("");

  async function submitChat() {
    const text = chatText.trim();
    if (!text || busy) return;
    if (!onUserReply) {
      setErr("当前视图未提供消息发送通路（onUserReply 缺失）。");
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      await onUserReply(text);
      setChatText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitIssue() {
    const title = issueTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      await createIssue(sessionId, {
        title,
        description: issueBody.trim() || undefined,
      });
      setIssueTitle("");
      setIssueBody("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="user-thread-composer" aria-label="New window composer">
      <div className="user-thread-composer-tabs">
        <button
          type="button"
          className={`user-thread-composer-tab ${tab === "chat" ? "is-active" : ""}`}
          onClick={() => setTab("chat")}
        >
          <MessageSquare size={12} style={{ marginRight: 5 }} />
          New message
        </button>
        <button
          type="button"
          className={`user-thread-composer-tab ${tab === "issue" ? "is-active" : ""}`}
          onClick={() => setTab("issue")}
        >
          <CircleDot size={12} style={{ marginRight: 5 }} />
          New issue
        </button>
      </div>

      {tab === "chat" ? (
        <div className="user-thread-composer-body">
          <textarea
            className="user-thread-composer-input"
            placeholder="Send a message to supervisor…"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submitChat();
              }
            }}
            disabled={busy}
            rows={3}
          />
          <div className="user-thread-composer-actions">
            <span className="muted small">⌘/Ctrl + Enter to send</span>
            <button
              type="button"
              className="btn small"
              onClick={() => void submitChat()}
              disabled={busy || !chatText.trim() || !onUserReply}
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      ) : (
        <div className="user-thread-composer-body">
          <input
            type="text"
            className="user-thread-composer-input user-thread-composer-input-title"
            placeholder="Issue title"
            value={issueTitle}
            onChange={(e) => setIssueTitle(e.target.value)}
            disabled={busy}
            maxLength={200}
          />
          <textarea
            className="user-thread-composer-input"
            placeholder="Describe the issue (optional, markdown supported)…"
            value={issueBody}
            onChange={(e) => setIssueBody(e.target.value)}
            disabled={busy}
            rows={3}
            maxLength={8192}
          />
          <div className="user-thread-composer-actions">
            <span className="muted small">created by supervisor</span>
            <button
              type="button"
              className="btn small"
              onClick={() => void submitIssue()}
              disabled={busy || !issueTitle.trim()}
            >
              {busy ? "Creating…" : "Create issue"}
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="user-thread-composer-error" role="alert">
          <FileWarning size={11} style={{ marginRight: 5, verticalAlign: "middle" }} />
          {err}
        </div>
      )}
    </section>
  );
}

function TalkWindowCard({
  sessionId,
  window: w,
  inbox,
  outbox,
}: {
  sessionId: string;
  window: Extract<ContextWindow, { type: "talk" }>;
  inbox: ThreadMessage[];
  outbox: ThreadMessage[];
}) {
  const navigate = useNavigate();
  const { displayName } = useDisplayName(w.target);
  // 取本 talk_window 关联的最后 3 条消息（outbox.windowId === w.id, inbox.replyToWindowId === w.id）
  const related: Array<{ msg: ThreadMessage; channel: "inbox" | "outbox" }> = [];
  for (const m of outbox) if (m.windowId === w.id) related.push({ msg: m, channel: "outbox" });
  for (const m of inbox) if (m.replyToWindowId === w.id) related.push({ msg: m, channel: "inbox" });
  related.sort((a, b) => (a.msg.createdAt ?? 0) - (b.msg.createdAt ?? 0));
  const recent = related.slice(-3);

  return (
    <li className="user-thread-talk-card">
      <div className="user-thread-talk-head">
        <div className="user-thread-talk-peer">
          <span className="user-thread-talk-peer-dot" aria-hidden>●</span>
          <span className="user-thread-talk-peer-name" title={w.target}>
            {displayName}
          </span>
          <span className={`user-thread-talk-status user-thread-talk-status-${w.status}`}>
            {w.status}
          </span>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            // user.root.talk_window 不存对端 threadId; 让 shell 默认派生 (root)
            // ChatPanel 拿到对端 thread 后会展示完整 timeline.
            navigate(
              toPath({
                kind: "session",
                sessionId,
                objectId: w.target,
                threadId: "root",
              }),
            );
          }}
          title={`Open chat with ${displayName}`}
        >
          Open chat
          <ArrowRight size={11} style={{ marginLeft: 4 }} />
        </button>
      </div>
      <div className="user-thread-talk-title">{w.title}</div>
      <div className="user-thread-talk-meta muted small">
        conversation <code>{w.conversationId}</code>
        {related.length > 0 && (
          <>
            {" · "}
            {related.length} message{related.length === 1 ? "" : "s"}
          </>
        )}
      </div>
      {recent.length > 0 && (
        <ul className="user-thread-talk-transcript">
          {recent.map((entry, i) => {
            const m = entry.msg;
            const arrow = entry.channel === "outbox" ? "→" : "←";
            const senderLabel =
              entry.channel === "outbox"
                ? "you"
                : m.fromObjectId ?? m.fromThreadId ?? "peer";
            const text = m.content ?? "";
            return (
              <li key={m.id ?? i} className={`user-thread-talk-msg user-thread-talk-msg-${entry.channel}`}>
                <span className="user-thread-talk-msg-arrow" aria-hidden>{arrow}</span>
                <span className="user-thread-talk-msg-sender">{senderLabel}</span>
                <span className="user-thread-talk-msg-body" title={text}>
                  {text.length > 200 ? text.slice(0, 200) + "…" : text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function IssuesPanel({ sessionId }: { sessionId: string }) {
  const { issues, loading } = useIssues(sessionId);
  const sorted = [...issues].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  const top = sorted.slice(0, 8);
  return (
    <>
      <div className="user-thread-home-section-head">
        <span>Issues</span>
        <span className="muted small">
          {loading && issues.length === 0
            ? "…"
            : `${issues.length} total`}
        </span>
      </div>
      {top.length === 0 ? (
        <div className="user-thread-home-empty">
          {loading ? "Loading…" : "No issues yet."}
        </div>
      ) : (
        <ul className="user-thread-issues-list">
          {top.map((iss) => (
            <li key={iss.id}>
              <Link
                to={toPath({
                  kind: "issueDetail",
                  sessionId,
                  issueId: iss.id,
                })}
                className="user-thread-issue-row"
                title={iss.title}
              >
                <span
                  className={`user-thread-issue-status user-thread-issue-status-${iss.status}`}
                  aria-label={iss.status}
                  aria-hidden
                >
                  ●
                </span>
                <span className="user-thread-issue-id">#{iss.id}</span>
                <span className="user-thread-issue-title">{iss.title}</span>
                <span className="user-thread-issue-meta">
                  {timeAgo(iss.lastUpdatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="user-thread-issues-foot">
        <Link to={`/flows/${encodeURIComponent(sessionId)}/issues`} className="btn small">
          View all issues
          <ArrowRight size={11} style={{ marginLeft: 4 }} />
        </Link>
      </div>
    </>
  );
}
