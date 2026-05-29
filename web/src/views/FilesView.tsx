/**
 * FilesView — faithful port of ooc-2 files view visual style.
 * Two-pane: tree sidebar + file viewer.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { File, Folder, FolderOpen, RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import { getTree, readFile, type TreeEntry } from "../api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isTextFile(path: string): boolean {
  const ext = fileExt(path);
  return ["ts", "tsx", "js", "jsx", "json", "md", "txt", "yaml", "yml", "sh", "css", "html", "toml", "lock", "gitignore", "env"].includes(ext);
}

function isMarkdown(path: string): boolean {
  return fileExt(path) === "md";
}

function TreeNodeItem({
  node, depth, activePath, expandedDirs, onToggle, onFileClick,
}: {
  node: TreeNode; depth: number; activePath?: string;
  expandedDirs: Set<string>;
  onToggle: (n: TreeNode) => void;
  onFileClick: (n: TreeNode) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const selected = activePath === node.path;
  return (
    <div className="tree-node">
      <button
        className={`tree-button ${selected ? "active" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        title={node.name}
        onClick={() => node.type === "dir" ? onToggle(node) : onFileClick(node)}
      >
        <span className="twisty">
          {node.type === "dir"
            ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
            : null}
        </span>
        {node.type === "dir"
          ? (isExpanded ? <FolderOpen size={13} className="tree-icon folder" /> : <Folder size={13} className="tree-icon folder" />)
          : <File size={13} className="tree-icon file" />}
        <span className="tree-label" title={node.name}>{node.name}</span>
      </button>
      {node.type === "dir" && isExpanded && node.children && (
        node.children.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            activePath={activePath}
            expandedDirs={expandedDirs}
            onToggle={onToggle}
            onFileClick={onFileClick}
          />
        ))
      )}
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesView() {
  const navigate = useNavigate();
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
  const [renderMd, setRenderMd] = useState(true);

  async function loadDir(path: string | undefined): Promise<TreeNode[]> {
    const res = await getTree(path);
    const entries = Array.isArray(res?.entries) ? res.entries : [];
    return entries.map((e) => buildNode(e, path ?? ""));
  }

  async function loadRoot() {
    setTreeLoading(true);
    setTreeError(undefined);
    try {
      const nodes = await loadDir(undefined);
      setRoots(nodes);
      const dm = new Map(loadedDirs);
      dm.set("", nodes);
      setLoadedDirs(dm);
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setTreeLoading(false);
    }
  }

  useEffect(() => { void loadRoot(); }, []);

  useEffect(() => {
    if (filePath) {
      setActivePath(filePath);
      void loadFileContent(filePath);
    }
  }, [filePath]);

  async function loadFileContent(path: string) {
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
      if (!loadedDirs.has(node.path)) {
        try {
          const children = await loadDir(node.path);
          setRoots((prev) => attachChildren(prev, node.path, children));
          const dm = new Map(loadedDirs);
          dm.set(node.path, children);
          setLoadedDirs(dm);
        } catch { /* ignore */ }
      }
    }
  }

  function handleFileClick(node: TreeNode) {
    setActivePath(node.path);
    navigate(`/files/${node.path}`);
    void loadFileContent(node.path);
  }

  const fileName = activePath ? activePath.split("/").pop() ?? activePath : undefined;

  return (
    <>
      <div className="header">
        <div style={{ flex: 1 }}>
          <div className="header-title">Files</div>
          {activePath && <div className="muted small" style={{ fontFamily: "monospace", fontSize: 11 }}>{activePath}</div>}
        </div>
        <button className="btn btn-sm" onClick={loadRoot} disabled={treeLoading}>
          <RefreshCw size={12} className={treeLoading ? "is-spinning" : ""} />
        </button>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "220px minmax(0,1fr)", gap: 0, minHeight: 0, overflow: "hidden" }}>
        {/* Tree panel */}
        <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", padding: "6px 4px" }}>
          {treeError && <div className="error" style={{ margin: 6, fontSize: 11 }}>{treeError}</div>}
          {treeLoading && <div className="muted small" style={{ padding: 8 }}>Loading…</div>}
          {roots.map((node) => (
            <TreeNodeItem
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
        <div style={{ overflowY: "auto", padding: "12px 14px" }}>
          {!activePath && (
            <div className="empty">Click a file in the tree to view its contents.</div>
          )}
          {fileLoading && <div className="empty">Loading file…</div>}
          {fileError && <div className="error">{fileError}</div>}
          {fileContent && activePath && (
            <>
              <div className="row space-between" style={{ marginBottom: 10 }}>
                <div className="row" style={{ gap: 6 }}>
                  <strong style={{ fontSize: 13 }}>{fileName}</strong>
                  {fileContent.truncated && <span className="pill" style={{ fontSize: 10 }}>truncated</span>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="muted small">{formatBytes(fileContent.bytes)}</span>
                  {isMarkdown(activePath) && (
                    <button
                      className={`btn btn-sm${renderMd ? " primary" : ""}`}
                      onClick={() => setRenderMd((p) => !p)}
                    >
                      {renderMd ? "Rendered" : "Source"}
                    </button>
                  )}
                </div>
              </div>

              {isMarkdown(activePath) && renderMd ? (
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileContent.content}</ReactMarkdown>
                </div>
              ) : isTextFile(activePath) ? (
                <pre className="file-viewer" style={{
                  margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: 12, lineHeight: 1.58,
                  background: "rgba(246,247,244,.95)",
                  border: "1px solid rgba(224,227,220,.92)",
                  borderRadius: 10, padding: "10px 12px",
                }}>{fileContent.content}</pre>
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
