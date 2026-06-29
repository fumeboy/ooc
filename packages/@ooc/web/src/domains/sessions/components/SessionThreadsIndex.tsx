/**
 * SessionThreadsIndex — session 下所有 thread 的**树形视图**。
 *
 *   ▾ user · root                       [session entry]
 *     ▾ supervisor · plan               t·1
 *         worker · extract              ✓
 *       supervisor · review            ◐
 *
 * 跨 object 的森林：父子边吃两类来源 —— 同 object 的 parentThreadId、跨 object 的
 * creator 链（creatorObjectId/creatorThreadId）。`user/root` 通常是唯一真根。
 *
 * filter：
 *   - 按 object 下拉筛选（只看某个 object 的 thread，祖先链保留以维持树形）
 *   - 按 thread id / title 文本搜索
 *   命中节点高亮、强制展开；仅作祖先占位的节点淡化。
 *
 * 路由：
 *   - 行点击 → navigate `/flows/index?sessionId=&objectId=&threadId=`（选中高亮，不切 view）
 *   - user.root 节点 disabled，不可切换查看
 *   - 行右侧 "→" 按钮跳 thread_context view，保留 query
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, MessageSquare, Plus, Layers, ListTree, X } from "lucide-react";
import type { ContextWindow, ThreadContext } from "../../chat";
import { fetchSessionThreadsFull } from "../../chat";
import { addUserTalkWindow } from "../query";
import { toPath, useRouteState } from "../../../app/routing";
import { useDisplayNames } from "../../objects";
import { messageFromError } from "../../../transport/errors";
import type { ListThreadsItem } from "../types";
import { ThreadTreeView } from "./ThreadTreeView";
import {
  buildSessionThreadTree,
  pruneTree,
  collectMatchedKeys,
  listObjectIds,
} from "./thread-tree.helpers";

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

  // filter 状态
  const [objectFilter, setObjectFilter] = useState<string>("");
  const [queryFilter, setQueryFilter] = useState<string>("");

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

  const objectIds = useMemo(() => listObjectIds(items), [items]);
  useDisplayNames(objectIds);

  // object filter 指向的对象若已不在 items 里（thread 流转后消失），自动失效
  const effectiveObjectFilter =
    objectFilter && objectIds.includes(objectFilter) ? objectFilter : "";
  const filter = useMemo(
    () => ({ objectId: effectiveObjectFilter || undefined, query: queryFilter }),
    [effectiveObjectFilter, queryFilter],
  );
  const filterActive = !!filter.objectId || !!filter.query?.trim();

  const tree = useMemo(() => buildSessionThreadTree(items), [items]);
  const visibleTree = useMemo(() => pruneTree(tree, filter), [tree, filter]);
  const matchedKeys = useMemo(
    () => collectMatchedKeys(items, filter),
    [items, filter],
  );

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

  const clearFilter = () => {
    setObjectFilter("");
    setQueryFilter("");
  };

  const isEmptySession = talkWindows.length === 0 && items.length === 0;
  const totalTalks = items.reduce((sum, i) => sum + (i.talkPeers?.length ?? 0), 0);

  return (
    <div className="session-threads-index">
      <header className="session-threads-index-header">
        <div className="session-threads-index-header-main">
          <Layers size={14} className="muted" />
          <h2 className="session-threads-index-title">session threads</h2>
          <span className="muted small session-threads-index-stats">
            {objectIds.length} 个 object
            {" · "}
            {items.length} 个 thread
            {totalTalks > 0 && (
              <>
                {" · "}
                {totalTalks} 条 talk 链路
              </>
            )}
            {filterActive && (
              <>
                {" · "}
                <span className="session-threads-index-mode-pill">
                  过滤命中 {matchedKeys.size}
                </span>
              </>
            )}
          </span>
        </div>
        <div className="session-threads-index-header-actions">
          <button
            type="button"
            className="btn primary session-threads-index-new-chat"
            onClick={() => setNewChatOpen(true)}
            title="与另一个 object 开启对话"
          >
            <Plus size={12} style={{ marginRight: 4 }} />
            新对话
          </button>
        </div>
      </header>

      {!isEmptySession && items.length > 0 && (
        <div className="session-threads-index-filter">
          <ListTree size={13} className="muted" aria-hidden />
          <label className="session-threads-index-filter-field">
            <span className="muted small">object</span>
            <select
              className="session-threads-index-filter-select"
              value={effectiveObjectFilter}
              onChange={(e) => setObjectFilter(e.target.value)}
              aria-label="按 object 筛选 thread"
            >
              <option value="">全部 object</option>
              {objectIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <input
            className="session-threads-index-filter-search"
            type="search"
            placeholder="搜索 thread id / 标题…"
            value={queryFilter}
            onChange={(e) => setQueryFilter(e.target.value)}
            aria-label="按文本搜索 thread"
          />
          {filterActive && (
            <button
              type="button"
              className="btn small session-threads-index-filter-clear"
              onClick={clearFilter}
              title="清除筛选"
            >
              <X size={11} style={{ marginRight: 2 }} />
              清除
            </button>
          )}
        </div>
      )}

      {loadError && (
        <div className="session-threads-index-banner error small" role="alert">
          listThreads error: {loadError}
        </div>
      )}
      {degraded && (
        <div className="session-threads-index-banner muted small" role="status">
          后端返回了精简结构 —— 状态 / 关系暂不可用。
        </div>
      )}

      <div className="session-threads-index-body">
        {isEmptySession ? (
          <EmptySession sessionId={sessionId} />
        ) : items.length === 0 ? (
          <div className="session-threads-index-empty muted small">
            还没有 thread —— 开启一段对话，这个 session 就会成形。
          </div>
        ) : visibleTree.length === 0 ? (
          <div className="session-threads-index-empty muted small">
            没有匹配当前筛选的 thread。
            <button type="button" className="btn small" onClick={clearFilter} style={{ marginLeft: 8 }}>
              清除筛选
            </button>
          </div>
        ) : (
          <ThreadTreeView
            sessionId={sessionId}
            roots={visibleTree}
            selectedObjectId={selectedObjectId}
            selectedThreadId={selectedThreadId}
            matchedKeys={matchedKeys}
            filterActive={filterActive}
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

function EmptySession({ sessionId }: { sessionId: string }) {
  return (
    <div className="session-threads-index-empty-state">
      <p>
        这个 session 还没有任何动静 —— user.root 上没有 talk window，也没有 peer thread。
      </p>
      <p>
        <Link
          to={`/welcome?session=${encodeURIComponent(sessionId)}`}
          className="btn small"
          data-testid="seed-via-welcome"
        >
          <MessageSquare size={11} style={{ marginRight: 4 }} />
          从 welcome 开启第一段对话
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
          <strong>新对话</strong>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="muted small">
          在当前 session 的 user.root 上挂一个新 talk window 指向目标 object 并发首条消息。
          目标已存在则复用既有 talk window。
        </p>
        <label className="field-label">
          目标 object id
          <input
            className="input"
            placeholder="例如 supervisor / pdf-extractor / alice"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="field-label">
          第一条消息
          <textarea
            className="textarea"
            rows={4}
            placeholder="说点什么来开启对话…"
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
          <span className="muted small">⌘/Ctrl + Enter 提交</span>
          <button
            type="button"
            className="btn primary"
            onClick={() => void submit()}
            disabled={busy || !target.trim() || !text.trim()}
          >
            {busy ? "创建中…" : "开始对话"}
          </button>
        </div>
      </div>
    </div>
  );
}
