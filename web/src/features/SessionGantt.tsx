/**
 * SessionGantt — Session 级甘特图视图
 *
 * 横轴：时间线（session 的 createdAt → updatedAt）
 * 纵轴：每行一个参与的 Object
 * 条形：该 Object 的 actions，按 timestamp 排列，颜色按 action type 区分
 *
 * 点击条形跳转到对应 Object 的 FlowView。
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { lastFlowEventAtom, editorTabsAtom, activeFilePathAtom } from "../store/session";
import { fetchFlow } from "../api/client";
import { StatusBadge } from "../components/ui/Badge";
import { cn } from "../lib/utils";
import type { FlowData, Action, ProcessNode } from "../api/types";

/** action type → 条形颜色 */
const ACTION_COLORS: Record<string, string> = {
  thought: "#d97706",
  program: "#2563eb",
  inject: "#ea580c",
  message_in: "#16a34a",
  message_out: "#0d9488",
  pause: "#9ca3af",
};
const DEFAULT_COLOR = "#6b7280";

/** 从 process tree 递归收集所有 actions */
function collectActions(node: ProcessNode): Action[] {
  const actions: Action[] = [...(node.actions ?? [])];
  for (const child of node.children ?? []) {
    actions.push(...collectActions(child));
  }
  return actions;
}

/** 每个 Object 的甘特行数据 */
interface GanttRow {
  objectName: string;
  status: string;
  actions: Action[];
  minTime: number;
  maxTime: number;
}

interface SessionGanttProps {
  sessionId: string;
}

