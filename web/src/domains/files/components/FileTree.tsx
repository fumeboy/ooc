import { useState } from "react";
import type { FileTreeNode as Node } from "../model";

export function FileTree({ root, selectedPath, onSelect }: { root?: Node; selectedPath?: string; onSelect: (node: Node) => void }) {
  if (!root) return <div className="muted small">No tree loaded.</div>;
  return <div className="tree"><TreeNode node={root} depth={0} selectedPath={selectedPath} onSelect={onSelect} /></div>;
}

function icon(node: Node, expanded: boolean) {
  if (node.marker === "flow") return "⑂";
  if (node.marker === "stone") return "◆";
  if (node.type === "directory") return expanded ? "▾" : "▸";
  if (node.name.endsWith(".json")) return "{}";
  if (node.name.endsWith(".md")) return "md";
  return "•";
}

function TreeNode({ node, depth, selectedPath, onSelect }: { node: Node; depth: number; selectedPath?: string; onSelect: (node: Node) => void }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const selected = selectedPath === node.path;
  return (
    <div>
      <button
        className={`tree-button ${selected ? "active" : ""}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={() => {
          if (node.type === "directory") setExpanded(!expanded);
          onSelect(node);
        }}
      >
        <span className="muted small" style={{ width: 20 }}>{icon(node, expanded)}</span>
        <span className="tree-label">{node.name}</span>
        {node.size !== undefined && <span className="muted small" style={{ marginLeft: "auto" }}>{node.size}B</span>}
      </button>
      {node.type === "directory" && expanded && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}

