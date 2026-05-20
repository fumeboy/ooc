import { useState } from "react";
import { Box, ChevronDown, ChevronRight, FileJson2, FileText, Folder, FolderOpen, GitBranch, Plus } from "lucide-react";
import type { FileTreeNode as Node } from "../model";

export function FileTree({ root, selectedPath, onSelect, onCreate }: { root?: Node; selectedPath?: string; onSelect: (node: Node) => void; onCreate?: (node: Node) => void }) {
  if (!root) return <div className="muted small">No tree loaded.</div>;
  return <div className="tree"><TreeNode node={root} depth={0} selectedPath={selectedPath} onSelect={onSelect} onCreate={onCreate} /></div>;
}

function icon(node: Node, expanded: boolean) {
  if (node.marker === "flow") return <GitBranch size={13} className="tree-icon flow" />;
  if (node.marker === "stone") return <Box size={13} className="tree-icon stone" />;
  if (node.type === "directory") return expanded ? <FolderOpen size={13} className="tree-icon folder" /> : <Folder size={13} className="tree-icon folder" />;
  if (node.name.endsWith(".json")) return <FileJson2 size={13} className="tree-icon json" />;
  return <FileText size={13} className="tree-icon file" />;
}

function canCreateIn(node: Node) {
  return node.type === "directory" && /^stones\/[^/]+\/knowledge(?:\/|$)/.test(node.path);
}

function TreeNode({ node, depth, selectedPath, onSelect, onCreate }: { node: Node; depth: number; selectedPath?: string; onSelect: (node: Node) => void; onCreate?: (node: Node) => void }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const selected = selectedPath === node.path;
  return (
    <div className="tree-node">
      <button
        className={`tree-button ${selected ? "active" : ""}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        title={node.name}
        onClick={() => {
          if (node.type === "directory") setExpanded(!expanded);
          onSelect(node);
        }}
      >
        <span className="twisty">{node.type === "directory" ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}</span>
        {icon(node, expanded)}
        <span className="tree-label" title={node.name}>{node.name}</span>
        {node.size !== undefined && <span className="muted small" style={{ marginLeft: "auto" }}>{node.size}B</span>}
      </button>
      {onCreate && canCreateIn(node) && <button className="tree-inline-action" title="Create knowledge file or folder" onClick={() => onCreate(node)} style={{ left: depth * 14 + 2 }}><Plus size={11} /></button>}
      {node.type === "directory" && expanded && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} onCreate={onCreate} />
      ))}
    </div>
  );
}
