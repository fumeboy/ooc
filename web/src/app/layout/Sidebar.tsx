import { MainLogo } from "../../shared/brand/MainLogo";
import { Box, Globe2, List, Plus, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { FileTreeNode, TreeScope } from "../../domains/files";
import { FileTree } from "../../domains/files/components/FileTree";
import type { FlowSession } from "../../domains/flows";
import { SessionList } from "../../domains/sessions/components/SessionList";

function getFlowTree(root: FileTreeNode | undefined, sessionId: string | undefined) {
  if (!root || !sessionId) return root;
  if (root.path === `flows/${sessionId}`) return root;
  return root.children?.find((node) => node.path === `flows/${sessionId}` || node.name === sessionId) ?? root;
}

export function Sidebar({ scope, flows, tree, activePath, activeSessionId, activeSessionTitle, showSessions, onToggleSessions, onShowWelcome, onScope, onNode, onSession, onCreateStone, onCreateKnowledge }: { scope: TreeScope; flows: FlowSession[]; tree?: FileTreeNode; activePath?: string; activeSessionId?: string; activeSessionTitle?: string; showSessions: boolean; onToggleSessions: () => void; onShowWelcome: () => void; onScope: (scope: TreeScope) => void; onNode: (node: FileTreeNode) => void; onSession: (flow: FlowSession) => void; onCreateStone?: () => void; onCreateKnowledge?: (node: FileTreeNode) => void }) {
  const tabs: Array<{ scope: TreeScope; label: string; icon: ReactNode }> = [
    { scope: "flows", label: "Flows", icon: <Zap size={13} /> },
    { scope: "stones", label: "Stones", icon: <Box size={13} /> },
    { scope: "world", label: "World", icon: <Globe2 size={13} /> },
  ];
  const flowTree = getFlowTree(tree, activeSessionId);

  return (
    <aside className="sidebar gap-2">
      <div className="sidebar-brand panel">
        <MainLogo />
      </div>

      <div className="sidebar-frame panel">
        <div className="section nav-section">
          <div className="tabs">
            {tabs.map((item) => (
              <button key={item.scope} className={`tab ${scope === item.scope ? "active" : ""}`} onClick={() => onScope(item.scope)}>
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {scope === "flows" && activeSessionId && (
          <div className="sidebar-toolbar">
            <SessionBar title={activeSessionTitle ?? activeSessionId} onToggleSessions={onToggleSessions} onShowWelcome={onShowWelcome} />
          </div>
        )}

        <div className="sidebar-pane">
          {scope === "flows" ? (
            showSessions || !activeSessionId ? (
              <div className="section">
                <p className="section-title">Sessions</p>
                <SessionList flows={flows} activeSessionId={activeSessionId} onSelect={onSession} />
              </div>
            ) : (
              <div className="section tree-section">
                <p className="section-title">Flow tree</p>
                <FileTree root={flowTree} selectedPath={activePath} onSelect={onNode} onCreate={onCreateKnowledge} />
              </div>
            )
          ) : scope === "stones" ? (
            <div className="section tree-section">
              <div className="row space-between">
                <p className="section-title" style={{ marginBottom: 0 }}>Stones tree</p>
                <button className="mini-button" title="Create object" onClick={onCreateStone}>
                  <Plus size={12} />
                </button>
              </div>
              <FileTree root={tree} selectedPath={activePath} onSelect={onNode} onCreate={onCreateKnowledge} />
            </div>
          ) : (
            <div className="section tree-section">
              <p className="section-title">World tree</p>
              <FileTree root={tree} selectedPath={activePath} onSelect={onNode} onCreate={onCreateKnowledge} />
            </div>
          )}
        </div>

        <div className="session-calendar">
          <div className="calendar-title"><span>4月 2026</span><span>{flows.length} sessions</span></div>
          <div className="calendar-grid">{Array.from({ length: 35 }).map((_, index) => <span key={index} className={index === 25 ? "hot" : index === 26 ? "selected" : ""} />)}</div>
        </div>
      </div>
    </aside>
  );
}

function SessionBar({ title, onToggleSessions, onShowWelcome }: { title: string; onToggleSessions: () => void; onShowWelcome: () => void }) {
  return (
    <div className="session-bar">
      <button className="session-bar-icon" onClick={onToggleSessions} title="Show sessions">
        <List size={14} />
      </button>
      <button className="session-bar-title" onClick={onToggleSessions} title={title || "Untitled session"}>
        {title || "Untitled session"}
      </button>
      <button className="session-bar-icon" onClick={onShowWelcome} title="Create session" aria-label="Create session">
        <Plus size={14} />
      </button>
    </div>
  );
}
