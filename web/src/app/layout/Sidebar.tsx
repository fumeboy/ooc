import { MainLogo } from "../../shared/brand/MainLogo";
import type { FileTreeNode, TreeScope } from "../../domains/files";
import { FileTree } from "../../domains/files/components/FileTree";
import type { FlowSession } from "../../domains/flows";
import type { Stone } from "../../domains/stones";
import { SessionCreator } from "../../domains/sessions/components/SessionCreator";
import { SessionList } from "../../domains/sessions/components/SessionList";

export function Sidebar({ scope, flows, stones, tree, activePath, activeSessionId, onScope, onNode, onSession, onCreate }: { scope: TreeScope; flows: FlowSession[]; stones: Stone[]; tree?: FileTreeNode; activePath?: string; activeSessionId?: string; onScope: (scope: TreeScope) => void; onNode: (node: FileTreeNode) => void; onSession: (flow: FlowSession) => void; onCreate: (input: { sessionId: string; objectId: string; initialMessage?: string }) => Promise<void> }) {
  return <aside className="panel sidebar"><MainLogo /><div className="section"><div className="tabs">{(["world", "flows", "stones"] as TreeScope[]).map((item) => <button key={item} className={`tab ${scope === item ? "active" : ""}`} onClick={() => onScope(item)}>{item}</button>)}</div></div><div className="sidebar-body"><div className="section"><h3 className="section-title">Sessions</h3><SessionList flows={flows} activeSessionId={activeSessionId} onSelect={onSession} /></div><div className="section"><h3 className="section-title">Create Session</h3><SessionCreator stones={stones} onCreate={onCreate} /></div><div className="section"><h3 className="section-title">Tree</h3><FileTree root={tree} selectedPath={activePath} onSelect={onNode} /></div></div></aside>;
}

