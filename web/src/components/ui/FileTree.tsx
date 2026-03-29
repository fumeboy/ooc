/**
 * FileTree — 通用文件目录树组件
 *
 * 递归展开/折叠，支持文件选中回调。
 * 右键菜单支持复制文件路径。
 */
import { useState, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";
import {
  Folder,
  FolderOpen,
  FileText,
  FileJson2,
  FileImage,
  ChevronRight,
  ChevronDown,
  Box,
  GitBranch,
  LayoutList,
  Palette,
  Copy,
  Check,
} from "lucide-react";
import type { FileTreeNode } from "../../api/types";

interface FileTreeProps {
  root: FileTreeNode;
  onSelect?: (path: string, node: FileTreeNode) => void;
  selectedPath?: string;
  defaultExpanded?: boolean;
}

export function FileTree({ root, onSelect, selectedPath, defaultExpanded = false }: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  return (
    <div className="text-xs select-none relative" onClick={() => setContextMenu(null)}>
      {root.children?.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          onSelect={onSelect}
          selectedPath={selectedPath}
          depth={0}
          defaultExpanded={defaultExpanded}
          onContextMenu={(e, path) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, path });
          }}
        />
      )) ?? (
        <TreeNode
          node={root}
          onSelect={onSelect}
          selectedPath={selectedPath}
          depth={0}
          defaultExpanded={defaultExpanded}
          onContextMenu={(e, path) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, path });
          }}
        />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

/** 右键菜单 */
function ContextMenu({ x, y, path, onClose }: { x: number; y: number; path: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  /* 点击外部关闭 */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  /* Esc 关闭 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => { setCopied(false); onClose(); }, 600);
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-[var(--popover)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[160px]"
      style={{ left: x, top: y }}
    >
      <button
        onClick={handleCopy}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--accent)] transition-colors"
      >
        {copied
          ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          : <Copy className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
        }
        <span>{copied ? "已复制" : "复制路径"}</span>
      </button>
    </div>
  );
}

/** 文件图标选择 */
function FileIcon({ name }: { name: string }) {
  if (name === "ui") return <Palette className="w-3.5 h-3.5 text-pink-500 shrink-0" />;
  if (name === "index") return <LayoutList className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
  if (name.endsWith(".json")) return <FileJson2 className="w-3.5 h-3.5 text-yellow-600 shrink-0" />;
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name)) return <FileImage className="w-3.5 h-3.5 text-purple-500 shrink-0" />;
  return <FileText className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />;
}

interface TreeNodeProps {
  node: FileTreeNode;
  onSelect?: (path: string, node: FileTreeNode) => void;
  selectedPath?: string;
  depth: number;
  defaultExpanded: boolean;
  onContextMenu?: (e: React.MouseEvent, path: string) => void;
}

function TreeNode({ node, onSelect, selectedPath, depth, defaultExpanded, onContextMenu }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded && depth < 1);
  const isDir = node.type === "directory";
  const isSelected = selectedPath === node.path;

  const handleClick = () => {
    if (isDir) {
      /* 带 marker 的目录：切换展开 + 打开对应视图 */
      if (node.marker) {
        setExpanded(!expanded);
        onSelect?.(node.path, node);
        return;
      }
      setExpanded(!expanded);
      return;
    }
    onSelect?.(node.path, node);
  };

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu?.(e, node.path)}
        className={cn(
          "w-full text-left flex items-center gap-1.5 py-[3px] px-1.5 rounded-[4px] transition-colors hover:bg-[var(--accent)]/60",
          isSelected && "bg-[var(--accent)] font-medium",
        )}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
      >
        {isDir ? (
          <>
            {expanded
              ? <ChevronDown className="w-3 h-3 shrink-0 text-[var(--muted-foreground)]" />
              : <ChevronRight className="w-3 h-3 shrink-0 text-[var(--muted-foreground)]" />
            }
            {node.marker === "stone" ? (
              <Box className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            ) : node.marker === "flow" ? (
              <GitBranch className="w-3.5 h-3.5 text-orange-500 shrink-0" />
            ) : expanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileIcon name={node.name} />
          </>
        )}
        <span className="truncate">{node.name}</span>
        {!isDir && node.size != null && (
          <span className="ml-auto text-[10px] text-[var(--muted-foreground)] shrink-0">
            {formatSize(node.size)}
          </span>
        )}
      </button>

      {isDir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              onSelect={onSelect}
              selectedPath={selectedPath}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
