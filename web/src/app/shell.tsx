import { useCallback, useEffect, useState } from "react";
import { continueThread, fetchJob, fetchThread, waitForJob } from "../domains/chat";
import { fetchFile, fetchTree, type FileTreeNode, type TreeScope } from "../domains/files";
import { fetchFlows, type FlowSession } from "../domains/flows";
import { createSessionWithObject } from "../domains/sessions";
import { createKnowledgeDirectory, createKnowledgeFile, createStone, fetchStones, updateKnowledgeFile } from "../domains/stones";
import { messageFromError } from "../transport/errors";
import { AppLayout } from "./layout/AppLayout";
import { MainPanel } from "./layout/MainPanel";
import { RightPanel } from "./layout/RightPanel";
import { Sidebar } from "./layout/Sidebar";
import { initialState, type AppState } from "./state";

export function AppShell() {
  const [state, setState] = useState<AppState>(initialState);
  const [showSessions, setShowSessions] = useState(true);
  const [stoneModalOpen, setStoneModalOpen] = useState(false);
  const [stoneDraft, setStoneDraft] = useState({ name: "", description: "", self: "", readme: "" });
  const [knowledgeModal, setKnowledgeModal] = useState<{ objectId: string; parentPath: string } | undefined>();
  const [knowledgeDraft, setKnowledgeDraft] = useState({ kind: "file" as "file" | "folder", path: "", content: "" });

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

  useEffect(() => { void refreshBasics("world"); }, []);

  useEffect(() => {
    if (state.scope !== "flows") return;
    setShowSessions(!state.activeSessionId);
  }, [state.scope, state.activeSessionId]);

  async function loadThread(sessionId: string, objectId: string) {
    try {
      patch({ thread: await fetchThread(sessionId, objectId), activeSessionId: sessionId, activeObjectId: objectId });
    } catch (error) {
      patch({ error: messageFromError(error), activeSessionId: sessionId, activeObjectId: objectId });
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

  async function handleSession(flow: FlowSession) {
    const objectId = state.stones[0]?.objectId;
    patch({ activeSessionId: flow.sessionId, activeObjectId: objectId });
    if (objectId) await loadThread(flow.sessionId, objectId);
  }

  function handleShowWelcome() {
    patch({
      activeSessionId: undefined,
      activeObjectId: undefined,
      activePath: undefined,
      activeFile: undefined,
      activeStoneObjectId: undefined,
      activeKnowledgePath: undefined,
      thread: undefined,
      fileDirty: false,
      scope: "flows",
    });
    setShowSessions(true);
  }

  async function handleCreate(input: { sessionId: string; objectId: string; initialMessage?: string }) {
    patch({ loading: true, error: undefined });
    try {
      const created = await createSessionWithObject(input);
      await waitForJob(created.jobId, fetchJob);
      await refreshBasics(state.scope);
      await loadThread(input.sessionId, input.objectId);
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
    }
  }

  async function handleSend(text: string) {
    if (!state.activeSessionId || !state.activeObjectId) return;
    patch({ loading: true, error: undefined });
    try {
      const result = await continueThread(state.activeSessionId, state.activeObjectId, text);
      await waitForJob(result.jobId, fetchJob);
      await loadThread(state.activeSessionId, state.activeObjectId);
      patch({ loading: false });
    } catch (error) {
      patch({ error: messageFromError(error), loading: false });
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
      main={<MainPanel isWelcome={isWelcome} stones={state.stones} onCreateSession={handleCreate} file={state.activeFile} path={state.activePath} error={state.error} loading={state.loading} editableFile={Boolean(state.activeStoneObjectId && state.activeKnowledgePath)} savingFile={state.savingFile} onFileChange={(content) => state.activeFile && patch({ activeFile: { ...state.activeFile, content, size: content.length }, fileDirty: true })} onFileSave={handleSaveFile} />}
      right={<RightPanel sessionId={state.activeSessionId} objectId={state.activeObjectId} thread={state.thread} onSend={handleSend} />}
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
