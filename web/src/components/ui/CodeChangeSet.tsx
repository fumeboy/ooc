/**
 * CodeChangeSet — 多文件变更集组件
 *
 * Git 风格的多文件变更展示，包含文件列表和选中文件的 Diff。
 * 支持按目录分组、展开/折叠、统计信息展示。
 */

import { useState, useMemo } from "react";
import { cn } from "../../lib/utils";
import { FileDiffViewer } from "./FileDiffViewer";
import { Badge } from "./Badge";
import {
  File,
  FilePlus,
  FileMinus,
  FileEdit,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Folder,
} from "lucide-react";

/** 文件变更状态 */
export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

/** 单个文件变更 */
export interface FileChange {
  /** 文件路径 */
  path: string;
  /** 变更类型 */
  status: FileChangeStatus;
  /** 新增行数 */
  additions: number;
  /** 删除行数 */
  deletions: number;
  /** 旧版本内容（modified/deleted/renamed 时需要） */
  oldContent?: string;
  /** 新版本内容（added/modified/renamed 时需要） */
  newContent?: string;
  /** 重命名时的旧路径 */
  oldPath?: string;
}

interface CodeChangeSetProps {
  /** 文件变更列表 */
  changes: FileChange[];
  /** 当前选中的文件路径 */
  selectedPath?: string;
  /** 文件选择回调 */
  onSelect?: (path: string) => void;
  /** 是否默认收起文件列表 */
  collapsed?: boolean;
  /** 是否显示统计信息（总变更数、+/-行数） */
  showStats?: boolean;
  /** 最大高度 */
  maxHeight?: string;
  /** 空状态文本 */
  emptyText?: string;
}

export type { CodeChangeSetProps };

/** 状态图标映射 */
const STATUS_ICONS: Record<FileChangeStatus, typeof File> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
  renamed: FileEdit,
};

/** 状态颜色映射 */
const STATUS_COLORS: Record<FileChangeStatus, string> = {
  added: "text-green-600 dark:text-green-400",
  modified: "text-amber-600 dark:text-amber-400",
  deleted: "text-red-600 dark:text-red-400",
  renamed: "text-purple-600 dark:text-purple-400",
};

/** 状态 Badge 颜色映射 */
const STATUS_BADGE_VARIANTS: Record<FileChangeStatus, "green" | "yellow" | "red" | "purple"> = {
  added: "green",
  modified: "yellow",
  deleted: "red",
  renamed: "purple",
};

/** 状态显示文本 */
const STATUS_LABELS: Record<FileChangeStatus, string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
};

/**
 * 按目录分组文件变更
 *
 * @param changes 文件变更列表
 * @returns Map<目录路径, 该目录下的文件变更列表>，根目录用空字符串表示
 */
function groupByDirectory(changes: FileChange[]): Map<string, FileChange[]> {
  const groups = new Map<string, FileChange[]>();
  for (const change of changes) {
    const parts = change.path.split("/");
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join("/");
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(change);
    } else {
      // 根目录文件
      if (!groups.has("")) groups.set("", []);
      groups.get("")!.push(change);
    }
  }
  return groups;
}

/**
 * 从文件路径提取语言（用于语法高亮）
 */
function getLanguageFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  // 常见扩展名映射
  const extMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    swift: "swift",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "shell",
    bash: "shell",
    sql: "sql",
    xml: "xml",
  };
  return extMap[ext] || ext;
}

/**
 * 目录树节点
 */
interface DirectoryNode {
  /** 目录完整路径 */
  path: string;
  /** 目录名称（最后一段） */
  name: string;
  /** 子目录 */
  children: DirectoryNode[];
  /** 该目录下的文件 */
  files: FileChange[];
}

/**
 * 构建目录树结构
 */
function buildDirectoryTree(groups: Map<string, FileChange[]>): DirectoryNode {
  const root: DirectoryNode = {
    path: "",
    name: "",
    children: [],
    files: groups.get("") || [],
  };

  // 按路径深度排序，确保父目录先处理
  const dirs = Array.from(groups.entries())
    .filter(([path]) => path !== "")
    .sort(([a], [b]) => a.split("/").length - b.split("/").length);

  // 目录路径到节点的映射
  const nodeMap = new Map<string, DirectoryNode>();

  for (const [dirPath, files] of dirs) {
    const parts = dirPath.split("/");
    let current: DirectoryNode = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      // 查找或创建子节点
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        const newChild: DirectoryNode = {
          path: currentPath,
          name: part,
          children: [],
          files: [],
        };
        current.children.push(newChild);
        nodeMap.set(currentPath, newChild);
        child = newChild;
      }
      current = child;
    }

    // 最后一个节点分配文件
    current.files = files;
  }

  return root;
}

