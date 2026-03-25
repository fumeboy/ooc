/**
 * ProcessView —— 行为树可视化组件
 *
 * 左栏：选中节点的 actions 时间线（含 parent 链）
 * 右栏：节点树缩略视图（仅标题，可点击切换）
 */
import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { ActionCard } from "../components/ui/ActionCard";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Process, ProcessNode } from "../api/types";

interface ProcessViewProps {
  process: Process;
}

/** 从根节点找到目标节点的路径（含自身） */
function findPath(node: ProcessNode, targetId: string): ProcessNode[] | null {
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

export function ProcessView({ process }: ProcessViewProps) {
  const [selectedId, setSelectedId] = useState<string>(() =>
    process?.root ? findDefaultId(process.root, process.focusId) : "",
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);

  if (!process?.root) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-[var(--muted-foreground)]">No process data</p>
      </div>
    );
  }

  /* 收集 path 上所有节点的 actions */
  const path = findPath(process.root, selectedId) || [process.root];
  const actionGroups = path
    .filter((n) => n.actions.length > 0)
    .map((n) => ({ node: n, actions: n.actions, isCurrent: n.id === selectedId }));

  /* 自动滚动到当前节点的第一个 action */
  useEffect(() => {
    setTimeout(() => {
      markerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, [selectedId]);

  return (
    <div className="flex gap-0 h-full">
      {/* 左栏：Actions 时间线 */}
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-auto pr-4">
        {actionGroups.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-xs text-[var(--muted-foreground)]">No actions recorded</p>
          </div>
        ) : (
          <div className="space-y-4">
            {actionGroups.map((group) => (
              <div key={group.node.id}>
                {/* 节点标题 */}
                <div
                  ref={group.isCurrent ? markerRef : undefined}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg text-xs mb-2 sticky top-0 z-10"
                >
                  <span className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    group.node.status === "done" ? "bg-green-500" : group.node.status === "doing" ? "bg-[var(--warm)]" : "bg-[var(--muted-foreground)] opacity-40",
                  )} />
                  <span className={cn("truncate", group.isCurrent && "font-medium")}>{group.node.title}</span>
                  {group.node.id === process.focusId && (
                    <span className="text-[10px] text-[var(--warm)] shrink-0">(focus-on)</span>
                  )}
                  <span className="ml-auto text-[10px] text-[var(--muted-foreground)] shrink-0">
                    {group.actions.length} {group.actions.length === 1 ? "action" : "actions"}
                  </span>
                </div>

                {/* Actions */}
                <div className="space-y-3 ml-1 border-l-2 border-[var(--border)] pl-3">
                  {group.actions.map((action, i) => (
                    <ActionCard key={i} action={action} maxHeight={240} />
                  ))}
                  {/* Node Summary */}
                  {group.node.summary && (
                    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--accent)]/30 px-3 py-2 text-xs text-[var(--muted-foreground)]">
                      <p className="text-[10px] font-medium uppercase tracking-wide mb-1 opacity-60">Summary</p>
                      <p className="leading-relaxed whitespace-pre-wrap">{group.node.summary}</p>
                    </div>
                  )}
                  {/* 末尾加一个空白块占据高度 */}
                  <div className="p-32" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右栏：节点树缩略视图 */}
      <aside className="w-56 shrink-0 border-l border-[var(--border)] pl-4 overflow-auto">
        <h4 className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2">
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
  const hasChildren = node.children.length > 0;
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
          {node.children.map((child) => (
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
