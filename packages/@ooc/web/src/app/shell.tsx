import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { continueThread, fetchJob, fetchSessionThreads, fetchThread, waitForJob } from "../domains/chat";
import { fetchFile, fetchTree, type FileTreeNode, type TreeScope } from "../domains/files";
import { fetchFlows, flowTitle, pauseFlowSession, resumeFlowSession, type FlowSession } from "../domains/flows";
import { fetchSelfFirstLine } from "../domains/objects";
import { createSessionWithObject } from "../domains/sessions";
import { createKnowledgeDirectory, createKnowledgeFile, createStone, fetchStones, updateKnowledgeFile } from "../domains/stones";
import { messageFromError } from "../transport/errors";
import { AppLayout } from "./layout/AppLayout";
import { MainPanel } from "./layout/MainPanel";
import { RightPanel } from "./layout/RightPanel";
import {
  type LayoutMode,
  persistLayoutMode,
  readPersistedLayoutMode,
} from "./layout/LayoutModeToggle";
import { Sidebar } from "./layout/Sidebar";
import { ThreadHeader } from "./layout/ThreadHeader";
import { initialState, type AppState, type SessionThread } from "./state";
import { deriveClientPath } from "../domains/clients/client-path";
import { scopeOf, toPath, useRouteState, type RouteState } from "./routing";
import { recordVisit } from "./nav-history";

/**
 * AppShell — URL 是导航源；本地 state 只缓存"已派生的数据 + transient UI"。
 *
 * 改造前（plan-002）：scope / activePath / activeSessionId / activeObjectId /
 * activeThreadId 全部 useState；handler 内 setState 改它们。
 *
 * 改造后（plan-003 step 3 + 实施变体）：从 useRouteState() 派生导航维度；
 * handler 改调 navigate(toPath(...))；useEffect 监 URL 变化触发数据加载。
 *
 * shell.tsx 整体不拆 Page；通过 URL 派生分支替代单体 setState 分支。
 */
