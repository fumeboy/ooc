/**
 * JsonTreeViewer — 交互式 JSON 树状查看器
 *
 * 支持展开/折叠、类型颜色区分、路径复制。
 * 用于展示复杂嵌套的 data.json 或对象状态。
 */

import React, { useState, useCallback, useMemo } from "react";
import { cn } from "../../lib/utils";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";

export interface JsonTreeViewerProps {
  /** 要展示的数据 */
  data: unknown;
  /** 默认展开深度，默认 1（仅展开根节点） */
  defaultExpandDepth?: number;
  /** 搜索词（匹配节点高亮） */
  searchTerm?: string;
  /** 节点点击回调，返回节点路径字符串 */
  onSelectPath?: (path: string) => void;
  /** 最大高度，超出后滚动 */
  maxHeight?: string;
  /** 空数据文本 */
  emptyText?: string;
}

/** 类型颜色映射 */
const TYPE_COLORS: Record<string, string> = {
  string: "text-blue-600 dark:text-blue-400",
  number: "text-orange-600 dark:text-orange-400",
  boolean: "text-red-600 dark:text-red-400",
  null: "text-gray-500 dark:text-gray-400",
  object: "text-purple-600 dark:text-purple-400",
  array: "text-purple-600 dark:text-purple-400",
};

/**
 * 构建路径字符串
 * @param parentPath 父路径
 * @param key 当前键名或索引
 */
function buildPath(parentPath: string, key: string | number): string {
  if (typeof key === "number") {
    return `${parentPath}[${key}]`;
  }
  return parentPath ? `${parentPath}.${key}` : key;
}

/** 获取值的类型标签 */
function getTypeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** 获取对象/数组的大小标签 */
function getSizeLabel(value: object): string {
  if (Array.isArray(value)) {
    return `Array[${value.length}]`;
  }
  const keys = Object.keys(value);
  return `Object{${keys.length}}`;
}

/** 检查值是否为可展开的容器（对象或数组且非空） */
function isExpandable(value: unknown): value is object {
  if (value === null) return false;
  if (Array.isArray(value)) return true;
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
}

// 内部递归节点组件
interface JsonNodeProps {
  value: unknown;
  path: string;
  keyName: string | number;
  depth: number;
  maxDepth: number;
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  copiedPath: string | null;
  onCopy: (path: string) => void;
  onSelectPath?: (path: string) => void;
  searchTerm?: string;
  /** 当前路径上已访问的对象（用于循环引用检测） */
  ancestry: object[];
}