/**
 * 目录项组件
 */
interface DirectoryItemProps {
  node: DirectoryNode;
  depth: number;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
}

function DirectoryItem({
  node,
  depth,
  expandedDirs,
  toggleDir,
  selectedPath,
  onSelect,
}: DirectoryItemProps) {
  const isExpanded = expandedDirs.has(node.path);

  return (
    <div>
      {/* 目录本身（非根目录） */}
      {node.path !== "" && (
        <button
          onClick={() => toggleDir(node.path)}
          className="w-full text-left flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-[var(--accent)]/60 transition-colors text-[var(--muted-foreground)]"
          style={{ paddingLeft: `${depth * 16 + 6}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 shrink-0 text-blue-500" />
          ) : (
            <Folder className="w-4 h-4 shrink-0 text-blue-500" />
          )}
          <span className="text-xs truncate">{node.name}</span>
        </button>
      )}

      {/* 展开后显示子目录和文件 */}
      {(node.path === "" || isExpanded) && (
        <div>
          {/* 子目录 */}
          {node.children
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <DirectoryItem
                key={child.path}
                node={child}
                depth={depth + (node.path === "" ? 0 : 1)}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}

          {/* 文件 */}
          {node.files
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((file) => (
              <FileChangeItem
                key={file.path}
                change={file}
                depth={depth + (node.path === "" ? 0 : 1)}
                isSelected={selectedPath === file.path}
                onSelect={() => onSelect(file.path)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * 文件变更项组件
 */
interface FileChangeItemProps {
  change: FileChange;
  depth: number;
  isSelected: boolean;
  onSelect: () => void;
}

function FileChangeItem({ change, depth, isSelected, onSelect }: FileChangeItemProps) {
  const StatusIcon = STATUS_ICONS[change.status];
  const statusColor = STATUS_COLORS[change.status];
  const fileName = change.path.split("/").pop() || change.path;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left flex items-center gap-1.5 py-1 px-1.5 rounded transition-colors",
        isSelected
          ? "bg-[var(--accent)] font-medium"
          : "hover:bg-[var(--accent)]/60"
      )}
      style={{ paddingLeft: `${depth * 16 + 6 + 16}px` }}
    >
      <StatusIcon className={cn("w-4 h-4 shrink-0", statusColor)} />
      <span className="text-xs truncate flex-1">{fileName}</span>
      <span className="flex items-center gap-1 text-xs shrink-0">
        {change.additions > 0 && (
          <span className="text-green-600 dark:text-green-400">+{change.additions}</span>
        )}
        {change.deletions > 0 && (
          <span className="text-red-600 dark:text-red-400">-{change.deletions}</span>
        )}
      </span>
    </button>
  );
}

/**
 * Diff 内容区域
 */
interface DiffContentProps {
  change: FileChange | undefined;
}

function DiffContent({ change }: DiffContentProps) {
  if (!change) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--muted-foreground)] text-sm">
        选择左侧文件查看变更详情
      </div>
    );
  }

  const { oldContent = "", newContent = "", status, path, oldPath } = change;
  const language = getLanguageFromPath(path);

  // 处理新增文件：显示为全绿
  if (status === "added") {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30">
          <Badge variant={STATUS_BADGE_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
          <span className="text-sm font-mono text-[var(--foreground)]">{path}</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <FileDiffViewer
            oldContent=""
            newContent={newContent}
            language={language}
            viewMode="split"
            collapseUnchanged={false}
          />
        </div>
      </div>
    );
  }

  // 处理删除文件：显示为全红
  if (status === "deleted") {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30">
          <Badge variant={STATUS_BADGE_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
          <span className="text-sm font-mono text-[var(--foreground)]">{path}</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <FileDiffViewer
            oldContent={oldContent}
            newContent=""
            language={language}
            viewMode="split"
            collapseUnchanged={false}
          />
        </div>
      </div>
    );
  }

  // 处理重命名文件：显示重命名提示 + Diff
  if (status === "renamed") {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30 flex-wrap">
          <Badge variant={STATUS_BADGE_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
          <span className="text-sm font-mono">
            <span className="text-red-600 dark:text-red-400">{oldPath}</span>
            <span className="text-[var(--muted-foreground)] mx-1">→</span>
            <span className="text-green-600 dark:text-green-400">{path}</span>
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <FileDiffViewer
            oldContent={oldContent}
            newContent={newContent}
            language={language}
            viewMode="split"
            collapseUnchanged={false}
          />
        </div>
      </div>
    );
  }

  // 处理修改文件：普通 Diff
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30">
        <Badge variant={STATUS_BADGE_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
        <span className="text-sm font-mono text-[var(--foreground)]">{path}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <FileDiffViewer
          oldContent={oldContent}
          newContent={newContent}
          language={language}
          viewMode="split"
          collapseUnchanged={false}
        />
      </div>
    </div>
  );
}

/**
 * CodeChangeSet — 多文件变更集组件
 */
export function CodeChangeSet({
  changes,
  selectedPath: externalSelectedPath,
  onSelect,
  collapsed: defaultCollapsed = false,
  showStats = true,
  maxHeight,
  emptyText = "暂无文件变更",
}: CodeChangeSetProps) {
  // 内部选中状态（当没有外部控制时使用）
  const [internalSelectedPath, setInternalSelectedPath] = useState<string | undefined>(
    externalSelectedPath ?? (changes.length > 0 ? changes[0]!.path : undefined)
  );

  // 使用外部传入的选中路径，或回退到内部状态
  const selectedPath = externalSelectedPath ?? internalSelectedPath;

  // 目录展开状态
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const groups = groupByDirectory(changes);
    const dirs = Array.from(groups.keys()).filter((k) => k !== "");
    // 默认展开所有目录
    return new Set(dirs);
  });

  // 文件列表折叠状态
  const [fileListCollapsed, setFileListCollapsed] = useState(defaultCollapsed);

  // 统计信息
  const stats = useMemo(() => {
    const totalFiles = changes.length;
    const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
    const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);
    return { totalFiles, totalAdditions, totalDeletions };
  }, [changes]);

  // 构建目录树
  const directoryTree = useMemo(() => {
    const groups = groupByDirectory(changes);
    return buildDirectoryTree(groups);
  }, [changes]);

  // 找到选中的文件变更
  const selectedChange = useMemo(() => {
    return changes.find((c) => c.path === selectedPath);
  }, [changes, selectedPath]);

  // 切换目录展开/折叠
  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // 处理文件选择
  const handleSelect = (path: string) => {
    if (!externalSelectedPath) {
      setInternalSelectedPath(path);
    }
    onSelect?.(path);
  };

  // 空状态
  if (changes.length === 0) {
    return (
      <div
        className="border border-[var(--border)] rounded-lg bg-[var(--background)]"
        style={{ maxHeight }}
      >
        {showStats && (
          <div className="flex items-center gap-4 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/20">
            <span className="text-sm text-[var(--muted-foreground)]">已修改 0 个文件</span>
          </div>
        )}
        <div className="flex items-center justify-center py-12 text-[var(--muted-foreground)]">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div
      className="border border-[var(--border)] rounded-lg bg-[var(--background)] flex flex-col overflow-hidden"
      style={{ maxHeight }}
    >
      {/* 统计信息栏 */}
      {showStats && (
        <div className="flex items-center gap-4 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/20 shrink-0 flex-wrap">
          <span className="text-sm text-[var(--foreground)]">
            已修改 {stats.totalFiles} 个文件
          </span>
          {stats.totalAdditions > 0 && (
            <span className="text-sm text-green-600 dark:text-green-400">
              +{stats.totalAdditions}
            </span>
          )}
          {stats.totalDeletions > 0 && (
            <span className="text-sm text-red-600 dark:text-red-400">
              -{stats.totalDeletions}
            </span>
          )}
          <button
            onClick={() => setFileListCollapsed(!fileListCollapsed)}
            className="ml-auto text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {fileListCollapsed ? "展开文件列表" : "收起文件列表"}
          </button>
        </div>
      )}

      {/* 主内容区：响应式布局 */}
      <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
        {/* 左侧文件列表 */}
        {!fileListCollapsed && (
          <div className="w-full md:w-72 border-b md:border-b-0 md:border-r border-[var(--border)] overflow-auto shrink-0 md:max-h-full max-h-48">
            <div className="py-1 text-xs select-none">
              <DirectoryItem
                node={directoryTree}
                depth={0}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                selectedPath={selectedPath}
                onSelect={handleSelect}
              />
            </div>
          </div>
        )}

        {/* 右侧 Diff 区域 */}
        <div className="flex-1 overflow-hidden min-h-0">
          <DiffContent change={selectedChange} />
        </div>
      </div>
    </div>
  );
}
