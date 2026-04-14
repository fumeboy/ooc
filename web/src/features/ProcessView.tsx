/**
 * ProcessView —— 行为树可视化组件
 *
 * 左栏：单栏时间线 —— 显示从 root 到 focus 节点的路径，每个节点用 NodeCard 展示。
 * 其中 thinking action 表示模型原生 thinking 的持久化结果，text 表示 LLM 文本输出，tool_use 表示工具调用。
 * 右栏：MiniTree 节点树缩略视图
 */
import { useState } from "react";
import { cn } from "../lib/utils";
import { NodeCard } from "../components/ui/NodeCard";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Process, ProcessNode } from "../api/types";

interface ProcessViewProps {
  process: Process;
}

/** 从根节点找到目标节点的路径（含自身） */
export function findPath(node: ProcessNode, targetId: string): ProcessNode[] | null {
  if (node.id === targetId) return [node];
  for (const child of node.children) {
    const path = findPath(child, targetId);
    if (path) return [node, ...path];
  }
  return null;
}

/** 找到默认选中节点：focusId 或第一个 doing 节点 */
function findDefaultId(root: ProcessNode, focusId: string): string {
  if (focusId) return focusId;
  const queue = [root];
  while (queue.length) {
    const n = queue.shift()!;
    if (n.status === "doing") return n.id;
    queue.push(...n.children);
  }
  return root.id;
}

/** 构建聚焦路径 */
function buildFocusPath(
  node: ProcessNode,
  focusId: string,
  path: ProcessNode[] = []
): ProcessNode[] | null {
  const newPath = [...path, node];
  if (node.id === focusId) return newPath;

  for (const child of node.children) {
    const result = buildFocusPath(child, focusId, newPath);
    if (result) return result;
  }
  return null;
}

export function ProcessView({ process }: ProcessViewProps) {
  const [selectedId, setSelectedId] = useState<string>(() =>
    process?.root ? findDefaultId(process.root, process.focusId) : "",
  );

  if (!process?.root) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-[var(--muted-foreground)]">No process data</p>
      </div>
    );
  }

  // 构建聚焦路径
  const focusPath = buildFocusPath(process.root, process.focusId) || [process.root];

  return (
    <div className="flex gap-0 h-full">
      {/* 主时间线区域 */}
      <div className="flex-1 min-w-0 overflow-auto pr-4">
        {focusPath.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-xs text-[var(--muted-foreground)]">No nodes</p>
          </div>
        ) : (
          <div className="space-y-4 pt-4">
            {focusPath.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                isFocus={node.id === process.focusId}
                defaultExpanded={node.id === process.focusId}
              />
            ))}
          </div>
        )}
      </div>

      {/* 右栏：MiniTree 节点树缩略视图 */}
      <aside className="w-56 shrink-0 border-l border-[var(--border)] pl-4 overflow-auto">
        <h4 className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2 pt-4">
          Nodes
        </h4>
        <MiniTree
          node={process.root}
          focusId={process.focusId}
          selectedId={selectedId}
          onSelect={setSelectedId}
          depth={0}
        />
      </aside>
    </div>
  );
}

/* ── 缩略节点树 ── */

export function MiniTree({
  node, focusId, selectedId, onSelect, depth,
}: {
  node: ProcessNode;
  focusId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  depth: number;
}) {
  // 过滤掉内联节点，不独立显示
  const visibleChildren = node.children.filter(c => !c.type || c.type === "frame");
  const hasInlineChildren = node.children.some(c => c.type && c.type !== "frame");

  const hasChildren = visibleChildren.length > 0;
  const [expanded, setExpanded] = useState(
    node.status === "doing" || node.id === focusId || depth < 2,
  );
  const isSelected = node.id === selectedId;
  const isFocus = node.id === focusId;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 px-2 rounded text-xs cursor-pointer transition-colors",
          isSelected && "bg-[var(--accent)] font-medium",
          !isSelected && "hover:bg-[var(--accent)]/40",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 text-[var(--muted-foreground)]"
          >
            {expanded
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRight className="w-3 h-3" />
            }
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className={cn(
          "w-2 h-2 rounded-full shrink-0",
          node.status === "done" ? "bg-green-500" : node.status === "doing" ? "bg-[var(--warm)]" : "bg-[var(--muted-foreground)] opacity-40",
        )} />
        <span className={cn(
          "truncate flex-1",
          node.status === "done" && "text-[var(--muted-foreground)]",
        )}>
          {node.title}
          {hasInlineChildren && (
            <span className="ml-1 text-amber-500 text-[10px]">+inline</span>
          )}
        </span>
        {isFocus && (
          <span className="text-[10px] text-[var(--warm)] shrink-0">(focus-on)</span>
        )}
        {node.actions.length > 0 && (
          <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">
            {node.actions.length}
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {visibleChildren.map((child) => (
            <MiniTree
              key={child.id}
              node={child}
              focusId={focusId}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