function JsonNode({
  value,
  path,
  keyName,
  depth,
  maxDepth,
  expandedPaths,
  toggleExpand,
  copiedPath,
  onCopy,
  onSelectPath,
  searchTerm,
  ancestry,
}: JsonNodeProps) {
  const typeLabel = getTypeLabel(value);
  const colorClass = TYPE_COLORS[typeLabel] || "";
  const isExpanded = expandedPaths.has(path);
  const expandable = isExpandable(value);

  // 检查是否匹配搜索词
  const matchesSearch = useMemo(() => {
    if (!searchTerm) return false;
    const term = searchTerm.toLowerCase();
    const keyStr = String(keyName).toLowerCase();
    if (keyStr.includes(term)) return true;

    // 基本类型值匹配
    if (typeof value === "string") {
      return value.toLowerCase().includes(term);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).toLowerCase().includes(term);
    }
    return false;
  }, [keyName, value, searchTerm]);

  // 渲染键名
  const renderKey = () => {
    if (typeof keyName === "number") {
      return <span className="text-gray-400">{keyName}:</span>;
    }
    return (
      <>
        <span className="text-emerald-700 dark:text-emerald-400">"{keyName}"</span>
        <span className="text-gray-500">:</span>
      </>
    );
  };

  // 渲染基本类型值
  const renderPrimitiveValue = () => {
    if (value === null) {
      return <span className={colorClass}>null</span>;
    }
    if (typeof value === "string") {
      return (
        <span className={colorClass}>
          "{value}"
        </span>
      );
    }
    if (typeof value === "number") {
      return <span className={colorClass}>{value}</span>;
    }
    if (typeof value === "boolean") {
      return <span className={colorClass}>{String(value)}</span>;
    }
    if (typeof value === "undefined") {
      return <span className="text-gray-500 italic">undefined</span>;
    }
    return null;
  };

  // 处理点击复制
  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (path) {
        onCopy(path);
        onSelectPath?.(path);
      }
    },
    [path, onCopy, onSelectPath]
  );

  // 处理展开/折叠
  const handleToggleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (expandable) {
        toggleExpand(path);
      }
    },
    [expandable, path, toggleExpand]
  );

  // 检查循环引用（当前路径上已存在该对象）
  const isCyclic = expandable && ancestry.includes(value as object);

  // 获取子项（处理空对象/数组和循环引用）
  const children: Array<{ key: string | number; value: unknown }> = useMemo(() => {
    if (!expandable || isCyclic) return [];
    if (Array.isArray(value)) {
      return value.map((v, i) => ({ key: i, value: v }));
    }
    return Object.entries(value).map(([k, v]) => ({ key: k, value: v }));
  }, [value, expandable, isCyclic]);

  const isCopied = copiedPath === path;

  return (
    <div>
      {/* 当前行 */}
      <div
        className={cn(
          "group flex items-center gap-1 py-0.5 px-1.5 rounded cursor-pointer transition-colors",
          "hover:bg-[var(--accent)]",
          matchesSearch && "bg-yellow-100 dark:bg-yellow-900/30"
        )}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        onClick={handleRowClick}
      >
        {/* 展开/折叠箭头 */}
        {expandable && !isCyclic ? (
          <button
            onClick={handleToggleExpand}
            className="flex items-center justify-center w-3 h-3 shrink-0 hover:text-[var(--foreground)]"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[var(--muted-foreground)]" />
            )}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* 键名 */}
        {depth > 0 && renderKey()}

        {/* 值 */}
        {expandable ? (
          <span className="flex items-center gap-1">
            <span className={colorClass}>
              {isCyclic ? (
                <span className="italic text-gray-500">[Circular]</span>
              ) : (
                <>{!isExpanded && getSizeLabel(value)}</>
              )}
            </span>
            {/* 折叠状态显示预览 */}
            {!isExpanded && !isCyclic && children.length > 0 && (
              <span className="text-[var(--muted-foreground)] text-[10px] ml-1">
                {Array.isArray(value) ? "[" : "{"}
                {children.length > 3
                  ? "..."
                  : children
                      .map((c) => {
                        const t = getTypeLabel(c.value);
                        if (t === "string") return `"...`;
                        if (t === "number") return "0";
                        if (t === "boolean") return "false";
                        if (t === "null") return "null";
                        return t === "array" ? "[...]" : "{...}";
                      })
                      .join(", ")}
                {Array.isArray(value) ? "]" : "}"}
              </span>
            )}
          </span>
        ) : (
          renderPrimitiveValue()
        )}

        {/* 复制按钮 - 悬停显示 */}
        {path && (
          <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {isCopied ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-[10px] text-emerald-500">已复制</span>
              </>
            ) : (
              <Copy className="w-3 h-3 text-[var(--muted-foreground)]" />
            )}
          </span>
        )}
      </div>

      {/* 子节点 */}
      {expandable && isExpanded && !isCyclic && children.length > 0 && (
        <div>
          {children.map((child) => {
            const childPath = buildPath(path, child.key);
            // 为子节点创建新的祖先链（添加当前对象）
            const childAncestry = [...ancestry, value as object];

            return (
              <JsonNode
                key={childPath}
                value={child.value}
                path={childPath}
                keyName={child.key}
                depth={depth + 1}
                maxDepth={maxDepth}
                expandedPaths={expandedPaths}
                toggleExpand={toggleExpand}
                copiedPath={copiedPath}
                onCopy={onCopy}
                onSelectPath={onSelectPath}
                searchTerm={searchTerm}
                ancestry={childAncestry}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 根据默认展开深度，收集需要展开的路径集合
 */
function collectInitialExpandedPaths(
  value: unknown,
  path: string,
  depth: number,
  maxDepth: number,
  visited: object[]
): string[] {
  if (depth >= maxDepth) return [];
  if (!isExpandable(value)) return [];
  if (visited.includes(value)) return [];

  const result: string[] = [path];
  const newVisited = [...visited, value];

  const children = Array.isArray(value)
    ? value.map((v, i) => ({ key: i, value: v }))
    : Object.entries(value).map(([k, v]) => ({ key: k, value: v }));

  for (const child of children) {
    const childPath = buildPath(path, child.key);
    result.push(...collectInitialExpandedPaths(child.value, childPath, depth + 1, maxDepth, newVisited));
  }

  return result;
}

export function JsonTreeViewer({
  data,
  defaultExpandDepth = 1,
  searchTerm,
  onSelectPath,
  maxHeight,
  emptyText = "暂无数据",
}: JsonTreeViewerProps) {
  // 展开状态
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    if (defaultExpandDepth <= 0) return new Set();
    const initial = collectInitialExpandedPaths(data, "", 0, defaultExpandDepth, []);
    return new Set(initial);
  });

  // 复制状态
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleCopy = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    } catch {
      // 忽略剪贴板错误
    }
  }, []);

  // 容器样式
  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      maxHeight,
      overflow: "auto",
    }),
    [maxHeight]
  );

  // 空数据处理
  if (data === undefined) {
    return (
      <div className="py-4 text-center text-[var(--muted-foreground)]">
        {emptyText}
      </div>
    );
  }

  // null 作为有效值展示（区别于 undefined 空数据）
  if (data === null) {
    return (
      <div style={containerStyle} className="json-tree-viewer font-mono text-xs">
        <JsonNode
          value={null}
          path=""
          keyName=""
          depth={0}
          maxDepth={defaultExpandDepth}
          expandedPaths={expandedPaths}
          toggleExpand={toggleExpand}
          copiedPath={copiedPath}
          onCopy={handleCopy}
          onSelectPath={onSelectPath}
          searchTerm={searchTerm}
          ancestry={[]}
        />
      </div>
    );
  }

  return (
    <div style={containerStyle} className="json-tree-viewer font-mono text-xs">
      <JsonNode
        value={data}
        path=""
        keyName=""
        depth={0}
        maxDepth={defaultExpandDepth}
        expandedPaths={expandedPaths}
        toggleExpand={toggleExpand}
        copiedPath={copiedPath}
        onCopy={handleCopy}
        onSelectPath={onSelectPath}
        searchTerm={searchTerm}
        ancestry={[]}
      />
    </div>
  );
}
