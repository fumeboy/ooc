import { MainLogo } from "../../shared/brand/MainLogo";
import { Box, Globe2, Menu, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { FileTreeNode, TreeScope } from "../../domains/files";
import { FileTree } from "../../domains/files/components/FileTree";
import type { FlowSession } from "../../domains/flows";
import type { Stone } from "../../domains/stones";

export function Sidebar({ scope, flows, stones, tree, activePath, activeSessionId, onScope, onNode, onSession, onCreate }: { scope: TreeScope; flows: FlowSession[]; stones: Stone[]; tree?: FileTreeNode; activePath?: string; activeSessionId?: string; onScope: (scope: TreeScope) => void; onNode: (node: FileTreeNode) => void; onSession: (flow: FlowSession) => void; onCreate: (input: { sessionId: string; objectId: string; initialMessage?: string }) => Promise<void> }) {
  void stones;
  void activeSessionId;
  void onSession;
  void onCreate;
  const tabs: Array<{ scope: TreeScope; label: string; icon: ReactNode }> = [
    { scope: "flows", label: "Flows", icon: <Zap size={13} /> },
    { scope: "stones", label: "Stones", icon: <Box size={13} /> },
    { scope: "world", label: "World", icon: <Globe2 size={13} /> },
  ];
  return <aside className="panel sidebar"><MainLogo /><div className="section nav-section"><div className="tabs">{tabs.map((item) => <button key={item.scope} className={`tab ${scope === item.scope ? "active" : ""}`} onClick={() => onScope(item.scope)}>{item.icon}{item.label}</button>)}</div><div className="scope-select"><Menu size={12} /><span>{scope === "world" ? "hi" : scope}</span><span>⌄</span></div></div><div className="sidebar-body"><div className="section tree-section"><FileTree root={tree} selectedPath={activePath} onSelect={onNode} /></div><div className="session-calendar"><div className="calendar-title"><span>4月 2026</span><span>{flows.length || 4} sessions</span></div><div className="calendar-grid">{Array.from({ length: 35 }).map((_, index) => <span key={index} className={index === 25 ? "hot" : index === 26 ? "selected" : ""} />)}</div></div></div></aside>;
}
