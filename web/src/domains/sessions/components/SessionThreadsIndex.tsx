/**
 * SessionThreadsIndex — Round 8 D3 主组件。
 *
 * 形态（design §3 折中 A+B）:
 *
 *   +------------------------+--------------------+
 *   | Object Columns         |  SelectionDetail   |
 *   | [user] [sup] [fb]      |  ChatPanel (chat)  |
 *   |  ●root  ●root  root    |  or                |
 *   |   ├talk  ├do  ...      |  ThreadInspectDetail(thread)
 *   |  ...                   |                    |
 *   | <RelationOverlay svg>  |                    |
 *   +------------------------+--------------------+
 *
 * 数据 fetch:
 *   - `runtimeListThreads(sessionId)` → ListThreadsResponse
 *   - 4s polling (与既有 thread polling 同节拍)
 *   - 后端返回 minimal `{objectId,threadId}` shape 时优雅退化:
 *     仅渲染 thread 列表 + 无 status/关系
 *
 * 路由:
 *   - 复用 ?selected=chat:<wid>   —— ChatPanel
 *   - 新增 ?selected=thread:<obj>:<tid> —— ThreadInspectDetail
 *   - 无 selected → empty hint
 *
 * H-3 保留: empty session (无任何 talk + 无任何 threads) 时仍提供
 *   "去 welcome 补 seed" 跳转按钮。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, MessageSquare, Plus } from "lucide-react";
import type { ContextWindow, ThreadContext } from "../../chat";
import { continueThread, fetchSessionThreadsFull, usePollingThread } from "../../chat";
import { ChatPanel } from "../../chat/components/ChatPanel";
import { addUserTalkWindow } from "../query";
import { toPath, useRouteState } from "../../../app/routing";
import { useDisplayNames } from "../../objects";
import { messageFromError } from "../../../transport/errors";
import type { ListThreadsItem } from "../types";
import { ObjectColumn } from "./ObjectColumn";
import { ThreadInspectDetail } from "./ThreadInspectDetail";
import { RelationOverlay } from "./RelationOverlay";
import { groupByObject } from "./session-threads-index.helpers";

const POLL_INTERVAL_MS = 4000;

interface SessionThreadsIndexProps {
  sessionId: string;
  /** 主 user.root thread (来自 shell 的 polling) — 用于派 ChatPanel 路径 */
  thread?: ThreadContext;
  /** 当前 self objectId (传给 ThreadInspectDetail 内嵌 ThreadDetailTabs) */
  selfObjectId?: string;
}

type TalkWindow = Extract<ContextWindow, { type: "talk" }>;

