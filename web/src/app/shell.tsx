import { useCallback, useEffect, useState } from "react";
import { continueThread, fetchJob, fetchThread, waitForJob } from "../domains/chat";
import { fetchFile, fetchTree, type FileTreeNode, type TreeScope } from "../domains/files";
import { fetchFlows, type FlowSession } from "../domains/flows";
import { createSessionWithObject } from "../domains/sessions";
import { fetchStones } from "../domains/stones";
import { messageFromError } from "../transport/errors";
import { AppLayout } from "./layout/AppLayout";
import { MainPanel } from "./layout/MainPanel";
import { RightPanel } from "./layout/RightPanel";
import { Sidebar } from "./layout/Sidebar";
import { initialState, type AppState } from "./state";

export function AppShell() {
  const [state, setState] = useState<AppState>(initialState);

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

  async function loadThread(sessionId: string, objectId: string) {
    try {
      patch({ thread: await fetchThread(sessionId, objectId), activeSessionId: sessionId, activeObjectId: objectId });
    } catch (error) {
      patch({ error: messageFromError(error), activeSessionId: sessionId, activeObjectId: objectId });
    }
  }

  async function handleNode(node: FileTreeNode) {
    patch({ activePath: node.path, error: undefined });
    if (node.type === "file") {
      try { patch({ activeFile: await fetchFile(node.path) }); }
      catch (error) { patch({ error: messageFromError(error) }); }
    }
  }

  async function handleSession(flow: FlowSession) {
    const objectId = state.stones[0]?.objectId;
    patch({ activeSessionId: flow.sessionId, activeObjectId: objectId, activeFile: undefined });
    if (objectId) await loadThread(flow.sessionId, objectId);
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

  return (
    <AppLayout
      sidebar={<Sidebar scope={state.scope} flows={state.flows} stones={state.stones} tree={state.tree} activePath={state.activePath} activeSessionId={state.activeSessionId} onScope={refreshBasics} onNode={handleNode} onSession={handleSession} onCreate={handleCreate} />}
      main={<MainPanel file={state.activeFile} path={state.activePath} error={state.error} loading={state.loading} />}
      right={<RightPanel sessionId={state.activeSessionId} objectId={state.activeObjectId} thread={state.thread} onSend={handleSend} />}
    />
  );
}

