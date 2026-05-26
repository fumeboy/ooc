/**
 * UserThreadHome —— user 的 root thread 主视图（user.root）。
 *
 * 2026-05-26 双栏重构 + 简化 header（参照 Thread Context 页面风格）：
 *
 *   +-----------+--------------------------------------+
 *   | ── Chats+ |                                      |
 *   |  · sup    |   <SelectionDetail>                  |
 *   |  · alice  |     - chat: ChatPanel（peer thread   |
 *   | --------- |              polling 独立轨）         |
 *   | ── Issues+|     - issue: IssueDetailView        |
 *   |  ● #3 …   |                  (hideBackLink)      |
 *   |  ○ #2 …   |                                      |
 *   +-----------+--------------------------------------+
 *
 * 左栏 Chats / Issues 合并在同一个 panel 容器内，上下 50/50 分；中间细分隔线，
 * 不再两块独立卡片。顶部 "User session" header 与 Advanced view 按钮已移除——
 * 顶部 breadcrumb-bar 已经显示 sessionId / running / user · root，重复无意义。
 *
 * 选中状态写进 URL `?selected=chat:<wid>` 或 `?selected=issue:<id>`，刷新保留。
 *
 * 数据来源：
 * - thread.contextWindows 中所有 type=talk window → 左栏 chat list
 * - useIssues(sessionId) → 左栏 issue list
 * - 选中 chat 时：usePollingThread(sessionId, peer.target, peer.targetThreadId)
 *   独立 4s 轮询 peer thread；右栏 ChatPanel 渲染 timeline + composer
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { Plus, MessageSquare, CircleDot } from "lucide-react";
import type { ThreadContext, ContextWindow } from "../../chat";
import { useDisplayName } from "../../objects";
import { useIssues, createIssue } from "../../issues";
import { IssueDetailView } from "../../issues/components/IssueDetailView";
import { timeAgo } from "../../issues/components/IssueDetailView";
import { ChatPanel } from "../../chat/components/ChatPanel";
import { continueThread, usePollingThread } from "../../chat";
import { addUserTalkWindow } from "../query";
import { toPath, useRouteState } from "../../../app/routing";
import { messageFromError } from "../../../transport/errors";

interface UserThreadHomeProps {
  sessionId: string;
  thread?: ThreadContext;
  /** 旧的 user.root 默认 talk_window 派单回调；本视图改走 continueThread + 显式 windowId 直调，不再依赖此 prop。 */
  onUserReply?: (text: string) => Promise<void>;
}

type TalkWindow = Extract<ContextWindow, { type: "talk" }>;

export function UserThreadHome({ sessionId, thread }: UserThreadHomeProps) {
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [newIssueModalOpen, setNewIssueModalOpen] = useState(false);
  const route = useRouteState();
  const selected = route.kind === "session" ? route.selected : undefined;

  const talkWindows = (thread?.contextWindows ?? []).filter(
    (w): w is TalkWindow => w.type === "talk",
  );

  return (
    <div className="user-thread-home">
      <div className="user-home-split">
        <aside className="user-home-left">
          <ChatListSection
            sessionId={sessionId}
            talkWindows={talkWindows}
            selectedWindowId={selected?.kind === "chat" ? selected.windowId : undefined}
            onAdd={() => setNewChatModalOpen(true)}
          />
          <div className="user-home-divider" aria-hidden />
          <IssueListSection
            sessionId={sessionId}
            selectedIssueId={selected?.kind === "issue" ? selected.issueId : undefined}
            onAdd={() => setNewIssueModalOpen(true)}
          />
        </aside>
        <section className="user-home-right">
          <SelectionDetail
            sessionId={sessionId}
            selected={selected}
            talkWindows={talkWindows}
          />
        </section>
      </div>

      {newChatModalOpen && (
        <NewChatModal
          sessionId={sessionId}
          onClose={() => setNewChatModalOpen(false)}
        />
      )}
      {newIssueModalOpen && (
        <NewIssueModal
          sessionId={sessionId}
          onClose={() => setNewIssueModalOpen(false)}
        />
      )}
    </div>
  );
}

