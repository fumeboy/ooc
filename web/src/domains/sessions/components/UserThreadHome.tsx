/**
 * UserThreadHome —— user 的 root thread 主视图（user.root）。
 *
 * 2026-05-26 Round 7 A3 重构（移除 issue 看板）：
 *
 *   +-----------+--------------------------------------+
 *   | ── Chats+ |                                      |
 *   |  · sup    |   <SelectionDetail>                  |
 *   |  · alice  |     - chat: ChatPanel（peer thread   |
 *   | --------- |              polling 独立轨）         |
 *   |           |     - 空: empty state + 引导文案     |
 *   +-----------+--------------------------------------+
 *
 * 选择 single-column 左栏 + 右栏详情。原远端双栏（Chats + Issues）的 IssueListSection /
 * NewIssueModal / IssueDetailView 选中路径已随 issue 看板移除一并删除。
 *
 * 空态保留 H-3（Round 5 体验官报告）"Seed first conversation via welcome" 跳转按钮：
 * - 当 session 中没有任何 talk_window 时显式提供一个跳到 /welcome?session=<sid> 的入口，
 *   让 welcome 表单预填该 sessionId 继续 seed。
 * - 远端 commit 7c7ae4d2 重构双栏时把它丢了，本轮顺便加回来。
 *
 * 选中状态写进 URL `?selected=chat:<wid>`，刷新保留。
 *
 * 数据来源：
 * - thread.contextWindows 中所有 type=talk window → 左栏 chat list
 * - 选中 chat 时：usePollingThread(sessionId, peer.target, peer.targetThreadId)
 *   独立 4s 轮询 peer thread；右栏 ChatPanel 渲染 timeline + composer
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Plus, MessageSquare } from "lucide-react";
import type { ThreadContext, ContextWindow } from "../../chat";
import { useDisplayName } from "../../objects";
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
        <EmptyChatList sessionId={sessionId} />
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

/**
 * H-3 (Round 5 体验报告) 恢复版：当 session 里完全没有 talk_window 时，
 * 显式渲染一个"去 welcome 补 seed"跳转按钮，不只留一行干瘪的文案。
 *
 * 跳到 /welcome?session=<sid>，Welcome 读 ?session= query 后让 SessionCreator 预填 sessionId。
 */
function EmptyChatList({ sessionId }: { sessionId: string }) {
  return (
    <div className="user-home-empty user-home-empty-chats">
      <div style={{ marginBottom: 8 }}>
        No conversations yet. This session was created without a first message — seed one via
        welcome to start talking.
      </div>
      <Link
        to={`/welcome?session=${encodeURIComponent(sessionId)}`}
        className="btn small"
        data-testid="seed-via-welcome"
      >
        <MessageSquare size={11} style={{ marginRight: 4 }} />
        Seed first conversation via welcome
        <ArrowRight size={11} style={{ marginLeft: 4 }} />
      </Link>
    </div>
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

function SelectionDetail({
  sessionId,
  selected,
  talkWindows,
}: {
  sessionId: string;
  selected: { kind: "chat"; windowId: string } | undefined;
  talkWindows: TalkWindow[];
}) {
  if (!selected) {
    return (
      <div className="user-home-empty-panel">
        <p>Pick a chat from the left.</p>
        <p className="muted small">点击 + 号可以与新 object 开聊。</p>
      </div>
    );
  }
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
