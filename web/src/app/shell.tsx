import { useCallback, useEffect, useState } from "react";
import { continueThread, fetchJob, fetchSessionThreads, fetchThread, waitForJob } from "../domains/chat";
import { fetchFile, fetchTree, type FileTreeNode, type TreeScope } from "../domains/files";
import { fetchFlows, pauseFlowSession, resumeFlowSession, type FlowSession } from "../domains/flows";
import { createSessionWithObject } from "../domains/sessions";
import { createKnowledgeDirectory, createKnowledgeFile, createStone, fetchStones, updateKnowledgeFile } from "../domains/stones";
import { messageFromError } from "../transport/errors";
import { AppLayout } from "./layout/AppLayout";
import { MainPanel } from "./layout/MainPanel";
import { RightPanel } from "./layout/RightPanel";
import { Sidebar } from "./layout/Sidebar";
import { ThreadHeader } from "./layout/ThreadHeader";
import { initialState, type AppState, type SessionThread } from "./state";

export function AppShell() {
  const [state, setState] = useState<AppState>(initialState);
  const [showSessions, setShowSessions] = useState(true);
  const [stoneModalOpen, setStoneModalOpen] = useState(false);
  const [stoneDraft, setStoneDraft] = useState({ name: "", description: "", self: "", readme: "" });
  const [knowledgeModal, setKnowledgeModal] = useState<{ objectId: string; parentPath: string } | undefined>();
  const [knowledgeDraft, setKnowledgeDraft] = useState({ kind: "file" as "file" | "folder", path: "", content: "" });
  const [pauseBusy, setPauseBusy] = useState(false);
  const activeFlow = state.flows.find((flow) => flow.sessionId === state.activeSessionId);
  const isSessionPaused = Boolean(activeFlow?.paused);

  const patch = useCallback((next: Partial<AppState>) => setState((prev) => ({ ...prev, ...next })), []);

  const refreshBasics = useCallback(async (scope: TreeScope = state.scope) => {
    patch({ loading: true, error: undefined });
    try {
      const [flows, stones, tree] = await Promise.all([fetchFlows(), fetchStones(), fetchTree(scope)]);
      patch({ flows: flows.items, stones: stones.items, tree, scope, loading: false });
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }, [patch, state.scope]);

  /**
   * 显式刷新：覆盖当前可见的所有数据 —— flows / stones / 当前 scope 的 tree，
   * 以及（如果命中）activeFile 与当前 thread。供面包屑 ↻ 按钮使用。
   */
  const refreshActiveView = useCallback(async () => {
    patch({ loading: true, error: undefined });
    try {
      const [flowsRes, stonesRes, tree] = await Promise.all([fetchFlows(), fetchStones(), fetchTree(state.scope)]);
      let thread = state.thread;
      if (state.activeSessionId && state.activeObjectId) {
        thread = await fetchThread(state.activeSessionId, state.activeObjectId, state.activeThreadId ?? "root");
      }
      let activeFile = state.activeFile;
      if (state.activePath && state.activeFile) {
        activeFile = await fetchFile(state.activePath);
      }
      patch({ flows: flowsRes.items, stones: stonesRes.items, tree, thread, activeFile, loading: false });
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }, [patch, state.scope, state.activeSessionId, state.activeObjectId, state.activeThreadId, state.activePath, state.activeFile, state.thread]);

  useEffect(() => { void refreshBasics("world"); }, []);

  /**
   * Session 打开后静默轮询：同步 thread（chat 时间线）与 flows（session pause 状态），
   * 不动 loading 标志，避免拍频闪。当前 thread 是 root-thread-only 控制面，
   * 在 user 视角与 callee 视角间切换时由 activeObjectId / activeThreadId 重置定时器。
   */
  useEffect(() => {
    const sessionId = state.activeSessionId;
    const objectId = state.activeObjectId;
    if (!sessionId || !objectId) return;
    const threadId = state.activeThreadId ?? "root";
    let lastThreadHash = state.thread?.hash;
    let lastFlowsHash: string | undefined;
    const tick = async () => {
      try {
        const [thread, flows] = await Promise.all([
          fetchThread(sessionId, objectId, threadId),
          fetchFlows(),
        ]);
        const threadChanged = thread.hash !== lastThreadHash;
        const flowsChanged = flows.hash !== lastFlowsHash;
        if (!threadChanged && !flowsChanged) return;
        lastThreadHash = thread.hash;
        lastFlowsHash = flows.hash;
        setState((prev) => {
          if (prev.activeSessionId !== sessionId || prev.activeObjectId !== objectId) return prev;
          return {
            ...prev,
            thread: threadChanged ? thread : prev.thread,
            flows: flowsChanged ? flows.items : prev.flows,
          };
        });
      } catch {
        // 轮询失败不打扰 UI；下一次 tick 会重试。
      }
    };
    const timer = window.setInterval(() => { void tick(); }, 4000);
    return () => window.clearInterval(timer);
  }, [state.activeSessionId, state.activeObjectId, state.activeThreadId]);

  useEffect(() => {
    if (state.scope !== "flows") return;
    setShowSessions(!state.activeSessionId);
  }, [state.scope, state.activeSessionId]);

  /**
   * 加载某个 (object, thread) 的 thread + session 下所有 thread 列表（switcher 数据源）。
   *
   * collaborable § cross-object talk（spec 2026-05-15）：sessionThreads 至少含 user.root
   * 与一个 callee；用户在 switcher 上切换即更换 activeThreadId 后再次 loadThread。
   */
  async function loadThread(sessionId: string, objectId: string, threadId = "root") {
    try {
      const [thread, threads] = await Promise.all([
        fetchThread(sessionId, objectId, threadId),
        fetchSessionThreads(sessionId).catch(() => ({ items: [] as SessionThread[] })),
      ]);
      patch({
        thread,
        activeSessionId: sessionId,
        activeObjectId: objectId,
        activeThreadId: threadId,
        sessionThreads: threads.items,
      });
    } catch (error) {
      patch({
        error: messageFromError(error),
        activeSessionId: sessionId,
        activeObjectId: objectId,
        activeThreadId: threadId,
      });
    }
  }

  async function handleNode(node: FileTreeNode) {
    patch({ activePath: node.path, error: undefined, activeFile: undefined, activeStoneObjectId: undefined, activeKnowledgePath: undefined, fileDirty: false });
    if (node.type === "file") {
      try {
        const editable = knowledgeTarget(node.path);
        patch({ activeFile: await fetchFile(node.path), activeStoneObjectId: editable?.objectId, activeKnowledgePath: editable?.path, fileDirty: false });
      }
      catch (error) { patch({ error: messageFromError(error), activeFile: undefined, activeStoneObjectId: undefined, activeKnowledgePath: undefined, fileDirty: false }); }
    }
  }

  function knowledgeTarget(path: string) {
    const match = path.match(/^stones\/([^/]+)\/knowledge\/(.+)$/);
    return match ? { objectId: match[1], path: match[2] } : undefined;
  }

  function knowledgeDirectoryTarget(node: FileTreeNode) {
    const match = node.path.match(/^stones\/([^/]+)\/knowledge(?:\/(.*))?$/);
    return match ? { objectId: match[1], parentPath: match[2] ?? "" } : undefined;
  }

  /**
   * 用户从左侧 session 列表点开一条 session。
   *
   * 默认进入展示 user.root（user 视角看自己的 outbox），UI 上若用户切换 thread switcher
   * 再去 loadThread(sessionId, otherObjectId, otherThreadId)。
   */
  async function handleSession(flow: FlowSession) {
    patch({ activeSessionId: flow.sessionId });
    await loadThread(flow.sessionId, "user", "root");
  }

  function updateFlowPausedState(sessionId: string, paused: boolean) {
    setState((prev) => ({
      ...prev,
      flows: prev.flows.map((flow) => (flow.sessionId === sessionId ? { ...flow, paused } : flow)),
    }));
  }

  function handleShowWelcome() {
    patch({
      activeSessionId: undefined,
      activeObjectId: undefined,
      activeThreadId: undefined,
      activePath: undefined,
      activeFile: undefined,
      activeStoneObjectId: undefined,
      activeKnowledgePath: undefined,
      thread: undefined,
      sessionThreads: [],
      fileDirty: false,
      scope: "flows",
    });
    setShowSessions(true);
  }

  /**
   * 创建 session：等价于 user 对 target 的初次 talk。
   *
   * 流程：seedSession → 等 callee job 跑完 → 默认展示 user.root（user 视角能看到刚发的 message）。
   */
  async function handleCreate(input: { sessionId: string; targetObjectId: string; initialMessage: string }) {
    patch({ loading: true, error: undefined });
    try {
      const created = await createSessionWithObject(input);
      await waitForJob(created.jobId, fetchJob);
      await refreshBasics(state.scope);
      await loadThread(input.sessionId, "user", "root");
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }

  /**
   * 用户在 chat 框输入并发送。
   *
   * collaborable § cross-object talk（spec 2026-05-15）：固定走 user.root.talk_window；
   * 后端 deliverTalkMessage 把消息派送到 callee + 入队 callee 的 think job。
   * 等 job 完成后重新加载当前 thread（如果用户停在 user.root 就刷新 user.root；
   * 如果用户切到了 callee 视角就刷新 callee）。
   */
  async function handleSend(text: string) {
    if (!state.activeSessionId) return;
    patch({ loading: true, error: undefined });
    try {
      const result = await continueThread(state.activeSessionId, text);
      await waitForJob(result.jobId, fetchJob);
      const objectId = state.activeObjectId ?? "user";
      const threadId = state.activeThreadId ?? "root";
      await loadThread(state.activeSessionId, objectId, threadId);
      patch({ loading: false });
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }

  async function handleToggleSessionPause() {
    if (!state.activeSessionId) return;
    setPauseBusy(true);
    patch({ error: undefined });
    try {
      if (activeFlow?.paused) {
        const result = await resumeFlowSession(state.activeSessionId);
        updateFlowPausedState(state.activeSessionId, result.paused);
        await Promise.all(result.jobIds.map((jobId) => waitForJob(jobId, fetchJob)));
      } else {
        const result = await pauseFlowSession(state.activeSessionId);
        updateFlowPausedState(state.activeSessionId, result.paused);
      }
      if (state.activeObjectId) {
        await loadThread(state.activeSessionId, state.activeObjectId, state.activeThreadId ?? "root");
      }
      await refreshBasics(state.scope);
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
      await refreshBasics(state.scope);
    } catch (error) {
      patch({ error: messageFromError(error), savingFile: false });
    }
  }

  const isWelcome = state.scope === "flows" && !state.activeSessionId;

  return (
    <AppLayout
      sidebar={<Sidebar scope={state.scope} flows={state.flows} tree={state.tree} activePath={state.activePath} activeSessionId={state.activeSessionId} activeSessionTitle={state.flows.find((flow) => flow.sessionId === state.activeSessionId)?.title ?? state.activeSessionId} showSessions={showSessions} onToggleSessions={() => setShowSessions((prev) => !prev)} onShowWelcome={handleShowWelcome} onScope={refreshBasics} onNode={handleNode} onSession={handleSession} onCreateStone={() => setStoneModalOpen(true)} onCreateKnowledge={(node) => { const target = knowledgeDirectoryTarget(node); if (target) setKnowledgeModal(target); }} />}
      main={<MainPanel isWelcome={isWelcome} stones={state.stones} onCreateSession={handleCreate} file={state.activeFile} path={state.activePath} error={state.error} loading={state.loading} editableFile={Boolean(state.activeStoneObjectId && state.activeKnowledgePath)} savingFile={state.savingFile} onFileChange={(content) => state.activeFile && patch({ activeFile: { ...state.activeFile, content, size: content.length }, fileDirty: true })} onFileSave={handleSaveFile} thread={state.thread} selfObjectId={state.activeObjectId} onUserReply={handleSend} onRefresh={refreshActiveView} threadHeader={state.activeObjectId ? <ThreadHeader objectId={state.activeObjectId} threadId={state.activeThreadId} thread={state.thread} sessionThreads={state.sessionThreads} onSelectThread={(sel) => state.activeSessionId && void loadThread(state.activeSessionId, sel.objectId, sel.threadId)} /> : undefined} />}
      right={state.activeObjectId && state.activeObjectId !== "user" ? <RightPanel sessionId={state.activeSessionId} objectId={state.activeObjectId} threadId={state.activeThreadId} thread={state.thread} paused={isSessionPaused} pauseBusy={pauseBusy} onSend={handleSend} onTogglePause={handleToggleSessionPause} /> : undefined}
    >
      <CreateStoneModal open={stoneModalOpen} draft={stoneDraft} onDraft={setStoneDraft} onClose={() => setStoneModalOpen(false)} onSubmit={handleCreateStone} />
      <CreateKnowledgeModal modal={knowledgeModal} draft={knowledgeDraft} onDraft={setKnowledgeDraft} onClose={() => setKnowledgeModal(undefined)} onSubmit={handleCreateKnowledge} />
    </AppLayout>
  );
}

function CreateStoneModal({ open, draft, onDraft, onClose, onSubmit }: { open: boolean; draft: { name: string; description: string; self: string; readme: string }; onDraft: (draft: { name: string; description: string; self: string; readme: string }) => void; onClose: () => void; onSubmit: () => void }) {
  if (!open) return null;
  return <div className="modal-backdrop"><div className="modal-card"><div className="row space-between"><strong>Create object</strong><button className="btn" onClick={onClose}>Close</button></div><div className="stack"><label className="field-label">Name<input className="input" value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} placeholder="researcher" /></label><label className="field-label">Description<input className="input" value={draft.description} onChange={(event) => onDraft({ ...draft, description: event.target.value })} placeholder="What this object does" /></label><label className="field-label">self.md<textarea className="textarea code-textarea" value={draft.self} onChange={(event) => onDraft({ ...draft, self: event.target.value })} /></label><label className="field-label">readme.md<textarea className="textarea code-textarea" value={draft.readme} onChange={(event) => onDraft({ ...draft, readme: event.target.value })} /></label></div><div className="row space-between modal-actions"><span className="muted small">knowledge / memory / relations / server directories are initialized by the backend.</span><button className="btn primary" onClick={onSubmit}>Create</button></div></div></div>;
}

function CreateKnowledgeModal({ modal, draft, onDraft, onClose, onSubmit }: { modal?: { objectId: string; parentPath: string }; draft: { kind: "file" | "folder"; path: string; content: string }; onDraft: (draft: { kind: "file" | "folder"; path: string; content: string }) => void; onClose: () => void; onSubmit: () => void }) {
  if (!modal) return null;
  return <div className="modal-backdrop"><div className="modal-card compact-modal"><div className="row space-between"><strong>Create knowledge entry</strong><button className="btn" onClick={onClose}>Close</button></div><p className="muted small">stones/{modal.objectId}/knowledge/{modal.parentPath}</p><div className="row"><button className={`btn ${draft.kind === "file" ? "primary" : ""}`} onClick={() => onDraft({ ...draft, kind: "file" })}>File</button><button className={`btn ${draft.kind === "folder" ? "primary" : ""}`} onClick={() => onDraft({ ...draft, kind: "folder" })}>Folder</button></div><label className="field-label">Path<input className="input" value={draft.path} onChange={(event) => onDraft({ ...draft, path: event.target.value })} placeholder={draft.kind === "file" ? "notes/idea.md" : "notes"} /></label>{draft.kind === "file" && <label className="field-label">Initial content<textarea className="textarea code-textarea" value={draft.content} onChange={(event) => onDraft({ ...draft, content: event.target.value })} /></label>}<div className="row space-between modal-actions"><span className="muted small">Paths are relative to the selected knowledge folder.</span><button className="btn primary" onClick={onSubmit}>Create</button></div></div></div>;
}
