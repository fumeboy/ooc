/**
 * SessionThreadsIndex — ooc-3 adaptation of ooc-2 StaffView layout.
 *
 * Five-staff grid:
 *   ┌─ user ──┬─ supervisor ─┬─ assistant ─┐
 * t0│  ●root  │              │             │
 * t1│         │  ●user-talk  │             │
 * t2│         │              │  ●fork-1    │
 *   └─────────┴──────────────┴─────────────┘
 *
 * ooc-3 simplification:
 * - No contextWindows or talkPeers — items will arrive as minimal {objectId, threadId, status?}
 * - New chat modal calls /api/talk directly (no addUserTalkWindow)
 * - 4s polling on /api/flows/:sessionId/threads
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Layers, MessageSquare, Plus } from "lucide-react";
import { fetchSessionThreads } from "../../chat/query";
import { toPath, useRouteState } from "../../../app/routing";
import { useDisplayName, useDisplayNames } from "../../objects";
import { messageFromError } from "../../../transport/errors";
import { requestJson } from "../../../transport/http";
import type { ListThreadsItem } from "../types";
import { ThreadNode } from "./ThreadNode";
import { groupByObject } from "./session-threads-index.helpers";

const POLL_INTERVAL_MS = 4000;

interface SessionThreadsIndexProps {
  sessionId: string;
}

export function SessionThreadsIndex({ sessionId }: SessionThreadsIndexProps) {
  const [items, setItems] = useState<ListThreadsItem[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [degraded, setDegraded] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const route = useRouteState();
  const selectedObjectId = route.kind === "flowsView" ? route.objectId : undefined;
  const selectedThreadId = route.kind === "flowsView" ? route.threadId : undefined;
  const navigate = useNavigate();

  // 4s polling
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const resp = await fetchSessionThreads(sessionId);
        if (cancelled) return;
        const its: ListThreadsItem[] = (resp.items ?? []).map((i) => ({
          objectId: i.objectId,
          threadId: i.threadId,
          status: i.status as ListThreadsItem["status"],
        }));
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

  const groupedAll = useMemo(() => groupByObject(items), [items]);
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

  const isEmptySession = items.length === 0 && !loadError;
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
              title="Clear filter — back to full view"
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
          Backend returned minimal shape — status/relations unavailable until backend D2 lands.
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
      {columns.map((g, i) => (
        <StaffHeader key={g.objectId} objectId={g.objectId} colIndex={i} />
      ))}
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
 * BFS to collect all threads related to (seedObjectId, seedThreadId).
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
    for (const p of item.talkPeers ?? []) {
      if (p.targetThreadId) queue.push(key(p.targetObjectId, p.targetThreadId));
    }
    if (item.parentThreadId) queue.push(key(item.objectId, item.parentThreadId));
    for (const cid of item.childThreadIds ?? []) {
      queue.push(key(item.objectId, cid));
    }
    if (item.creatorObjectId && item.creatorThreadId) {
      queue.push(key(item.creatorObjectId, item.creatorThreadId));
    }
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
        Nothing happening in this session yet — no threads found.
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
      // ooc-3: use /api/talk to start new chat in existing session
      const targetUri = `ooc://stones/main/objects/${encodeURIComponent(t)}`;
      const res = await requestJson<{
        ok: boolean;
        sessionId: string;
        threadId: string;
      }>("/api/talk", {
        method: "POST",
        body: JSON.stringify({
          target: targetUri,
          content: m,
          sessionId,
        }),
      });
      onClose();
      navigate(
        toPath({
          kind: "flowsView",
          view: "index",
          sessionId: res.sessionId ?? sessionId,
          objectId: t,
          threadId: res.threadId,
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
          Start a new conversation with a target object in session {sessionId}.
        </p>
        <label className="field-label">
          Target object id
          <input
            className="input"
            placeholder="e.g. supervisor / my-agent"
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