export function SessionGantt({ sessionId }: SessionGanttProps) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const setTabs = useSetAtom(editorTabsAtom);
  const setActivePath = useSetAtom(activeFilePathAtom);
  const containerRef = useRef<HTMLDivElement>(null);

  /* 加载 flow 数据 */
  useEffect(() => {
    setFlow(null);
    fetchFlow(sessionId).then(setFlow).catch(console.error);
  }, [sessionId]);

  /* SSE 实时更新 */
  useEffect(() => {
    if (!lastEvent || !("taskId" in lastEvent)) return;
    if (lastEvent.taskId === sessionId) {
      fetchFlow(sessionId).then(setFlow).catch(console.error);
    }
  }, [lastEvent, sessionId]);

  /* 构建甘特行数据 */
  const { rows, globalMin, globalMax } = useMemo(() => {
    if (!flow) return { rows: [], globalMin: 0, globalMax: 0 };

    const rowMap = new Map<string, GanttRow>();

    /* 主 flow */
    const mainActions = collectActions(flow.process.root);
    if (mainActions.length > 0) {
      rowMap.set(flow.stoneName, {
        objectName: flow.stoneName,
        status: flow.status,
        actions: mainActions,
        minTime: Math.min(...mainActions.map((a) => a.timestamp)),
        maxTime: Math.max(...mainActions.map((a) => a.timestamp)),
      });
    }

    /* sub-flows */
    for (const sf of flow.subFlows ?? []) {
      if (sf.stoneName === flow.stoneName) continue;
      const actions = collectActions(sf.process.root);
      if (actions.length > 0) {
        rowMap.set(sf.stoneName, {
          objectName: sf.stoneName,
          status: sf.status,
          actions,
          minTime: Math.min(...actions.map((a) => a.timestamp)),
          maxTime: Math.max(...actions.map((a) => a.timestamp)),
        });
      }
    }

    const rows = Array.from(rowMap.values()).sort((a, b) => a.minTime - b.minTime);
    const allTimes = rows.flatMap((r) => [r.minTime, r.maxTime]);
    const globalMin = allTimes.length > 0 ? Math.min(...allTimes) : 0;
    const globalMax = allTimes.length > 0 ? Math.max(...allTimes) : 0;

    return { rows, globalMin, globalMax };
  }, [flow]);

  /* 点击 action → 跳转到对应 FlowView */
  const navigateToFlow = (objectName: string) => {
    const path = `flows/${sessionId}/flows/${objectName}`;
    setActivePath(path);
    setTabs((prev) => {
      if (prev.some((t) => t.path.startsWith(`flows/${sessionId}/flows/${objectName}`))) {
        return prev.map((t) =>
          t.path.startsWith(`flows/${sessionId}/flows/${objectName}`)
            ? { ...t, path }
            : t,
        );
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

  const timeSpan = globalMax - globalMin || 1;
  /* 给两端留 5% 的 padding */
  const padded = timeSpan * 0.05;
  const tMin = globalMin - padded;
  const tMax = globalMax + padded;
  const tSpan = tMax - tMin;

  /* 时间轴刻度 */
  const ticks = generateTicks(globalMin, globalMax, 6);

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
          {flow.taskId.slice(0, 20)}
        </p>
        {flow.title && (
          <p className="text-sm mt-1">{flow.title}</p>
        )}

        {/* 图例 */}
        <div className="flex flex-wrap gap-3 mt-4">
          {Object.entries(ACTION_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="w-3 h-2 rounded-sm"
                style={{ backgroundColor: color }}
              />
              <span className="text-[10px] text-[var(--muted-foreground)]">{type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 甘特图区域 */}
      <div ref={containerRef} className="flex-1 overflow-auto px-4 sm:px-8 pb-8">
        {/* 时间轴刻度 */}
        <div className="flex ml-[120px] sm:ml-[160px] mb-1 relative h-5">
          {ticks.map((t) => {
            const left = ((t - tMin) / tSpan) * 100;
            return (
              <span
                key={t}
                className="absolute text-[10px] text-[var(--muted-foreground)] -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${left}%` }}
              >
                {formatTime(t)}
              </span>
            );
          })}
        </div>

        {/* 行 */}
        <div className="space-y-1">
          {rows.map((row) => (
            <GanttRowView
              key={row.objectName}
              row={row}
              tMin={tMin}
              tSpan={tSpan}
              onClick={() => navigateToFlow(row.objectName)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 单行甘特图 */
function GanttRowView({
  row,
  tMin,
  tSpan,
  onClick,
}: {
  row: GanttRow;
  tMin: number;
  tSpan: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState<Action | null>(null);

  return (
    <div className="flex items-center gap-0 group">
      {/* Object 名称 */}
      <button
        onClick={onClick}
        className="w-[120px] sm:w-[160px] shrink-0 text-left text-xs truncate px-2 py-2 rounded-l-lg hover:bg-[var(--accent)]/60 transition-colors flex items-center gap-2"
      >
        <span className={cn(
          "w-2 h-2 rounded-full shrink-0",
          row.status === "finished" ? "bg-green-500"
            : row.status === "running" ? "bg-[var(--warm)]"
            : row.status === "failed" ? "bg-red-500"
            : "bg-[var(--muted-foreground)] opacity-40",
        )} />
        <span className="truncate">{row.objectName}</span>
        <span className="text-[10px] text-[var(--muted-foreground)] ml-auto shrink-0">
          {row.actions.length}
        </span>
      </button>

      {/* 甘特条形区域 */}
      <div
        className="flex-1 relative h-8 bg-[var(--accent)]/20 rounded-r-lg border-l border-[var(--border)]"
      >
        {row.actions.map((action, i) => {
          const left = ((action.timestamp - tMin) / tSpan) * 100;
          const color = ACTION_COLORS[action.type] ?? DEFAULT_COLOR;
          /* 条形宽度：用一个最小宽度，避免太窄看不见 */
          const minWidthPx = 4;

          return (
            <div
              key={i}
              className="absolute top-1 bottom-1 rounded-sm cursor-pointer transition-opacity hover:opacity-80"
              style={{
                left: `${left}%`,
                minWidth: `${minWidthPx}px`,
                width: `${minWidthPx}px`,
                backgroundColor: color,
              }}
              title={`${action.type} @ ${formatTime(action.timestamp)}${action.content ? "\n" + action.content.slice(0, 80) : ""}`}
              onMouseEnter={() => setHovered(action)}
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => { e.stopPropagation(); onClick(); }}
            />
          );
        })}

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute z-20 top-full mt-1 left-1/2 -translate-x-1/2 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-xs max-w-[300px] pointer-events-none">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ backgroundColor: ACTION_COLORS[hovered.type] ?? DEFAULT_COLOR }}
              />
              <span className="font-medium">{hovered.type}</span>
              <span className="text-[var(--muted-foreground)] ml-auto">{formatTime(hovered.timestamp)}</span>
            </div>
            {hovered.content && (
              <p className="text-[var(--muted-foreground)] line-clamp-3 whitespace-pre-wrap">
                {hovered.content.slice(0, 200)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 生成时间轴刻度 */
function generateTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

/** 格式化时间戳为 HH:MM:SS */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
