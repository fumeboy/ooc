/**
 * FileTreeSidebar — adapted from ooc-2 FileTree for ooc-3's flat TreeEntry model.
 * Supports lazy-loading directories via getTree API.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, File, FileText, Folder, FolderOpen } from "lucide-react";
import { getTree, type TreeEntry } from "../../api";

interface TreeNode {
  path: string;
  name: string;
  type: "file" | "dir";
  children?: TreeNode[];
  loaded?: boolean;
}

function buildNode(entry: TreeEntry, parentPath: string): TreeNode {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  return { path, name: entry.name, type: entry.type };
}

function attachChildren(nodes: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return { ...n, children, loaded: true };
    if (n.children) return { ...n, children: attachChildren(n.children, targetPath, children) };
    return n;
  });
}

function fileIcon(name: string) {
  if (name.endsWith(".json")) return <File size={13} className="tree-icon json" />;
  if (name.endsWith(".md")) return <FileText size={13} className="tree-icon file" />;
  return <File size={13} className="tree-icon file" />;
}

function TreeNodeItem({
  node,
  depth,
  selectedPath,
  expandedDirs,
  onToggle,
  onFileClick,
}: {
  node: TreeNode;
  depth: number;
  selectedPath?: string;
  expandedDirs: Set<string>;
  onToggle: (node: TreeNode) => void;
  onFileClick: (node: TreeNode) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const selected = selectedPath === node.path;
  return (
    <div className="tree-node">
      <button
        className={`tree-button ${selected ? "active" : ""}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        title={node.name}
        onClick={() => node.type === "dir" ? onToggle(node) : onFileClick(node)}
      >
        <span className="twisty">
          {node.type === "dir"
            ? isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
            : null}
        </span>
        {node.type === "dir"
          ? (isExpanded ? <FolderOpen size={13} className="tree-icon folder" /> : <Folder size={13} className="tree-icon folder" />)
          : fileIcon(node.name)}
        <span className="tree-label" title={node.name}>{node.name}</span>
      </button>
      {node.type === "dir" && isExpanded && node.children && (
        node.children.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expandedDirs={expandedDirs}
            onToggle={onToggle}
            onFileClick={onFileClick}
          />
        ))
      )}
    </div>
  );
}

export function FileTreeSidebar({
  roots,
  selectedPath,
  expandedDirs,
  onToggle,
  onFileClick,
}: {
  roots: TreeNode[];
  selectedPath?: string;
  expandedDirs: Set<string>;
  onToggle: (node: TreeNode) => void;
  onFileClick: (node: TreeNode) => void;
}) {
  if (roots.length === 0) return <div className="muted small" style={{ padding: "8px 6px" }}>No files loaded.</div>;
  return (
    <div className="tree">
      {roots.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expandedDirs={expandedDirs}
          onToggle={onToggle}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}

export { type TreeNode, buildNode, attachChildren };
export async function loadDirNodes(path: string | undefined): Promise<TreeNode[]> {
  const res = await getTree(path);
  return res.entries.map((e) => buildNode(e, path ?? ""));
}
