/**
 * SessionThreadsIndex — 2026-05-27 v4：永远走 StaffView（五线谱）布局。
 *
 *   ┌─ user ──┬─ supervisor ─┬─ assistant ─┐
 *t0│  ●root  │              │             │
 *t1│         │  ●user-talk  │             │
 *t2│         │              │  ●fork-1    │
 *t3│         │  ✓done       │             │
 *   └─────────┴──────────────┴─────────────┘
 *
 * 两种 items 输入：
 *   **default**（无选中）：items = 全量 listThreads，所有 thread 按 createdAt 升序占行
 *   **filtered**（选中某 thread）：items = 通过 BFS 上下游算出的 relatedItems，列也只
 *     保留有相关 thread 的 object —— 视觉只是"行被裁过"，**不**切换组件形态，避免抖动
 *
 * 路由（沿用 2026-05-27 路由模型）：
 *   - 列表项点击 → navigate `/flows/index?sessionId=&objectId=&threadId=`
 *   - user.root 节点 disabled，不可切换查看
 *   - 右侧 "→" 按钮跳 thread_context view，保留 query
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, MessageSquare, Plus, Layers } from "lucide-react";
import type { ContextWindow, ThreadContext } from "../../chat";
import { fetchSessionThreadsFull } from "../../chat";
import { addUserTalkWindow } from "../query";
import { toPath, useRouteState } from "../../../app/routing";
import { useDisplayName, useDisplayNames } from "../../objects";
import { messageFromError } from "../../../transport/errors";
import type { ListThreadsItem } from "../types";
import { ThreadNode } from "./ThreadNode";
import { groupByObject } from "./session-threads-index.helpers";

const POLL_INTERVAL_MS = 4000;

interface SessionThreadsIndexProps {
  sessionId: string;
  /** 主 user.root thread (来自 shell 的 polling) — 用于派 talk_window 列表 */
  thread?: ThreadContext;
  selfObjectId?: string;
}

type TalkWindow = Extract<ContextWindow, { class: "talk" }>;

