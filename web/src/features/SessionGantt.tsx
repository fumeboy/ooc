/**
 * SessionGantt — Session 级甘特图视图
 *
 * 每行一个参与的 Object，每个块代表一个 focus 事项（ProcessNode）。
 * 块按开始时间排序后分列放置，固定宽度展示 title/summary。
 * 点击块弹出模态卡片，可跳转到对应 Object 的 Process tab。
 *
 * @ref docs/哲学文档/gene.md#G9 — renders — 行为树节点可视化
 */
import { useState, useEffect, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { lastFlowEventAtom, editorTabsAtom, activeFilePathAtom } from "../store/session";
import { fetchFlow } from "../api/client";
import { StatusBadge } from "../components/ui/Badge";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { cn } from "../lib/utils";
import type { FlowData, ProcessNode } from "../api/types";
import { X, ArrowRight } from "lucide-react";

/* ── 数据模型 ── */

/** 甘特图块：对应一个 ProcessNode（focus 事项） */
interface GanttBlock {
  objectName: string;
  nodeId: string;
  title: string;
  summary: string | null;
  status: "todo" | "doing" | "done";
  startTime: number;
  endTime: number | null;
  /** 布局算法计算出的列索引 */
  column: number;
}

/** 每行一个 Object */
interface GanttRow {
  objectName: string;
  flowStatus: string;
  blocks: GanttBlock[];
}

/* ── 状态颜色 ── */

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  done: { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700" },
  doing: { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-700" },
  todo: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-500" },
};

/* ── 从 ProcessNode 递归收集所有非 root 节点 ── */

function collectNodes(node: ProcessNode, objectName: string): GanttBlock[] {
  const blocks: GanttBlock[] = [];

  for (const child of node.children ?? []) {
    const actions = child.actions ?? [];
    const timestamps = actions.map((a) => a.timestamp).filter(Boolean);
    const startTime = timestamps.length > 0 ? Math.min(...timestamps) : 0;
    const endTime = child.status === "doing"
      ? null
      : timestamps.length > 0 ? Math.max(...timestamps) : startTime;

    if (startTime > 0 || child.status !== "todo") {
      blocks.push({
        objectName,
        nodeId: child.id,
        title: child.title,
        summary: child.summary ?? null,
        status: child.status,
        startTime,
        endTime,
        column: 0,
      });
    }

    /* 递归收集子节点 */
    blocks.push(...collectNodes(child, objectName));
  }

  return blocks;
}

/* ── 列布局算法 ── */

function assignColumns(blocks: GanttBlock[]): number {
  if (blocks.length === 0) return 0;

  /* 按开始时间排序 */
  const sorted = [...blocks].sort((a, b) => a.startTime - b.startTime);

  let columnIndex = 0;
  /** 每列中已放置块的最小结束时间 */
  let minEndTime = Infinity;

  for (const block of sorted) {
    /* 第一个块或结束时间未知时，初始化 minEndTime */
    if (minEndTime === Infinity) {
      minEndTime = block.endTime ?? Infinity;
      block.column = columnIndex;
      continue;
    }

    if (block.startTime > minEndTime) {
      columnIndex++;
    }

    block.column = columnIndex;

    const blockEnd = block.endTime ?? Infinity;
    if (blockEnd < minEndTime) {
      minEndTime = blockEnd;
    }
  }

  return columnIndex + 1;
}

/* ── 格式化时间 ── */

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ── 块宽度（固定） ── */
const BLOCK_W = 120;
const BLOCK_H = 40;
const BLOCK_GAP = 4;
const COL_W = BLOCK_W + BLOCK_GAP;
const LABEL_W = 140;

/* ── 主组件 ── */

interface SessionGanttProps {
  sessionId: string;
}

export function SessionGantt({ sessionId }: SessionGanttProps) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<GanttBlock | null>(null);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const setTabs = useSetAtom(editorTabsAtom);
  const setActivePath = useSetAtom(activeFilePathAtom);

  /* 加载 flow 数据 */
  useEffect(() => {
    setFlow(null);
    fetchFlow(sessionId).then(setFlow).catch(console.error);
  }, [sessionId]);

  /* SSE 实时更新 */
  useEffect(() => {
    if (!lastEvent || !("sessionId" in lastEvent)) return;
    if (lastEvent.sessionId === sessionId) {
      fetchFlow(sessionId).then(setFlow).catch(console.error);
    }
  }, [lastEvent, sessionId]);

  /* 构建甘特行数据 */
  const { rows, totalColumns } = useMemo(() => {
    if (!flow) return { rows: [], totalColumns: 0 };

    const allBlocks: GanttBlock[] = [];
    const rowMap = new Map<string, { flowStatus: string }>();

    /* 主 flow */
    const mainBlocks = collectNodes(flow.process.root, flow.stoneName);
    allBlocks.push(...mainBlocks);
    if (mainBlocks.length > 0) {
      rowMap.set(flow.stoneName, { flowStatus: flow.status });
    }

    /* sub-flows */
    for (const sf of flow.subFlows ?? []) {
      if (sf.stoneName === flow.stoneName) continue;
      const blocks = collectNodes(sf.process.root, sf.stoneName);
      allBlocks.push(...blocks);
      if (blocks.length > 0) {
        rowMap.set(sf.stoneName, { flowStatus: sf.status });
      }
    }

    /* 分配列 */
    const totalColumns = assignColumns(allBlocks);

    /* 按 Object 分组 */
    const rows: GanttRow[] = [];
    for (const [objectName, meta] of rowMap) {
      const blocks = allBlocks
        .filter((b) => b.objectName === objectName)
        .sort((a, b) => a.column - b.column || a.startTime - b.startTime);
      rows.push({ objectName, flowStatus: meta.flowStatus, blocks });
    }

    /* 按第一个块的开始时间排序 */
    rows.sort((a, b) => {
      const aMin = a.blocks[0]?.startTime ?? 0;
      const bMin = b.blocks[0]?.startTime ?? 0;
      return aMin - bMin;
    });

    return { rows, totalColumns };
  }, [flow]);

  /* 跳转到 Object 的 Process tab */
  const navigateToProcess = (objectName: string) => {
    const path = `flows/${sessionId}/objects/${objectName}/process.json`;
    setActivePath(path);
    setTabs((prev) => {
      const parentPath = `flows/${sessionId}/objects/${objectName}`;
      const existing = prev.find((t) => t.path.startsWith(parentPath));
      if (existing) {
        return prev.map((t) => t === existing ? { ...t, path } : t);
      }
      return [...prev, { path, label: objectName }];
    });
  };

  if (!flow) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--muted-foreground)] text-sm">
        加载中...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--muted-foreground)] text-sm">
        暂无活动记录
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 sm:px-8 pt-6 sm:pt-10 pb-4">
        <div className="flex items-center gap-3">
          <h2
            className="text-2xl sm:text-3xl font-bold"
            style={{ fontFamily: "var(--heading-font)" }}
          >
            Session Overview
          </h2>
          <StatusBadge status={flow.status} />
        </div>
        <p className="text-[var(--muted-foreground)] mt-1 text-xs font-mono">
          {flow.sessionId.slice(0, 20)}
        </p>
        {flow.title && (
          <p className="text-sm mt-1">{flow.title}</p>
        )}

        {/* 图例 */}
        <div className="flex gap-4 mt-4">
          {Object.entries(STATUS_COLORS).map(([status, colors]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span className={cn("w-3 h-2 rounded-sm border", colors.bg, colors.border)} />
              <span className="text-[10px] text-[var(--muted-foreground)]">{status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 甘特图区域 */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 pb-8">
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.objectName} className="flex items-start gap-0">
              {/* Object 标签 */}
              <div
                className="shrink-0 flex items-center gap-2 px-2 py-2 text-xs"
                style={{ width: LABEL_W }}
              >
                <ObjectAvatar name={row.objectName} size="sm" />
                <div className="min-w-0">
                  <span className="block truncate font-medium">{row.objectName}</span>
                  <span className={cn(
                    "text-[10px]",
                    row.flowStatus === "finished" ? "text-emerald-600"
                      : row.flowStatus === "running" ? "text-amber-600"
                      : row.flowStatus === "failed" ? "text-red-600"
                      : "text-[var(--muted-foreground)]",
                  )}>
                    {row.flowStatus}
                  </span>
                </div>
              </div>

              {/* 块区域 */}
              <div
                className="flex flex-wrap gap-1 py-1"
                style={{ minWidth: totalColumns * COL_W }}
              >
                {row.blocks.map((block) => {
                  const colors = STATUS_COLORS[block.status] ?? STATUS_COLORS.todo!;
                  return (
                    <button
                      key={block.nodeId}
                      onClick={() => setSelectedBlock(block)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-left transition-all hover:shadow-sm hover:scale-[1.02] cursor-pointer",
                        colors.bg, colors.border,
                      )}
                      style={{ width: BLOCK_W, height: BLOCK_H }}
                      title={block.title}
                    >
                      <span className={cn("block text-[11px] font-medium truncate", colors.text)}>
                        {block.title}
                      </span>
                      {block.summary && (
                        <span className="block text-[9px] text-[var(--muted-foreground)] truncate">
                          {block.summary}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 模态卡片 */}
      {selectedBlock && (
        <SummaryModal
          block={selectedBlock}
          onClose={() => setSelectedBlock(null)}
          onNavigate={() => {
            navigateToProcess(selectedBlock.objectName);
            setSelectedBlock(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Summary 模态卡片 ── */

function SummaryModal({
  block,
  onClose,
  onNavigate,
}: {
  block: GanttBlock;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const colors = STATUS_COLORS[block.status] ?? STATUS_COLORS.todo!;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl w-[400px] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            <ObjectAvatar name={block.objectName} size="sm" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{block.title}</h3>
              <span className="text-[10px] text-[var(--muted-foreground)]">{block.objectName}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4 space-y-3">
          {/* 状态 */}
          <div className="flex items-center gap-2">
            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium border", colors.bg, colors.border, colors.text)}>
              {block.status}
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {formatTime(block.startTime)}
              {block.endTime ? ` → ${formatTime(block.endTime)}` : " → 进行中"}
            </span>
          </div>

          {/* Summary */}
          {block.summary ? (
            <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">
              {block.summary}
            </p>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)] italic">
              {block.status === "doing" ? "正在执行中..." : "暂无摘要"}
            </p>
          )}
        </div>

        {/* 底部操作 */}
        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end">
          <button
            onClick={onNavigate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
          >
            查看 Process
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
