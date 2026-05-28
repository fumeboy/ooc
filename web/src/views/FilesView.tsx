import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronRight, File, Folder, RefreshCw } from "lucide-react";
import { getTree, readFile, type TreeEntry } from "../api";

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

function TreeRowItem({
  node,
  depth,
  activePath,
  expandedDirs,
  onToggle,
  onFileClick,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | undefined;
  expandedDirs: Set<string>;
  onToggle: (node: TreeNode) => void;
  onFileClick: (node: TreeNode) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  return (
    <div>
      <button
        className={`tree-row${activePath === node.path ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => node.type === "dir" ? onToggle(node) : onFileClick(node)}
      >
        {node.type === "dir" ? (
          <ChevronRight size={11} style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform .14s ease", flexShrink: 0 }} />
        ) : (
          <span style={{ width: 11, flexShrink: 0 }} />
        )}
        {node.type === "dir" ? (
          <Folder size={12} style={{ color: "var(--muted-fg)", flexShrink: 0 }} />
        ) : (
          <File size={12} style={{ color: "var(--muted-fg)", flexShrink: 0 }} />
        )}
        <span className="tree-row-name">{node.name}</span>
      </button>
      {node.type === "dir" && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeRowItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              expandedDirs={expandedDirs}
              onToggle={onToggle}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FilesView() {
  const navigate = useNavigate();
  // path comes from the wildcard route /files/*
  const params = useParams();
  const filePath = (params["*"] as string | undefined) ?? "";

  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadedDirs, setLoadedDirs] = useState<Map<string, TreeNode[]>>(new Map());
  const [activePath, setActivePath] = useState<string | undefined>(filePath || undefined);
  const [fileContent, setFileContent] = useState<{ content: string; bytes: number; truncated?: boolean } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | undefined>();
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | undefined>();

  async function loadDir(path: string | undefined): Promise<TreeNode[]> {
    const res = await getTree(path);
    return res.entries.map((e) => buildNode(e, path ?? ""));
  }

  async function loadRoot() {
    setTreeLoading(true);
    setTreeError(undefined);
    try {
      const nodes = await loadDir(undefined);
      setRoots(nodes);
      const dirMap = new Map(loadedDirs);
      dirMap.set("", nodes);
      setLoadedDirs(dirMap);
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setTreeLoading(false);
    }
  }

  useEffect(() => { void loadRoot(); }, []);

  // Reload file if filePath param changes
  useEffect(() => {
    if (filePath) {
      setActivePath(filePath);
      void loadFile(filePath);
    }
  }, [filePath]);

  async function loadFile(path: string) {
    setFileLoading(true);
    setFileError(undefined);
    setFileContent(null);
    try {
      const res = await readFile(path);
      setFileContent({ content: res.content, bytes: res.bytes, truncated: res.truncated });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setFileLoading(false);
    }
  }

  async function handleToggle(node: TreeNode) {
    const expanded = new Set(expandedDirs);
    if (expanded.has(node.path)) {
      expanded.delete(node.path);
      setExpandedDirs(expanded);
    } else {
      expanded.add(node.path);
      setExpandedDirs(expanded);
      // Load children if not already loaded
      if (!loadedDirs.has(node.path)) {
        try {
          const children = await loadDir(node.path);
          // Attach children to node
          setRoots((prev) => attachChildren(prev, node.path, children));
          const dm = new Map(loadedDirs);
          dm.set(node.path, children);
          setLoadedDirs(dm);
        } catch {
          // ignore
        }
      }
    }
  }

  function attachChildren(nodes: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] {
    return nodes.map((n) => {
      if (n.path === targetPath) return { ...n, children, loaded: true };
      if (n.children) return { ...n, children: attachChildren(n.children, targetPath, children) };
      return n;
    });
  }

  function handleFileClick(node: TreeNode) {
    setActivePath(node.path);
    navigate(`/files/${node.path}`);
    void loadFile(node.path);
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  const isText = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return ["ts", "tsx", "js", "jsx", "json", "md", "txt", "yaml", "yml", "sh", "css", "html", "toml", "lock"].includes(ext);
  };

  return (
    <>
      <div className="main-header">
        <div style={{ flex: 1 }}>
          <div className="main-title">Files</div>
          {activePath && <div className="main-subtitle">{activePath}</div>}
        </div>
        <button className="btn btn-sm" onClick={loadRoot} disabled={treeLoading}>
          <RefreshCw size={12} />
        </button>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "240px minmax(0,1fr)", gap: 0, minHeight: 0, overflow: "hidden" }}>
        {/* Tree panel */}
        <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", padding: "8px 4px" }}>
          {treeError && <div className="error-msg" style={{ margin: 8 }}>{treeError}</div>}
          {treeLoading && <div className="loading" style={{ padding: 12 }}>Loading…</div>}
          {roots.map((node) => (
            <TreeRowItem
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              expandedDirs={expandedDirs}
              onToggle={handleToggle}
              onFileClick={handleFileClick}
            />
          ))}
        </div>

        {/* File viewer */}
        <div style={{ overflowY: "auto", padding: "14px 16px" }}>
          {!activePath && (
            <div className="empty">Click a file in the tree to view its contents.</div>
          )}
          {fileLoading && <div className="loading">Loading file…</div>}
          {fileError && <div className="error-msg">{fileError}</div>}
          {fileContent && activePath && (
            <>
              <div className="row space-between" style={{ marginBottom: 10 }}>
                <div className="breadcrumb">
                  <span>{activePath.split("/").pop()}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="muted small">{formatBytes(fileContent.bytes)}</span>
                  {fileContent.truncated && <span className="pill" style={{ fontSize: 10 }}>truncated</span>}
                </div>
              </div>
              {isText(activePath) ? (
                <pre className="code-block">{fileContent.content}</pre>
              ) : (
                <div className="empty muted">Binary file — preview not available.</div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