export function AppShell() {
  const route = useRouteState();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<AppState>(initialState);
  const [showSessions, setShowSessions] = useState(true);
  const [stoneModalOpen, setStoneModalOpen] = useState(false);
  const [stoneDraft, setStoneDraft] = useState({ name: "", description: "", self: "", readme: "" });
  const [knowledgeModal, setKnowledgeModal] = useState<{ objectId: string; parentPath: string } | undefined>();
  const [knowledgeDraft, setKnowledgeDraft] = useState({ kind: "file" as "file" | "folder", path: "", content: "" });
  const [pauseBusy, setPauseBusy] = useState(false);
  // 布局模式：三栏（默认）/ 两栏（隐藏 sidebar，main+right 各 50%）。localStorage 持久化。
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => readPersistedLayoutMode());
  const toggleLayoutMode = useCallback(() => {
    setLayoutMode((prev) => {
      const next: LayoutMode = prev === "three-column" ? "two-column" : "three-column";
      persistLayoutMode(next);
      return next;
    });
  }, []);

  // 路由变化处统一拦截：记录最近访问的 path（只记 pathname，不含 query / domain）。
  useEffect(() => {
    recordVisit(location.pathname);
  }, [location.pathname]);

  // URL 派生导航维度 —— 下游只读这几个变量，不再读 state.scope / state.active* 的导航字段
  const scope: TreeScope = scopeOf(route);
  const activeSessionId = (() => {
    // 2026-05-27 路由重构：sessionId 从 path 移到 query；flowsView 直接读 route.sessionId
    if (route.kind === "flowsView" || route.kind === "flowPage") {
      return route.sessionId;
    }
    // stoneClient / file 视图：query 里有 sessionId（chat 上下文）则用之；否则从 path 推断
    if (route.kind === "stoneClient") {
      if (route.thread?.sessionId) return route.thread.sessionId;
      return undefined;
    }
    if (route.kind === "file") {
      if (route.thread?.sessionId) return route.thread.sessionId;
      const m = route.path.match(/^flows\/([^/]+)/);
      if (m) return m[1];
    }
    return undefined;
  })();
  // 2026-05 重构：thread 上下文在 query string；flowsView / file 路由都可携带
  // 2026-05-27：缺省**不**自动补 "user" / "root"，只有 query 显式带才视为有 thread 上下文
  const activeObjectId = (() => {
    if (route.kind === "flowsView") return route.objectId;
    if (route.kind === "stoneClient" && route.thread) return route.thread.objectId;
    if (route.kind === "flowPage") {
      // flowPage 路径自带 objectId（page 宿主），但 query thread.objectId 优先（chat 上下文）
      return route.thread?.objectId ?? route.objectId;
    }
    if (route.kind === "file" && route.thread) return route.thread.objectId;
    return undefined;
  })();
  const activeThreadId = (() => {
    if (route.kind === "flowsView") return route.threadId;
    if (route.kind === "stoneClient" && route.thread) return route.thread.threadId;
    if (route.kind === "flowPage" && route.thread) return route.thread.threadId;
    if (route.kind === "file" && route.thread) return route.thread.threadId;
    return undefined;
  })();
  const activePath = useMemo(() => derivePathFromRoute(route), [route]);

  const activeFlow = state.flows.find((flow) => flow.sessionId === activeSessionId);
  const isSessionPaused = Boolean(activeFlow?.paused);
  // Issue #5 Bad #2 fix: 让 MainPanel 能 cheap 判 session 存在性
  const knownSessionIds = useMemo(() => new Set(state.flows.map((f) => f.sessionId)), [state.flows]);

  const patch = useCallback((next: Partial<AppState>) => setState((prev) => ({ ...prev, ...next })), []);

  const refreshBasics = useCallback(async (targetScope: TreeScope = scope) => {
    patch({ loading: true, error: undefined });
    try {
      const [flows, stones, tree] = await Promise.all([fetchFlows(), fetchStones(), fetchTree(targetScope)]);
      patch({ flows: flows.items, flowsHash: flows.hash, stones: stones.items, tree, scope: targetScope, loading: false });
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }, [patch, scope]);

  const refreshActiveView = useCallback(async () => {
    patch({ loading: true, error: undefined });
    try {
      const threadId = activeThreadId ?? "root";
      const hadFile = Boolean(state.activeFile);
      const [flowsRes, stonesRes, tree] = await Promise.all([fetchFlows(), fetchStones(), fetchTree(scope)]);
      const nextThread = activeSessionId && activeObjectId
        ? await fetchThread(activeSessionId, activeObjectId, threadId)
        : undefined;
      const nextFile = activePath && hadFile ? await fetchFile(activePath) : undefined;
      setState((prev) => {
        const flowsChanged = flowsRes.hash !== prev.flowsHash;
        const threadChanged = nextThread != null && nextThread.hash !== prev.thread?.hash;
        const fileChanged = nextFile !== undefined && nextFile.content !== prev.activeFile?.content;
        return {
          ...prev,
          flows: flowsChanged ? flowsRes.items : prev.flows,
          flowsHash: flowsChanged ? flowsRes.hash : prev.flowsHash,
          stones: stonesRes.items,
          tree,
          thread: threadChanged ? nextThread : prev.thread,
          activeFile: fileChanged ? nextFile : prev.activeFile,
          loading: false,
        };
      });
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }, [patch, scope, activeSessionId, activeObjectId, activeThreadId, activePath, state.activeFile]);

  // 首屏 + scope 变化时拉 basics
  useEffect(() => { void refreshBasics(scope); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope]);

  /**
   * activeSessionId 变化时若当前 tree 不含该 session（被切到一个未在 cached tree 里的
   * session，例如新建后才出现的），重新 fetch tree。这让 sidebar 的 FLOW TREE 始终能
   * 把 root 缩到 `flows/<sessionId>/` 层级，而不是回退到 `flows/` 全树并且缺少该 session。
   *
   * lastTreeFetchSessionRef 防止 session 真的不存在时 fetch → patch → effect 重跑的死循环。
   */
  const lastTreeFetchSessionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (scope !== "flows" || !activeSessionId) return;
    const inTree = state.tree?.children?.some(
      (c) => c.path === `flows/${activeSessionId}` || c.name === activeSessionId,
    );
    if (inTree) return;
    if (lastTreeFetchSessionRef.current === activeSessionId) return; // 已为该 session 拉过一次
    lastTreeFetchSessionRef.current = activeSessionId;
    fetchTree("flows")
      .then((tree) => patch({ tree }))
      .catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeSessionId, scope, state.tree]);

  /**
   * URL 变化触发文件加载。
   * 仅 route.kind = file 且非 client 入口（client 入口走 ClientWithSourceToggle，
   * 不需要 activeFile）时 fetch。
   */
  useEffect(() => {
    let cancelled = false;
    if (route.kind !== "file") {
      // 离开 file 视图 → 清缓存
      patch({ activeFile: undefined, activeStoneObjectId: undefined, activeKnowledgePath: undefined, fileDirty: false });
      return;
    }
    const path = route.path;
    const editable = knowledgeTarget(path);
    patch({ activeFile: undefined, activeStoneObjectId: editable?.objectId, activeKnowledgePath: editable?.path, fileDirty: false });
    fetchFile(path)
      .then((f) => { if (!cancelled) patch({ activeFile: f }); })
      .catch((e) => { if (!cancelled) patch({ error: messageFromError(e) }); });
    return () => { cancelled = true; };
  }, [route, patch]);

  /**
   * URL 命中 session / thread 时加载 thread 数据 + sessionThreads。
   */
  useEffect(() => {
    if (!activeSessionId || !activeObjectId) {
      patch({ thread: undefined, sessionThreads: [] });
      return;
    }
    const tid = activeThreadId ?? "root";
    let cancelled = false;
    Promise.all([
      fetchThread(activeSessionId, activeObjectId, tid),
      fetchSessionThreads(activeSessionId).catch(() => ({ items: [] as SessionThread[] })),
    ])
      .then(([thread, threads]) => {
        if (cancelled) return;
        // thread 可能为 null(后端临时找不到 / 空 body),null 时不覆盖旧 state.thread
        patch({
          ...(thread != null ? { thread } : {}),
          sessionThreads: threads.items,
        });
      })
      .catch((e) => { if (!cancelled) patch({ error: messageFromError(e) }); });
    return () => { cancelled = true; };
  }, [activeSessionId, activeObjectId, activeThreadId, patch]);

  /**
   * Session 打开后静默轮询 thread + flows pause 状态。
   * URL 变化时自动重置（useEffect deps）。
   */
  useEffect(() => {
    if (!activeSessionId || !activeObjectId) return;
    const threadId = activeThreadId ?? "root";
    const tick = async () => {
      try {
        const [thread, flows] = await Promise.all([
          fetchThread(activeSessionId, activeObjectId, threadId),
          fetchFlows(),
        ]);
        setState((prev) => {
          // thread 可能为 null:fetchThread 类型 ThreadContext 但底层 requestJson
          // 在空 body / null body 时返回 null(thread 还在创建中等场景)。
          // 此时只更新 flows,thread 保留旧值。
          const threadChanged = thread !== null && thread.hash !== prev.thread?.hash;
          const flowsChanged = flows.hash !== prev.flowsHash;
          if (!threadChanged && !flowsChanged) return prev;
          return {
            ...prev,
            thread: threadChanged ? thread : prev.thread,
            flows: flowsChanged ? flows.items : prev.flows,
            flowsHash: flowsChanged ? flows.hash : prev.flowsHash,
          };
        });
      } catch {
        // 轮询失败不打扰 UI；下一次 tick 会重试。
      }
    };
    const timer = window.setInterval(() => { void tick(); }, 4000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, activeObjectId, activeThreadId]);

  // showSessions 同步：进 session 时关掉 list，回 welcome 时打开
  useEffect(() => {
    if (scope !== "flows") return;
    setShowSessions(!activeSessionId);
  }, [scope, activeSessionId]);

  // FileTree 点击 → navigate
  function handleNode(node: FileTreeNode) {
    if (node.type !== "file") return; // 目录只展开，不导航（plan-003 D2）
    // 保留 thread 上下文：当前在 session 内查看文件时，URL 带上 ?sessionId=&objectId=&threadId=
    // 让右侧 chat panel 跨文件查看持续显示。
    const thread =
      activeSessionId && activeObjectId && activeThreadId
        ? { sessionId: activeSessionId, objectId: activeObjectId, threadId: activeThreadId }
        : undefined;
    navigate(toPath({ kind: "file", path: node.path, thread }));
  }

  function knowledgeTarget(path: string) {
    const match = path.match(/^stones\/([^/]+)\/knowledge\/(.+)$/);
    return match ? { objectId: match[1], path: match[2] } : undefined;
  }

  function knowledgeDirectoryTarget(node: FileTreeNode) {
    const match = node.path.match(/^stones\/([^/]+)\/knowledge(?:\/(.*))?$/);
    return match ? { objectId: match[1], parentPath: match[2] ?? "" } : undefined;
  }

  function handleSession(flow: FlowSession) {
    navigate(toPath({ kind: "flowsView", view: "index", sessionId: flow.sessionId }));
  }

  function updateFlowPausedState(sessionId: string, paused: boolean) {
    setState((prev) => ({
      ...prev,
      flows: prev.flows.map((flow) => (flow.sessionId === sessionId ? { ...flow, paused } : flow)),
    }));
  }

  function handleShowWelcome() {
    navigate(toPath({ kind: "welcome" }));
    setShowSessions(true);
  }

  async function handleCreate(input: { sessionId: string; targetObjectId: string; initialMessage: string }) {
    patch({ loading: true, error: undefined });
    try {
      // Issue #3 A6 fix + displayName spec: 派生友好 title 给后端 (后端 schema 已支持 title 可选),
      // 避免 sidebar 列表显示 `web-1779214834923` 字面值。规则:
      //   `<displayName | targetObjectId>: <initialMessage 首行截 40 字>`
      // displayName 从 target 的 self.md 第一行派生(spec: visible.display_name_from_self_md);
      // 取不到时 fallback 回 targetObjectId,不阻塞 session 创建。
      const firstLine = input.initialMessage.split("\n")[0] ?? "";
      const snippet = firstLine.length > 40 ? firstLine.slice(0, 39) + "…" : firstLine;
      const targetDisplay = (await fetchSelfFirstLine(input.targetObjectId)) ?? input.targetObjectId;
      const derivedTitle = snippet ? `${targetDisplay}: ${snippet}` : undefined;
      const created = await createSessionWithObject({ ...input, title: derivedTitle });
      await waitForJob(created.jobId, fetchJob);
      await refreshBasics(scope);
      // 落地到 user-home（index view）+ 把新建 callee 的 thread 写进 query，让右侧 RightPanel
      // 立刻显示 ChatPanel（seedSession 返回 targetObjectId / targetThreadId 数据完备）。
      navigate(toPath({
        kind: "flowsView",
        view: "index",
        sessionId: created.sessionId,
        objectId: created.targetObjectId,
        threadId: created.targetThreadId,
      }));
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }

  async function handleSend(text: string) {
    if (!activeSessionId) return;
    patch({ loading: true, error: undefined });
    try {
      const result = await continueThread(activeSessionId, text);
      await waitForJob(result.jobId, fetchJob);
      const objectId = activeObjectId ?? "user";
      const threadId = activeThreadId ?? "root";
      const [thread, threads] = await Promise.all([
        fetchThread(activeSessionId, objectId, threadId),
        fetchSessionThreads(activeSessionId).catch(() => ({ items: [] as SessionThread[] })),
      ]);
      patch({
        ...(thread != null ? { thread } : {}),
        sessionThreads: threads.items,
        loading: false,
      });
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }

  async function handleToggleSessionPause() {
    if (!activeSessionId) return;
    setPauseBusy(true);
    patch({ error: undefined });
    try {
      if (activeFlow?.paused) {
        const result = await resumeFlowSession(activeSessionId);
        updateFlowPausedState(activeSessionId, result.paused);
        await Promise.all(result.jobIds.map((jobId) => waitForJob(jobId, fetchJob)));
      } else {
        const result = await pauseFlowSession(activeSessionId);
        updateFlowPausedState(activeSessionId, result.paused);
      }
      await refreshBasics(scope);
    } catch (error) {
      patch({ error: messageFromError(error) });
    } finally {
      setPauseBusy(false);
    }
  }

  async function handleCreateStone() {
    const name = stoneDraft.name.trim();
    if (!name) return patch({ error: "Object name is required" });
    patch({ loading: true, error: undefined });
    try {
      await createStone({ name, description: stoneDraft.description, self: stoneDraft.self, readme: stoneDraft.readme });
      setStoneModalOpen(false);
      setStoneDraft({ name: "", description: "", self: "", readme: "" });
      await refreshBasics("stones");
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }

  async function handleCreateKnowledge() {
    if (!knowledgeModal) return;
    const rawPath = knowledgeDraft.path.trim();
    if (!rawPath) return patch({ error: "Knowledge path is required" });
    const path = [knowledgeModal.parentPath, rawPath].filter(Boolean).join("/");
    patch({ loading: true, error: undefined });
    try {
      if (knowledgeDraft.kind === "folder") await createKnowledgeDirectory({ objectId: knowledgeModal.objectId, path });
      else await createKnowledgeFile({ objectId: knowledgeModal.objectId, path, content: knowledgeDraft.content });
      setKnowledgeModal(undefined);
      setKnowledgeDraft({ kind: "file", path: "", content: "" });
      await refreshBasics("stones");
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }

  async function handleSaveFile() {
    if (!state.activeFile || !state.activeStoneObjectId || !state.activeKnowledgePath) return;
    patch({ savingFile: true, error: undefined });
    try {
      await updateKnowledgeFile({ objectId: state.activeStoneObjectId, path: state.activeKnowledgePath, content: state.activeFile.content });
      patch({ savingFile: false, fileDirty: false });
      await refreshBasics(scope);
    } catch (error) {
      patch({ error: messageFromError(error), savingFile: false });
    }
  }

  function handleScope(targetScope: TreeScope) {
    // 切 LeftPanel scope（Flows/Stones/Pools/World）只换 path、保留当前 query string——
    // query 记录了当前 session（sessionId）以及 RightPanel 正在会话的 thread
    // （objectId/threadId）；清空会丢失右栏上下文。
    const search = location.search ?? "";
    navigate(`${toPath({ kind: "scope", scope: targetScope })}${search}`);
  }

  function handleSelectThread(sel: SessionThread) {
    if (!activeSessionId) return;
    // 切换 thread 时**保留当前 view kind**（在 thread_context 视图切 thread 不切回 index）。
    const view = route.kind === "flowsView" ? route.view : "thread_context";
    navigate(
      toPath({
        kind: "flowsView",
        view,
        sessionId: activeSessionId,
        objectId: sel.objectId,
        threadId: sel.threadId,
      }),
    );
  }

  function handleShowContextWindows() {
    if (!activeSessionId || !activeObjectId || !activeThreadId) return;
    navigate(
      toPath({
        kind: "flowsView",
        view: "thread_context",
        sessionId: activeSessionId,
        objectId: activeObjectId,
        threadId: activeThreadId,
      }),
    );
  }

  const isWelcome = route.kind === "welcome";

  return (
    <AppLayout
      mode={layoutMode}
      sidebar={<Sidebar scope={scope} flows={state.flows} tree={state.tree} activePath={activePath} activeSessionId={activeSessionId} activeSessionTitle={(() => { const f = state.flows.find((flow) => flow.sessionId === activeSessionId); return f ? flowTitle(f) : activeSessionId; })()} scopeQuery={location.search} showSessions={showSessions} onToggleSessions={() => setShowSessions((prev) => !prev)} onShowWelcome={handleShowWelcome} onScope={handleScope} onNode={handleNode} onSession={handleSession} onCreateStone={() => setStoneModalOpen(true)} onCreateKnowledge={(node) => { const target = knowledgeDirectoryTarget(node); if (target) setKnowledgeModal(target); }} />}
      main={<MainPanel route={route} isWelcome={isWelcome} stones={state.stones} onCreateSession={handleCreate} file={state.activeFile} path={activePath} error={state.error} loading={state.loading} editableFile={Boolean(state.activeStoneObjectId && state.activeKnowledgePath)} savingFile={state.savingFile} onFileChange={(content) => state.activeFile && patch({ activeFile: { ...state.activeFile, content, size: content.length }, fileDirty: true })} onFileSave={handleSaveFile} thread={state.thread} selfObjectId={activeObjectId} onUserReply={handleSend} onRefresh={refreshActiveView} threadHeader={activeObjectId ? <ThreadHeader objectId={activeObjectId} threadId={activeThreadId} thread={state.thread} sessionThreads={state.sessionThreads} onSelectThread={handleSelectThread} /> : undefined} knownSessionIds={knownSessionIds} flowsReady={state.flowsHash !== undefined} layoutMode={layoutMode} onToggleLayoutMode={toggleLayoutMode} />}
      right={activeSessionId && activeObjectId && activeThreadId && !(activeObjectId === "user" && activeThreadId === "root") ? <RightPanel sessionId={activeSessionId} objectId={activeObjectId} threadId={activeThreadId} thread={state.thread} paused={isSessionPaused} pauseBusy={pauseBusy} onSend={handleSend} onTogglePause={handleToggleSessionPause} layoutMode={layoutMode} onToggleLayoutMode={toggleLayoutMode} onShowContextWindows={handleShowContextWindows} /> : undefined}
    >
      <CreateStoneModal open={stoneModalOpen} draft={stoneDraft} onDraft={setStoneDraft} onClose={() => setStoneModalOpen(false)} onSubmit={handleCreateStone} />
      <CreateKnowledgeModal modal={knowledgeModal} draft={knowledgeDraft} onDraft={setKnowledgeDraft} onClose={() => setKnowledgeModal(undefined)} onSubmit={handleCreateKnowledge} />
    </AppLayout>
  );
}

/**
 * 把 RouteState 派生为 "world 相对路径"。
 *
 * 让 MainPanel 现有 matchClientTarget(path) 在 stoneClient / flowPage 路由下
 * 也能命中——shortcut URL → 同步的长 path → ClientWithSourceToggle 自动挂上。
 */
function derivePathFromRoute(route: RouteState): string | undefined {
  switch (route.kind) {
    case "file":
      return route.path;
    case "stoneClient":
      // canonical flat layout + visible/ (M2 ooc-6 rename). Shared helper guarantees
      // routing.ts normalizeClientFilePath and this derivation stay in sync.
      return deriveClientPath({ scope: "stone", objectId: route.objectId });
    case "flowPage":
      return deriveClientPath({
        scope: "flow",
        sessionId: route.sessionId,
        objectId: route.objectId,
        page: route.page,
      });
    default:
      return undefined;
  }
}

function CreateStoneModal({ open, draft, onDraft, onClose, onSubmit }: { open: boolean; draft: { name: string; description: string; self: string; readme: string }; onDraft: (draft: { name: string; description: string; self: string; readme: string }) => void; onClose: () => void; onSubmit: () => void }) {
  if (!open) return null;
  return <div className="modal-backdrop"><div className="modal-card"><div className="row space-between"><strong>Create object</strong><button className="btn" onClick={onClose}>Close</button></div><div className="stack"><label className="field-label">Name<input className="input" value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} placeholder="researcher" /></label><label className="field-label">Description<input className="input" value={draft.description} onChange={(event) => onDraft({ ...draft, description: event.target.value })} placeholder="What this object does" /></label><label className="field-label">self.md<textarea className="textarea code-textarea" value={draft.self} onChange={(event) => onDraft({ ...draft, self: event.target.value })} /></label><label className="field-label">readme.md<textarea className="textarea code-textarea" value={draft.readme} onChange={(event) => onDraft({ ...draft, readme: event.target.value })} /></label></div><div className="row space-between modal-actions"><span className="muted small">knowledge / memory / relations / server directories are initialized by the backend.</span><button className="btn primary" onClick={onSubmit}>Create</button></div></div></div>;
}

function CreateKnowledgeModal({ modal, draft, onDraft, onClose, onSubmit }: { modal?: { objectId: string; parentPath: string }; draft: { kind: "file" | "folder"; path: string; content: string }; onDraft: (draft: { kind: "file" | "folder"; path: string; content: string }) => void; onClose: () => void; onSubmit: () => void }) {
  if (!modal) return null;
  return <div className="modal-backdrop"><div className="modal-card compact-modal"><div className="row space-between"><strong>Create knowledge entry</strong><button className="btn" onClick={onClose}>Close</button></div><p className="muted small">stones/{modal.objectId}/knowledge/{modal.parentPath}</p><div className="row"><button className={`btn ${draft.kind === "file" ? "primary" : ""}`} onClick={() => onDraft({ ...draft, kind: "file" })}>File</button><button className={`btn ${draft.kind === "folder" ? "primary" : ""}`} onClick={() => onDraft({ ...draft, kind: "folder" })}>Folder</button></div><label className="field-label">Path<input className="input" value={draft.path} onChange={(event) => onDraft({ ...draft, path: event.target.value })} placeholder={draft.kind === "file" ? "notes/idea.md" : "notes"} /></label>{draft.kind === "file" && <label className="field-label">Initial content<textarea className="textarea code-textarea" value={draft.content} onChange={(event) => onDraft({ ...draft, content: event.target.value })} /></label>}<div className="row space-between modal-actions"><span className="muted small">Paths are relative to the selected knowledge folder.</span><button className="btn primary" onClick={onSubmit}>Create</button></div></div></div>;
}