export function SessionThreadsIndex({
  sessionId,
  thread,
  selfObjectId,
}: SessionThreadsIndexProps) {
  const [items, setItems] = useState<ListThreadsItem[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [degraded, setDegraded] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const route = useRouteState();
  const selected = route.kind === "session" ? route.selected : undefined;
  const navigate = useNavigate();

  // 4s polling listThreads
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const resp = await fetchSessionThreadsFull(sessionId);
        if (cancelled) return;
        const its = Array.isArray(resp?.items) ? resp.items : [];
        setItems(its);
        setLoadError(undefined);
        // 退化判定: 所有 items 都没有 status —— D2 未跑完时 backend 返 minimal shape
        setDegraded(its.length > 0 && its.every((i) => i.status === undefined));
      } catch (e) {
        if (cancelled) return;
        setLoadError(messageFromError(e));
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  // 把 items 按 objectId 分组并稳定排序（user 在最左, 然后按 thread 数降序）
  const groupedColumns = useMemo(() => groupByObject(items), [items]);
  const objectIds = useMemo(() => groupedColumns.map((g) => g.objectId), [groupedColumns]);
  // 触发 displayName 批量加载 —— 派生列宽 / breadcrumb 用
  useDisplayNames(objectIds);

  // 派 ChatPanel 路径需要的 talk_windows（user.root 的 talk windows，来自 props.thread）
  const talkWindows = useMemo(
    () =>
      (thread?.contextWindows ?? []).filter((w): w is TalkWindow => w.type === "talk"),
    [thread],
  );

  const onSelectThread = (objectId: string, threadId: string) => {
    navigate(
      toPath({
        kind: "session",
        sessionId,
        selected: { kind: "thread", objectId, threadId },
      }),
    );
  };

  // 空 session 判定 (H-3): 没 talk_windows 且 listThreads 返空
  const isEmptySession = talkWindows.length === 0 && items.length === 0;

  // RelationOverlay 容器 ref
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const relationSelected =
    selected?.kind === "thread"
      ? { objectId: selected.objectId, threadId: selected.threadId }
      : undefined;

  return (
    <div className="session-threads-index">
      <div className="session-threads-index-split">
        <aside className="session-threads-index-columns-wrap">
          {loadError && (
            <div className="session-threads-index-banner error small" role="alert">
              listThreads error: {loadError}
            </div>
          )}
          {degraded && (
            <div className="session-threads-index-banner muted small" role="status">
              Backend returned minimal shape — status/relations unavailable until D2 lands.
            </div>
          )}
          {isEmptySession ? (
            <EmptySession sessionId={sessionId} />
          ) : (
            <div className="session-threads-index-columns-scroll" ref={columnsRef}>
              <div className="session-threads-index-columns">
                {groupedColumns.length === 0 ? (
                  <div className="session-threads-index-empty muted small">
                    No threads yet — start a chat to see this session take shape.
                  </div>
                ) : (
                  groupedColumns.map((g) => (
                    <ObjectColumn
                      key={g.objectId}
                      objectId={g.objectId}
                      items={g.items}
                      selectedThreadId={
                        selected?.kind === "thread" ? selected.threadId : undefined
                      }
                      selectedObjectId={
                        selected?.kind === "thread" ? selected.objectId : undefined
                      }
                      onSelectThread={onSelectThread}
                    />
                  ))
                )}
              </div>
              <RelationOverlay
                containerRef={columnsRef}
                items={items}
                selected={relationSelected}
              />
            </div>
          )}

          <div className="session-threads-index-toolbar">
            <button
              type="button"
              className="btn small"
              onClick={() => setNewChatOpen(true)}
              title="Start a chat with another object"
            >
              <Plus size={11} style={{ marginRight: 3 }} />
              New chat
            </button>
            <span className="muted small">
              {items.length} thread(s) · {groupedColumns.length} object(s)
            </span>
          </div>
        </aside>

        <section className="session-threads-index-detail">
          <SelectionDetail
            sessionId={sessionId}
            selected={selected}
            talkWindows={talkWindows}
            items={items}
            selfObjectId={selfObjectId}
          />
        </section>
      </div>

      {newChatOpen && (
        <NewChatModal sessionId={sessionId} onClose={() => setNewChatOpen(false)} />
      )}
    </div>
  );
}

// groupByObject 移到 ./session-threads-index.helpers.ts —— 让纯函数可被单测引用
// 而不连带 import 整个 SessionThreadsIndex 组件链 (避免拉入 ChatPanel → MarkdownContent
// → rehype-raw 的 dev 依赖缺失)。

function SelectionDetail({
  sessionId,
  selected,
  talkWindows,
  items,
  selfObjectId,
}: {
  sessionId: string;
  selected:
    | { kind: "chat"; windowId: string }
    | { kind: "thread"; objectId: string; threadId: string }
    | undefined;
  talkWindows: TalkWindow[];
  items: ListThreadsItem[];
  selfObjectId?: string;
}) {
  if (!selected) {
    return (
      <div className="session-threads-index-empty-panel">
        <p>Pick a thread or chat from the left.</p>
        <p className="muted small">
          Threads are grouped by object; click any node to inspect; relations show as
          overlay lines when selected.
        </p>
      </div>
    );
  }
  if (selected.kind === "chat") {
    const w = talkWindows.find((tw) => tw.id === selected.windowId);
    if (!w) {
      return (
        <div className="session-threads-index-empty-panel">
          <p className="muted small">
            Chat <code>{selected.windowId}</code> not found on user.root —— 可能 talk_window 已被关闭。
          </p>
        </div>
      );
    }
    return <SelectedChat sessionId={sessionId} window={w} />;
  }
  // selected.kind === "thread"
  const item = items.find(
    (i) => i.objectId === selected.objectId && i.threadId === selected.threadId,
  );
  if (!item) {
    // 退化场景: 后端 listThreads 还没列到这条 / 已删除 → 用 selected 兜底拼一个最小 item
    const stub: ListThreadsItem = {
      objectId: selected.objectId,
      threadId: selected.threadId,
    };
    return (
      <ThreadInspectDetail sessionId={sessionId} item={stub} selfObjectId={selfObjectId} />
    );
  }
  return (
    <ThreadInspectDetail sessionId={sessionId} item={item} selfObjectId={selfObjectId} />
  );
}

function SelectedChat({ sessionId, window: w }: { sessionId: string; window: TalkWindow }) {
  // peer thread polling 独立轨 —— 与 Round 7 SelectionDetail 同款，保留发消息能力
  const { thread } = usePollingThread(sessionId, w.target, w.targetThreadId);
  const handleSend = async (text: string) => {
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

/**
 * H-3 (Round 5 体验官报告) 保留版：空 session 时跳到 /welcome 补 seed。
 */
function EmptySession({ sessionId }: { sessionId: string }) {
  return (
    <div className="session-threads-index-empty-state">
      <p>
        Nothing happening in this session yet — no talk windows on user.root and no
        peer threads.
      </p>
      <p>
        <Link
          to={`/welcome?session=${encodeURIComponent(sessionId)}`}
          className="btn small"
          data-testid="seed-via-welcome"
        >
          <MessageSquare size={11} style={{ marginRight: 4 }} />
          Seed first conversation via welcome
          <ArrowRight size={11} style={{ marginLeft: 4 }} />
        </Link>
      </p>
    </div>
  );
}

/** + 号弹窗 (沿用 Round 7 UserThreadHome 形态)。 */
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