export function SessionThreadsIndex({
  sessionId,
  thread,
}: SessionThreadsIndexProps) {
  const [items, setItems] = useState<ListThreadsItem[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [degraded, setDegraded] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const route = useRouteState();
  const selectedObjectId = route.kind === "flowsView" ? route.objectId : undefined;
  const selectedThreadId = route.kind === "flowsView" ? route.threadId : undefined;
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

  // 命中 staff mode 的条件：query 带 objectId+threadId，且该 thread 在 items 列表里
  // （未在的话回 default，避免选中状态指向不存在的 thread）
  const selectionExistsInItems =
    !!selectedObjectId &&
    !!selectedThreadId &&
    items.some(
      (i) => i.objectId === selectedObjectId && i.threadId === selectedThreadId,
    );

  const relatedItems = useMemo(() => {
    if (!selectionExistsInItems) return undefined;
    return collectRelated(items, selectedObjectId!, selectedThreadId!);
  }, [items, selectedObjectId, selectedThreadId, selectionExistsInItems]);

  // default 模式分组（全量）
  const groupedAll = useMemo(() => groupByObject(items), [items]);
  // staff 模式分组（仅相关 items；保留 groupedAll 的列序与权重）
  const groupedStaff = useMemo(() => {
    if (!relatedItems) return undefined;
    return groupByObject(relatedItems);
  }, [relatedItems]);

  const visibleColumns = groupedStaff ?? groupedAll;
  const objectIds = useMemo(
    () => visibleColumns.map((g) => g.objectId),
    [visibleColumns],
  );
  useDisplayNames(objectIds);

  const talkWindows = useMemo(
    () =>
      (thread?.contextWindows ?? []).filter((w): w is TalkWindow => w.class === "talk"),
    [thread],
  );

  const onSelectThread = (objectId: string, threadId: string) => {
    navigate(
      toPath({
        kind: "flowsView",
        view: "index",
        sessionId,
        objectId,
        threadId,
      }),
    );
  };

  const isEmptySession = talkWindows.length === 0 && items.length === 0;
  const totalTalks = items.reduce((sum, i) => sum + (i.talkPeers?.length ?? 0), 0);

  return (
    <div className="session-threads-index">
      <header className="session-threads-index-header">
        <div className="session-threads-index-header-main">
          <Layers size={14} className="muted" />
          <h2 className="session-threads-index-title">Session threads</h2>
          <span className="muted small session-threads-index-stats">
            {groupedAll.length} object{groupedAll.length === 1 ? "" : "s"}
            {" · "}
            {items.length} thread{items.length === 1 ? "" : "s"}
            {totalTalks > 0 && (
              <>
                {" · "}
                {totalTalks} talk link{totalTalks === 1 ? "" : "s"}
              </>
            )}
            {relatedItems && (
              <>
                {" · "}
                <span className="session-threads-index-mode-pill">
                  staff view ({relatedItems.length} related)
                </span>
              </>
            )}
          </span>
        </div>
        <div className="session-threads-index-header-actions">
          {relatedItems && (
            <button
              type="button"
              className="btn small"
              onClick={() =>
                navigate(toPath({ kind: "flowsView", view: "index", sessionId }))
              }
              title="清除选中，回到全量视图"
            >
              Clear filter
            </button>
          )}
          <button
            type="button"
            className="btn primary session-threads-index-new-chat"
            onClick={() => setNewChatOpen(true)}
            title="Start a chat with another object"
          >
            <Plus size={12} style={{ marginRight: 4 }} />
            New chat
          </button>
        </div>
      </header>

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

      <div className="session-threads-index-body">
        {isEmptySession ? (
          <EmptySession sessionId={sessionId} />
        ) : visibleColumns.length === 0 ? (
          <div className="session-threads-index-empty muted small">
            No threads yet — start a chat to see this session take shape.
          </div>
        ) : (
          // 无选中 → 用全量 items；选中 → 用 relatedItems。统一走 StaffView 避免两套
          // 不一致的 UI 形态（早期版本 default 走 ObjectColumn 横向树，selected 走 staff
          // grid，视觉跳变明显）。default 模式下"列时间排序"也是合理的全局视图。
          <StaffView
            sessionId={sessionId}
            columns={visibleColumns}
            items={relatedItems ?? items}
            selectedObjectId={selectedObjectId}
            selectedThreadId={selectedThreadId}
            onSelectThread={onSelectThread}
          />
        )}
      </div>

      {newChatOpen && (
        <NewChatModal sessionId={sessionId} onClose={() => setNewChatOpen(false)} />
      )}
    </div>
  );
}

/**
 * StaffView — 五线谱布局：
 * - column 数 = visibleColumns.length；每列对应一个 object
 * - 每个 thread 占一整行；行索引由 createdAt 升序决定
 * - 同一行内只有一个 cell 渲染 ThreadNode（其它列对应的 cell 为空 spacer）
 * - 横线在每行底部画淡淡分隔，强化"五线谱"视觉
 */
function StaffView({
  sessionId,
  columns,
  items,
  selectedObjectId,
  selectedThreadId,
  onSelectThread,
}: {
  sessionId: string;
  columns: ReturnType<typeof groupByObject>;
  items: ListThreadsItem[];
  selectedObjectId?: string;
  selectedThreadId?: string;
  onSelectThread: (objectId: string, threadId: string) => void;
}) {
  const colIndexOf = useMemo(() => {
    const m = new Map<string, number>();
    columns.forEach((c, i) => m.set(c.objectId, i));
    return m;
  }, [columns]);
  const sortedItems = useMemo(
    () => items.slice().sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [items],
  );

  return (
    <div
      className="threads-staff"
      style={{ "--staff-cols": columns.length } as React.CSSProperties}
    >
      {/* Header row */}
      {columns.map((g, i) => (
        <StaffHeader key={g.objectId} objectId={g.objectId} colIndex={i} />
      ))}
      {/* Time-aligned thread rows */}
      {sortedItems.map((item, rowIdx) => {
        const col = (colIndexOf.get(item.objectId) ?? 0) + 1;
        const active =
          selectedObjectId === item.objectId && selectedThreadId === item.threadId;
        const disabled = item.objectId === "user" && item.threadId === "root";
        return (
          <div
            key={`${item.objectId}/${item.threadId}`}
            className="threads-staff-cell"
            style={{ gridRow: rowIdx + 2, gridColumn: col }}
          >
            <ThreadNode
              sessionId={sessionId}
              item={item}
              level={0}
              active={active}
              disabled={disabled}
              onSelect={() => onSelectThread(item.objectId, item.threadId)}
            />
          </div>
        );
      })}
      {/* Staff line: 每行底部画一条淡淡的横线（包括 header 下方）；
          用 ::after spacer 不容易跨整行，改用 grid 上的 background row 实现 —
          见 .threads-staff::before / 背景 layered rules in styles.css */}
    </div>
  );
}

function StaffHeader({ objectId, colIndex }: { objectId: string; colIndex: number }) {
  const { displayName } = useDisplayName(objectId);
  const initial = (displayName || objectId || "?").trim().slice(0, 1).toUpperCase();
  const accent = pickAccentForObject(objectId);
  return (
    <div
      className="threads-staff-header"
      style={
        {
          gridRow: 1,
          gridColumn: colIndex + 1,
          "--object-accent": accent,
        } as React.CSSProperties
      }
    >
      <span className="threads-staff-header-avatar" aria-hidden>
        {initial}
      </span>
      <div className="threads-staff-header-title-block">
        <span className="threads-staff-header-title" title={objectId}>
          {displayName}
        </span>
        <span className="threads-staff-header-id muted" title={objectId}>
          {objectId}
        </span>
      </div>
    </div>
  );
}

function pickAccentForObject(objectId: string): string {
  let h = 0;
  for (let i = 0; i < objectId.length; i++) {
    h = (h * 31 + objectId.charCodeAt(i)) % 360;
  }
  if (objectId === "user") return "hsl(220, 12%, 60%)";
  return `hsl(${h}, 55%, 55%)`;
}

/**
 * BFS 出与 (seedObjectId, seedThreadId) 上下游相关的所有 thread。
 *
 * 关系边：
 *   - talk_peers 双向：A.talk → B 视作 A↔B
 *   - parent / child（同 object 内）
 *   - creator 链（child.creatorObjectId/creatorThreadId → parent thread）
 *
 * 性能：N×O(N) BFS；session 规模 < 50 threads 完全够用。
 */
function collectRelated(
  items: ListThreadsItem[],
  seedObjectId: string,
  seedThreadId: string,
): ListThreadsItem[] {
  const key = (o: string, t: string) => `${o}/${t}`;
  const byKey = new Map(
    items.map((i) => [key(i.objectId, i.threadId), i] as const),
  );
  const visited = new Set<string>();
  const queue: string[] = [key(seedObjectId, seedThreadId)];
  while (queue.length > 0) {
    const k = queue.shift()!;
    if (visited.has(k)) continue;
    visited.add(k);
    const item = byKey.get(k);
    if (!item) continue;
    // 出边：talk peers
    for (const p of item.talkPeers ?? []) {
      if (p.targetThreadId) queue.push(key(p.targetObjectId, p.targetThreadId));
    }
    // 同 object 内的 parent / child
    if (item.parentThreadId) queue.push(key(item.objectId, item.parentThreadId));
    for (const cid of item.childThreadIds ?? []) {
      queue.push(key(item.objectId, cid));
    }
    // 跨 object 的 creator 链
    if (item.creatorObjectId && item.creatorThreadId) {
      queue.push(key(item.creatorObjectId, item.creatorThreadId));
    }
    // 入边：扫描其它 item，谁 talk 到我 / 谁 creator 是我
    for (const other of items) {
      if (other === item) continue;
      const otherTalksToMe = (other.talkPeers ?? []).some(
        (p) =>
          p.targetObjectId === item.objectId && p.targetThreadId === item.threadId,
      );
      if (otherTalksToMe) queue.push(key(other.objectId, other.threadId));
      if (
        other.creatorObjectId === item.objectId &&
        other.creatorThreadId === item.threadId
      ) {
        queue.push(key(other.objectId, other.threadId));
      }
    }
  }
  return items.filter((i) => visited.has(key(i.objectId, i.threadId)));
}

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
      if (out.targetObjectId && out.targetThreadId) {
        navigate(
          toPath({
            kind: "flowsView",
            view: "index",
            sessionId,
            objectId: out.targetObjectId,
            threadId: out.targetThreadId,
          }),
        );
      } else {
        navigate(toPath({ kind: "flowsView", view: "index", sessionId }));
      }
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
