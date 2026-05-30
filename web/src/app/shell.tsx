/**
 * AppShell — ooc-3 adaptation of ooc-2 shell.tsx.
 *
 * URL is the navigation source; local state only caches derived data + transient UI.
 * Adapted from ooc-2 shell.tsx to work with ooc-3 backend endpoints.
 *
 * Key changes from ooc-2:
 * - fetchFlows() calls /api/flows (new rich endpoint)
 * - continueThread() calls /api/flows/:sid/continue (sync, jobId=threadId)
 * - waitForJob() polls /api/runtime/jobs/:jobId (always returns "done")
 * - createSessionWithObject() calls /api/talk (sync)
 * - stone CRUD / knowledge CRUD are stubs (Batch 4)
 * - pause/resume wired to new endpoints (no HARD backend needed)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { continueThread, fetchJob, fetchSessionThreads, fetchThread, waitForJob } from "../domains/chat";
import { fetchFile, fetchTree, type FileTreeNode, type TreeScope } from "../domains/files";
import { fetchFlows, flowTitle, pauseFlowSession, resumeFlowSession, type FlowSession } from "../domains/flows";
import { fetchSelfFirstLine } from "../domains/objects";
import { createSessionWithObject } from "../domains/sessions";
import { fetchStones } from "../domains/stones";
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
import { scopeOf, toPath, useRouteState, type RouteState } from "./routing";
import { Card } from "../shared/ui/card";

export function AppShell() {
  const route = useRouteState();
  const navigate = useNavigate();
  const [state, setState] = useState<AppState>(initialState);
  const [showSessions, setShowSessions] = useState(true);
  const [stoneModalOpen, setStoneModalOpen] = useState(false);
  const [stoneDraft, setStoneDraft] = useState({ name: "", description: "", self: "", readme: "" });
  const [knowledgeModal, setKnowledgeModal] = useState<{ objectId: string; parentPath: string } | undefined>();
  const [knowledgeDraft, setKnowledgeDraft] = useState({ kind: "file" as "file" | "folder", path: "", content: "" });
  const [pauseBusy, setPauseBusy] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => readPersistedLayoutMode());
  const toggleLayoutMode = useCallback(() => {
    setLayoutMode((prev) => {
      const next: LayoutMode = prev === "three-column" ? "two-column" : "three-column";
      persistLayoutMode(next);
      return next;
    });
  }, []);

  const scope: TreeScope = scopeOf(route);
  const activeSessionId = (() => {
    if (route.kind === "flowsView" || route.kind === "flowPage") return route.sessionId;
    if (route.kind === "file") {
      if (route.thread?.sessionId) return route.thread.sessionId;
      const m = route.path.match(/^flows\/([^/]+)/);
      if (m) return m[1];
    }
    return undefined;
  })();
  const activeObjectId = (() => {
    if (route.kind === "flowsView") return route.objectId;
    if (route.kind === "file" && route.thread) return route.thread.objectId;
    return undefined;
  })();
  const activeThreadId = (() => {
    if (route.kind === "flowsView") return route.threadId;
    if (route.kind === "file" && route.thread) return route.thread.threadId;
    return undefined;
  })();
  const activePath = useMemo(() => derivePathFromRoute(route), [route]);

  const activeFlow = state.flows.find((flow) => flow.sessionId === activeSessionId);
  const isSessionPaused = Boolean(activeFlow?.paused);
  const knownSessionIds = useMemo(() => new Set(state.flows.map((f) => f.sessionId)), [state.flows]);

  const patch = useCallback((next: Partial<AppState>) => setState((prev) => ({ ...prev, ...next })), []);

  const refreshBasics = useCallback(async (targetScope: TreeScope = scope) => {
    patch({ loading: true, error: undefined });
    try {
      const [flows, stones, tree] = await Promise.all([
        fetchFlows(),
        fetchStones(),
        fetchTree(targetScope),
      ]);
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

  useEffect(() => { void refreshBasics(scope); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope]);

  const lastTreeFetchSessionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (scope !== "flows" || !activeSessionId) return;
    const inTree = state.tree?.children?.some(
      (c) => c.path === `flows/${activeSessionId}` || c.name === activeSessionId,
    );
    if (inTree) return;
    if (lastTreeFetchSessionRef.current === activeSessionId) return;
    lastTreeFetchSessionRef.current = activeSessionId;
    fetchTree("flows")
      .then((tree) => patch({ tree }))
      .catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeSessionId, scope, state.tree]);

  useEffect(() => {
    let cancelled = false;
    if (route.kind !== "file") {
      patch({ activeFile: undefined, activeStoneObjectId: undefined, activeKnowledgePath: undefined, fileDirty: false });
      return;
    }
    const filePath = route.path;
    const editable = knowledgeTarget(filePath);
    patch({ activeFile: undefined, activeStoneObjectId: editable?.objectId, activeKnowledgePath: editable?.path, fileDirty: false });
    fetchFile(filePath)
      .then((f) => { if (!cancelled) patch({ activeFile: f }); })
      .catch((e) => { if (!cancelled) patch({ error: messageFromError(e) }); });
    return () => { cancelled = true; };
  }, [route, patch]);

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
        patch({
          ...(thread != null ? { thread } : {}),
          sessionThreads: threads.items,
        });
      })
      .catch((e) => { if (!cancelled) patch({ error: messageFromError(e) }); });
    return () => { cancelled = true; };
  }, [activeSessionId, activeObjectId, activeThreadId, patch]);

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
        // polling failure — ignore, retry next tick
      }
    };
    const timer = window.setInterval(() => { void tick(); }, 4000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, activeObjectId, activeThreadId]);

  useEffect(() => {
    if (scope !== "flows") return;
    setShowSessions(!activeSessionId);
  }, [scope, activeSessionId]);

  function handleNode(node: FileTreeNode) {
    if (node.type !== "file") return;
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
      const firstLine = input.initialMessage.split("\n")[0] ?? "";
      const snippet = firstLine.length > 40 ? firstLine.slice(0, 39) + "…" : firstLine;
      const targetDisplay = (await fetchSelfFirstLine(input.targetObjectId)) ?? input.targetObjectId;
      const derivedTitle = snippet ? `${targetDisplay}: ${snippet}` : undefined;
      const created = await createSessionWithObject({ ...input, title: derivedTitle });
      await waitForJob(created.jobId, fetchJob);
      await refreshBasics(scope);
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
      const objectId = activeObjectId ?? "supervisor";
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
    patch({ error: "createStone not implemented in ooc-3 yet (Batch 4)" });
    setStoneModalOpen(false);
  }

  async function handleCreateKnowledge() {
    patch({ error: "createKnowledge not implemented in ooc-3 yet (Batch 4)" });
    setKnowledgeModal(undefined);
  }

  async function handleSaveFile() {
    patch({ error: "saveFile not implemented in ooc-3 yet (Batch 4)" });
  }

  function handleScope(targetScope: TreeScope) {
    navigate(toPath({ kind: "scope", scope: targetScope }));
  }

  function handleSelectThread(sel: SessionThread) {
    if (!activeSessionId) return;
    const view = route.kind === "flowsView" ? route.view : "thread_context";
    navigate(toPath({ kind: "flowsView", view, sessionId: activeSessionId, objectId: sel.objectId, threadId: sel.threadId }));
  }

  function handleShowContextWindows() {
    if (!activeSessionId || !activeObjectId || !activeThreadId) return;
    navigate(toPath({ kind: "flowsView", view: "thread_context", sessionId: activeSessionId, objectId: activeObjectId, threadId: activeThreadId }));
  }

  const isWelcome = route.kind === "welcome";

  return (
    <AppLayout
      mode={layoutMode}
      sidebar={
        <Sidebar
          scope={scope}
          flows={state.flows}
          tree={state.tree}
          activePath={activePath}
          activeSessionId={activeSessionId}
          activeSessionTitle={(() => {
            const f = state.flows.find((flow) => flow.sessionId === activeSessionId);
            return f ? flowTitle(f) : activeSessionId;
          })()}
          showSessions={showSessions}
          onToggleSessions={() => setShowSessions((prev) => !prev)}
          onShowWelcome={handleShowWelcome}
          onScope={handleScope}
          onNode={handleNode}
          onSession={handleSession}
          onCreateStone={() => setStoneModalOpen(true)}
          onCreateKnowledge={(node) => {
            const target = knowledgeDirectoryTarget(node);
            if (target) setKnowledgeModal(target);
          }}
        />
      }
      main={
        <MainPanel
          route={route}
          isWelcome={isWelcome}
          stones={state.stones}
          onCreateSession={handleCreate}
          file={state.activeFile}
          path={activePath}
          error={state.error}
          loading={state.loading}
          editableFile={Boolean(state.activeStoneObjectId && state.activeKnowledgePath)}
          savingFile={state.savingFile}
          onFileChange={(content) => state.activeFile && patch({ activeFile: { ...state.activeFile, content, size: content.length }, fileDirty: true })}
          onFileSave={handleSaveFile}
          thread={state.thread}
          selfObjectId={activeObjectId}
          onUserReply={handleSend}
          onRefresh={refreshActiveView}
          threadHeader={activeObjectId ? (
            <ThreadHeader
              objectId={activeObjectId}
              threadId={activeThreadId}
              thread={state.thread}
              sessionThreads={state.sessionThreads}
              onSelectThread={handleSelectThread}
            />
          ) : undefined}
          knownSessionIds={knownSessionIds}
          flowsReady={state.flowsHash !== undefined}
          layoutMode={layoutMode}
          onToggleLayoutMode={toggleLayoutMode}
        />
      }
      right={
        activeSessionId && activeObjectId && activeThreadId &&
        !(activeObjectId === "user" && activeThreadId === "root") ? (
          <RightPanel
            sessionId={activeSessionId}
            objectId={activeObjectId}
            threadId={activeThreadId}
            thread={state.thread}
            paused={isSessionPaused}
            pauseBusy={pauseBusy}
            onSend={handleSend}
            onTogglePause={handleToggleSessionPause}
            layoutMode={layoutMode}
            onToggleLayoutMode={toggleLayoutMode}
            onShowContextWindows={handleShowContextWindows}
          />
        ) : undefined
      }
    >
      <CreateStoneModal
        open={stoneModalOpen}
        draft={stoneDraft}
        onDraft={setStoneDraft}
        onClose={() => setStoneModalOpen(false)}
        onSubmit={handleCreateStone}
      />
      <CreateKnowledgeModal
        modal={knowledgeModal}
        draft={knowledgeDraft}
        onDraft={setKnowledgeDraft}
        onClose={() => setKnowledgeModal(undefined)}
        onSubmit={handleCreateKnowledge}
      />
    </AppLayout>
  );
}

function derivePathFromRoute(route: RouteState): string | undefined {
  switch (route.kind) {
    case "file":
      return route.path;
    case "stoneClient":
      return `stones/main/objects/${route.objectId}/client/index.tsx`;
    case "flowPage":
      return `flows/${route.sessionId}/objects/${route.objectId}/client/pages/${route.page}.tsx`;
    default:
      return undefined;
  }
}

function CreateStoneModal({ open, draft, onDraft, onClose, onSubmit }: {
  open: boolean;
  draft: { name: string; description: string; self: string; readme: string };
  onDraft: (d: { name: string; description: string; self: string; readme: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="row space-between">
          <strong>Create object</strong>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <p className="muted small">(Batch 4) Stone creation coming in Batch 4.</p>
        <div className="row space-between modal-actions">
          <span />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CreateKnowledgeModal({ modal, onClose }: {
  modal?: { objectId: string; parentPath: string };
  draft: { kind: "file" | "folder"; path: string; content: string };
  onDraft: (d: { kind: "file" | "folder"; path: string; content: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!modal) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal-card compact-modal">
        <div className="row space-between">
          <strong>Create knowledge entry</strong>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <p className="muted small">stones/{modal.objectId}/knowledge/{modal.parentPath}</p>
        <p className="muted small">(Batch 4) Knowledge CRUD coming in Batch 4.</p>
        <div className="row space-between modal-actions">
          <span />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