function ChatListSection({
  sessionId,
  talkWindows,
  selectedWindowId,
  onAdd,
}: {
  sessionId: string;
  talkWindows: TalkWindow[];
  selectedWindowId?: string;
  onAdd: () => void;
}) {
  const navigate = useNavigate();
  return (
    <section className="user-home-group">
      <div className="user-home-group-head">
        <MessageSquare size={12} />
        <span>Chats</span>
        <span className="muted small group-count">{talkWindows.length}</span>
        <button
          type="button"
          className="btn icon-btn"
          onClick={onAdd}
          title="Start a new chat with another object"
          aria-label="New chat"
        >
          <Plus size={12} />
        </button>
      </div>
      {talkWindows.length === 0 ? (
        <div className="user-home-empty">No conversations yet.</div>
      ) : (
        <ul className="user-home-list">
          {talkWindows.map((w) => (
            <ChatListItem
              key={w.id}
              sessionId={sessionId}
              window={w}
              isActive={w.id === selectedWindowId}
              onSelect={() =>
                navigate(
                  toPath({
                    kind: "session",
                    sessionId,
                    selected: { kind: "chat", windowId: w.id },
                  }),
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChatListItem({
  sessionId: _sid,
  window: w,
  isActive,
  onSelect,
}: {
  sessionId: string;
  window: TalkWindow;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { displayName } = useDisplayName(w.target);
  return (
    <li>
      <button
        type="button"
        className={`user-home-list-row ${isActive ? "is-active" : ""}`}
        onClick={onSelect}
        title={`Open chat with ${displayName}`}
      >
        <span className="user-home-list-row-dot" aria-hidden>●</span>
        <span className="user-home-list-row-label">{displayName}</span>
        <span className={`user-home-list-row-status user-home-list-row-status-${w.status}`}>
          {w.status}
        </span>
      </button>
    </li>
  );
}

function IssueListSection({
  sessionId,
  selectedIssueId,
  onAdd,
}: {
  sessionId: string;
  selectedIssueId?: number;
  onAdd: () => void;
}) {
  const navigate = useNavigate();
  const { issues, loading } = useIssues(sessionId);
  const sorted = [...issues].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  const top = sorted.slice(0, 12);
  return (
    <section className="user-home-group">
      <div className="user-home-group-head">
        <CircleDot size={12} />
        <span>Issues</span>
        <span className="muted small group-count">
          {loading && issues.length === 0 ? "…" : `${issues.length}`}
        </span>
        <button
          type="button"
          className="btn icon-btn"
          onClick={onAdd}
          title="Open a new issue"
          aria-label="New issue"
        >
          <Plus size={12} />
        </button>
      </div>
      {top.length === 0 ? (
        <div className="user-home-empty">{loading ? "Loading…" : "No issues yet."}</div>
      ) : (
        <ul className="user-home-list">
          {top.map((iss) => (
            <li key={iss.id}>
              <button
                type="button"
                className={`user-home-list-row ${iss.id === selectedIssueId ? "is-active" : ""}`}
                onClick={() =>
                  navigate(
                    toPath({
                      kind: "session",
                      sessionId,
                      selected: { kind: "issue", issueId: iss.id },
                    }),
                  )
                }
                title={iss.title}
              >
                <span
                  className={`user-home-list-row-dot user-home-list-row-issue-${iss.status}`}
                  aria-label={iss.status}
                  aria-hidden
                >
                  ●
                </span>
                <span className="user-home-list-row-id">#{iss.id}</span>
                <span className="user-home-list-row-label">{iss.title}</span>
                <span className="user-home-list-row-meta">{timeAgo(iss.lastUpdatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SelectionDetail({
  sessionId,
  selected,
  talkWindows,
}: {
  sessionId: string;
  selected:
    | { kind: "chat"; windowId: string }
    | { kind: "issue"; issueId: number }
    | undefined;
  talkWindows: TalkWindow[];
}) {
  if (!selected) {
    return (
      <div className="user-home-empty-panel">
        <p>Pick a chat or issue from the left.</p>
        <p className="muted small">点击 + 号可以开新会话或开 issue。</p>
      </div>
    );
  }
  if (selected.kind === "chat") {
    const w = talkWindows.find((tw) => tw.id === selected.windowId);
    if (!w) {
      return (
        <div className="user-home-empty-panel">
          <p className="muted small">
            Chat <code>{selected.windowId}</code> not found on user.root —— 可能 talk_window 已被关闭。
          </p>
        </div>
      );
    }
    return <SelectedChat sessionId={sessionId} window={w} />;
  }
  return (
    <IssueDetailView sessionId={sessionId} issueId={selected.issueId} hideBackLink />
  );
}

function SelectedChat({ sessionId, window: w }: { sessionId: string; window: TalkWindow }) {
  // peer thread polling 独立轨：sessionId 不变，object/thread 跟着选中的 talk_window 走。
  // targetThreadId 在首次 deliverTalkMessage 时回填；尚未派送过的新 talk_window 会是 undefined,
  // 此时 hook 不启动，ChatPanel 显示 empty state。
  const { thread } = usePollingThread(sessionId, w.target, w.targetThreadId);
  const handleSend = async (text: string) => {
    // 显式带 targetWindowId 走 user.root.talkWindow.say —— 与 onUserReply 默认走第一个 talk
    // 不同，这里精确选中当前 talk_window，避免发到其它 chat。
    await continueThread(sessionId, text, w.id);
  };
  return (
    <ChatPanel
        sessionId={sessionId}
        objectId={w.target}
        thread={thread}
        onSend={handleSend}
      />
  );
}

/** + 号弹窗：在当前 session 加新 talk_window 指向某 object，并发首条消息。 */
function NewChatModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  async function submit() {
    const t = target.trim();
    const m = text.trim();
    if (!t || !m || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      const out = await addUserTalkWindow(sessionId, {
        targetObjectId: t,
        initialMessage: m,
      });
      onClose();
      navigate(
        toPath({
          kind: "session",
          sessionId,
          selected: { kind: "chat", windowId: out.talkWindowId },
        }),
      );
    } catch (e) {
      setErr(messageFromError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card compact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row space-between">
          <strong>New chat</strong>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small">
          在当前 session 的 user.root 上挂一个新 talk_window 指向 target object 并发首条消息。
          target 已存在则复用既有 talk_window。
        </p>
        <label className="field-label">
          Target object id
          <input
            className="input"
            placeholder="e.g. supervisor / pdf-extractor / alice"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="field-label">
          First message
          <textarea
            className="textarea"
            rows={4}
            placeholder="Say something to start the conversation…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            disabled={busy}
          />
        </label>
        {err && <div className="modal-error">{err}</div>}
        <div className="row space-between modal-actions">
          <span className="muted small">⌘/Ctrl + Enter to submit</span>
          <button
            type="button"
            className="btn primary"
            onClick={() => void submit()}
            disabled={busy || !target.trim() || !text.trim()}
          >
            {busy ? "Creating…" : "Start chat"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewIssueModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  async function submit() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await createIssue(sessionId, {
        title: t,
        description: body.trim() || undefined,
      });
      onClose();
      navigate(
        toPath({
          kind: "session",
          sessionId,
          selected: { kind: "issue", issueId: res.issue.id },
        }),
      );
    } catch (e) {
      setErr(messageFromError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card compact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row space-between">
          <strong>New issue</strong>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="field-label">
          Title
          <input
            className="input"
            placeholder="Short title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="field-label">
          Description (markdown, optional)
          <textarea
            className="textarea"
            rows={6}
            placeholder="Describe the issue…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={8192}
            disabled={busy}
          />
        </label>
        {err && <div className="modal-error">{err}</div>}
        <div className="row space-between modal-actions">
          <span className="muted small">created by supervisor</span>
          <button
            type="button"
            className="btn primary"
            onClick={() => void submit()}
            disabled={busy || !title.trim()}
          >
            {busy ? "Creating…" : "Create issue"}
          </button>
        </div>
      </div>
    </div>
  );
}
