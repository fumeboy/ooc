/**
 * LoopTimeline — Loop Time Machine 主组件.
 *
 * 从旧的"纵向 N 个 LoopEntry"升级为时光机式"单 loop 视图 + 左右切换 + Window Diff"：
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ Loop Time Machine                                       Refresh│
 *   │ ────────────────────────────────────────────────────────────── │
 *   │ ◯─◯─●─◯─◯─◯ ...                          (LoopMiniTimeline)   │
 *   │ ────────────────────────────────────────────────────────────── │
 *   │ [← Prev]  #0023 of 50  [Next →]  [⏭ Latest]  (LoopNavigator)  │
 *   │ 12:34:56 · 1.2s · 8 msg · 3 tools                              │
 *   │ ────────────────────────────────────────────────────────────── │
 *   │ Windows (vs Loop #0022)                       (LoopDiffView)   │
 *   │   🆕 talk_window  w_1   summary…              added             │
 *   │   ✏️ plan_window  w_2   refactor              changed           │
 *   │   ·  do_window    w_3   plan1                 unchanged         │
 *   │ ────────────────────────────────────────────────────────────── │
 *   │ Key events in this loop                       (KeyEventsBar)   │
 *   │   ⏸️ permission_ask · 🗜️ context_compressed                     │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * 数据 fetch：
 *   - runtimeListLoops → 全部 loop meta + windowsSnapshot（E2 数据；不存在时 UI 退化）
 *   - thread 端点 → events 列表（用于底部 KeyEventsBar + 退化模式时间序列）
 *   - 切 loop 不重新 fetch list；按需 fetch 单个 loop 的 input/output 由 LoopDiffView 处理
 *
 * URL：`?loop=N` 表示当前查看的 loopIndex；不传 = Latest。
 *
 * 退化模式：debug 未启用 / loops 为空 → 顶部 banner + 一键启用 + 显示 events 时间序列。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { RefreshCw, Power } from "lucide-react";
import { endpoints } from "../../../transport/endpoints";
import { requestJson } from "../../../transport/http";
import { LoopEventBadge, isKeyEvent, type LoopEvent } from "./LoopEventBadge";
import { LoopActionPopover, type LoopActionPopoverMode } from "./LoopActionPopover";
import { LoopNavigator, planNavigate } from "./LoopNavigator";
import { LoopMiniTimeline } from "./LoopMiniTimeline";
import { LoopDiffView } from "./LoopDiffView";
import type { LoopListEntry } from "./loop-types";
import { parseRoute, toPath } from "../../../app/routing";

// Re-export so callers (其它组件 / 老代码) 仍可 import LoopListEntry / LoopMeta from
// "./LoopTimeline"。原 LoopEntry.tsx 已废弃。
export type { LoopListEntry, LoopMeta } from "./loop-types";

export interface LoopTimelineProps {
  sessionId: string;
  objectId: string;
  threadId: string;
  /** 测试注入点。 */
  fetcher?: typeof requestJson;
}

interface ListLoopsResponse {
  loops: LoopListEntry[];
}

interface ThreadResponse {
  id: string;
  events?: LoopEvent[];
  status?: string;
}

interface EnableDebugResponse {
  enabled?: boolean;
  [k: string]: unknown;
}

/**
 * partitionEventsByLoop —— 把 thread.events 按时间戳启发地分配到 loops。
 *
 * 简单等分实现：events 没有 createdAt 字段，只能按数组顺序在 loops 间等分。
 * 单测覆盖 4 个 case。
 */
export function partitionEventsByLoop(
  loops: LoopListEntry[],
  events: LoopEvent[],
): { perLoop: Map<number, LoopEvent[]>; unassigned: LoopEvent[] } {
  const perLoop = new Map<number, LoopEvent[]>();
  for (const l of loops) perLoop.set(l.loopIndex, []);

  if (loops.length === 0 || events.length === 0) {
    return { perLoop, unassigned: [] };
  }

  const sortedLoops = [...loops].sort((a, b) => a.loopIndex - b.loopIndex);
  const perLoopSize = Math.floor(events.length / sortedLoops.length);
  let cursor = 0;
  for (let i = 0; i < sortedLoops.length; i++) {
    const isLast = i === sortedLoops.length - 1;
    const end = isLast ? events.length : cursor + perLoopSize;
    const slice = events.slice(cursor, end);
    perLoop.set(sortedLoops[i].loopIndex, slice);
    cursor = end;
  }
  return { perLoop, unassigned: [] };
}

/**
 * 单击 badge → 决定下一步动作（permission popover / summary popover / scroll）。
 * 时光机模式下 "scroll" 退化为 "切到该 loop"（如果还知道该 event 属于哪个 loop）。
 */
export type BadgeClickAction =
  | { type: "open-permission"; event: LoopEvent }
  | { type: "open-summary"; event: LoopEvent }
  | { type: "scroll"; event: LoopEvent };

export function planBadgeClickAction(event: LoopEvent): BadgeClickAction {
  const isPermissionAsk =
    event.category === "permission" && event.kind === "permission_ask";
  if (isPermissionAsk && !event.decided) {
    return { type: "open-permission", event };
  }
  if (event.category === "context_change" && event.kind === "events_summary") {
    return { type: "open-summary", event };
  }
  return { type: "scroll", event };
}

/**
 * 给单个 ProcessEvent 派生稳定 anchor id。
 *
 * 优先级：event.id → toolCallId → loop_idx fallback。本函数原在 LoopEntry.tsx 内，
 * LoopEntry 已废弃 → 搬到 LoopTimeline 让既有测试仍可 import（test 文件改为
 * 从 ./LoopTimeline import）。
 */
export function loopEventAnchorId(
  event: LoopEvent,
  loopIndex: number,
  idxInLoop: number,
): string {
  const id = typeof event.id === "string" ? event.id : undefined;
  if (id) return `loop-event-${id}`;
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
  if (toolCallId) return `loop-event-${toolCallId}`;
  return `loop-event-loop${loopIndex}-${idxInLoop}`;
}

export function buildDecideBody(
  event: LoopEvent,
  args: { action: "approve" | "reject"; reason?: string },
): Record<string, unknown> {
  const explicitId = typeof event.id === "string" ? event.id : undefined;
  const fallbackId =
    typeof event.toolCallId === "string" ? `${event.toolCallId}_ask` : undefined;
  const eventId = explicitId ?? fallbackId;
  const body: Record<string, unknown> = { action: args.action };
  if (eventId) body.eventId = eventId;
  if (args.reason !== undefined && args.reason !== "") body.reason = args.reason;
  return body;
}

export async function executeDecide(args: {
  fetcher: typeof requestJson;
  sessionId: string;
  objectId: string;
  threadId: string;
  event: LoopEvent;
  decision: { action: "approve" | "reject"; reason?: string };
}): Promise<void> {
  const body = buildDecideBody(args.event, args.decision);
  await args.fetcher<{ ok?: boolean }>(
    endpoints.runtimeDecidePermission(args.sessionId, args.objectId, args.threadId),
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function LoopTimeline({ sessionId, objectId, threadId, fetcher }: LoopTimelineProps) {
  const req = fetcher ?? requestJson;
  const navigate = useNavigate();
  const location = useLocation();

  const [loops, setLoops] = useState<LoopListEntry[] | undefined>(undefined);
  const [thread, setThread] = useState<ThreadResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [enablingDebug, setEnablingDebug] = useState(false);
  const [debugToggleError, setDebugToggleError] = useState<string | undefined>(undefined);
  const [popoverState, setPopoverState] = useState<
    | { mode: LoopActionPopoverMode; event: LoopEvent }
    | undefined
  >(undefined);

  // 从 URL 读取当前 loop（不传 → undefined → Latest）。
  const routeState = useMemo(
    () => parseRoute(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const urlLoop = routeState.kind === "flowsView" ? routeState.loop : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [loopsRes, threadRes] = await Promise.all([
        req<ListLoopsResponse>(endpoints.runtimeListLoops(sessionId, objectId, threadId)),
        req<ThreadResponse>(endpoints.thread(sessionId, objectId, threadId)),
      ]);
      setLoops(Array.isArray(loopsRes?.loops) ? loopsRes.loops : []);
      setThread(threadRes ?? { id: threadId });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [req, sessionId, objectId, threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loopsList = loops ?? [];
  const events = (thread?.events ?? []) as LoopEvent[];
  const debugDisabled = loopsList.length === 0;

  // 当前查看的 loopIndex：URL 显式 → 用；否则 Latest（max loopIndex）。
  const sortedLoops = useMemo(
    () => [...loopsList].sort((a, b) => a.loopIndex - b.loopIndex),
    [loopsList],
  );
  const latestLoopIndex = sortedLoops.length > 0
    ? sortedLoops[sortedLoops.length - 1]!.loopIndex
    : undefined;
  const currentLoopIndex = (() => {
    if (typeof urlLoop === "number" && sortedLoops.some((l) => l.loopIndex === urlLoop)) {
      return urlLoop;
    }
    return latestLoopIndex;
  })();

  // 写 URL —— 切 loop / Prev / Next / Latest 都走这里。
  const selectLoop = useCallback(
    (loopIndex: number) => {
      if (routeState.kind !== "flowsView") return;
      // Latest 等价于不传（保持 URL 精简）
      const isLatest = loopIndex === latestLoopIndex;
      const nextState = isLatest
        ? { ...routeState, loop: undefined }
        : { ...routeState, loop: loopIndex };
      navigate(toPath(nextState), { replace: true });
    },
    [navigate, routeState, latestLoopIndex],
  );

  // 键盘 ←/→
  useEffect(() => {
    if (debugDisabled || currentLoopIndex === undefined) return;
    const handler = (e: KeyboardEvent) => {
      // 忽略 input / textarea / contenteditable focus 时的按键
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        const next = planNavigate(sortedLoops, currentLoopIndex, "prev");
        if (next !== undefined) {
          e.preventDefault();
          selectLoop(next);
        }
      } else if (e.key === "ArrowRight") {
        const next = planNavigate(sortedLoops, currentLoopIndex, "next");
        if (next !== undefined) {
          e.preventDefault();
          selectLoop(next);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [debugDisabled, currentLoopIndex, sortedLoops, selectLoop]);

  // 算每个 loop 的关键 event 数（mini timeline 角标 + KeyEventsBar）
  const { perLoop } = useMemo(
    () => partitionEventsByLoop(loopsList, events),
    [loopsList, events],
  );
  const perLoopKeyEventCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const [idx, evts] of perLoop.entries()) {
      m.set(idx, evts.filter(isKeyEvent).length);
    }
    return m;
  }, [perLoop]);

  const currentLoopKeyEvents = useMemo(() => {
    if (currentLoopIndex === undefined) return [];
    return (perLoop.get(currentLoopIndex) ?? []).filter(isKeyEvent);
  }, [perLoop, currentLoopIndex]);

  const currentEntry = sortedLoops.find((l) => l.loopIndex === currentLoopIndex);
  const previousEntry = (() => {
    if (!currentEntry) return undefined;
    for (let i = sortedLoops.length - 1; i >= 0; i--) {
      if (sortedLoops[i]!.loopIndex < currentEntry.loopIndex) return sortedLoops[i]!;
    }
    return undefined;
  })();

  const handleBadgeClick = useCallback(
    (event: LoopEvent, ownerLoopIndex: number | undefined, _anchorId: string) => {
      const action = planBadgeClickAction(event);
      if (action.type === "open-permission") {
        setPopoverState({ mode: "permission", event });
        return;
      }
      if (action.type === "open-summary") {
        setPopoverState({ mode: "summary", event });
        return;
      }
      // scroll: 时光机里 "scroll" 退化为 "切到该 event 所属 loop"
      if (typeof ownerLoopIndex === "number" && ownerLoopIndex !== currentLoopIndex) {
        selectLoop(ownerLoopIndex);
      }
    },
    [currentLoopIndex, selectLoop],
  );

  const handleDecide = useCallback(
    async (
      event: LoopEvent,
      args: { action: "approve" | "reject"; reason?: string },
    ) => {
      await executeDecide({
        fetcher: req,
        sessionId,
        objectId,
        threadId,
        event,
        decision: args,
      });
      setPopoverState(undefined);
      await load();
    },
    [req, sessionId, objectId, threadId, load],
  );

  const handleEnableDebug = useCallback(async () => {
    setEnablingDebug(true);
    setDebugToggleError(undefined);
    try {
      await req<EnableDebugResponse>(endpoints.runtimeDebugEnable, { method: "POST" });
    } catch (e: unknown) {
      setDebugToggleError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnablingDebug(false);
    }
  }, [req]);

  if (loading && !loops && !thread) {
    return (
      <div className="loop-timeline">
        <div className="loop-timeline-header">
          <div className="loop-timeline-title">Loop Time Machine</div>
          <div className="muted small">loading…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loop-timeline">
        <div className="loop-timeline-header">
          <div className="loop-timeline-title">Loop Time Machine</div>
          <button type="button" className="btn small" onClick={() => void load()} title="Retry">
            <RefreshCw size={11} style={{ marginRight: 4 }} />
            Retry
          </button>
        </div>
        <div className="error" role="alert">
          加载 Loop Timeline 失败: {error}
        </div>
      </div>
    );
  }

  const hasAnyData = loopsList.length > 0 || events.length > 0;

  // 空态: 既无 loop 也无 events
  if (!hasAnyData) {
    return (
      <div className="loop-timeline">
        <div className="loop-timeline-header">
          <div className="loop-timeline-title">Loop Time Machine</div>
          <button type="button" className="btn small" onClick={() => void load()} title="Refresh">
            <RefreshCw size={11} style={{ marginRight: 4 }} />
            Refresh
          </button>
        </div>
        <div className="loop-timeline-empty" data-testid="loop-timeline-empty">
          暂无数据 — 该 thread 尚未产生事件 / loop 调试文件。
        </div>
      </div>
    );
  }

  // 退化模式: loops 空 + events 非空（debug 未启用 / 老 thread）
  if (debugDisabled) {
    return (
      <div className="loop-timeline">
        <div className="loop-timeline-header">
          <div className="loop-timeline-title">Loop Time Machine</div>
          <span className="muted small">{events.length} events (degraded)</span>
          <button type="button" className="btn small" onClick={() => void load()} title="Refresh">
            <RefreshCw size={11} style={{ marginRight: 4 }} />
            Refresh
          </button>
        </div>
        <div className="loop-timeline-degraded-banner" data-testid="loop-timeline-degraded">
          <span>
            Loop debug 未启用,仅显示事件序列。启用后新一轮 LLM 调用会写入完整 loop 详情。
          </span>
          <button
            type="button"
            className="btn small primary"
            onClick={() => void handleEnableDebug()}
            disabled={enablingDebug}
            title="启用 runtime debug"
          >
            <Power size={11} style={{ marginRight: 4 }} />
            {enablingDebug ? "启用中…" : "启用 debug"}
          </button>
        </div>
        {debugToggleError && (
          <div className="error" role="alert">
            启用 debug 失败: {debugToggleError}
          </div>
        )}
        <ol className="loop-timeline-events" data-testid="loop-timeline-events-degraded">
          {events.map((evt, i) => (
            <EventRow
              key={i}
              index={i}
              event={evt}
              onBadgeClick={(e) =>
                handleBadgeClick(e, undefined, `loop-event-degraded-${i}`)
              }
              anchorId={`loop-event-degraded-${i}`}
            />
          ))}
        </ol>
        {popoverState && (
          <LoopActionPopover
            mode={popoverState.mode}
            event={popoverState.event}
            onClose={() => setPopoverState(undefined)}
            onDecide={
              popoverState.mode === "permission"
                ? (args) => handleDecide(popoverState.event, args)
                : undefined
            }
          />
        )}
      </div>
    );
  }

  // 正常模式 — Time Machine
  return (
    <div className="loop-timeline">
      <div className="loop-timeline-header">
        <div className="loop-timeline-title">Loop Time Machine</div>
        <span className="muted small">
          {loopsList.length} loop{loopsList.length === 1 ? "" : "s"} · {events.length} events
        </span>
        <button type="button" className="btn small" onClick={() => void load()} title="Refresh">
          <RefreshCw size={11} style={{ marginRight: 4 }} />
          Refresh
        </button>
      </div>

      <LoopMiniTimeline
        loops={sortedLoops}
        currentLoopIndex={currentLoopIndex ?? sortedLoops[0]!.loopIndex}
        perLoopKeyEventCount={perLoopKeyEventCount}
        onSelectLoop={selectLoop}
      />

      <LoopNavigator
        loops={sortedLoops}
        currentLoopIndex={currentLoopIndex ?? sortedLoops[0]!.loopIndex}
        onSelectLoop={selectLoop}
      />

      {currentEntry && currentLoopIndex !== undefined && (
        <LoopDiffView
          sessionId={sessionId}
          objectId={objectId}
          threadId={threadId}
          currentLoopIndex={currentLoopIndex}
          currentSnapshot={currentEntry.meta?.windowsSnapshot}
          previousSnapshot={previousEntry?.meta?.windowsSnapshot}
          fetcher={req}
        />
      )}

      {currentLoopKeyEvents.length > 0 && (
        <div className="loop-key-events-bar" data-testid="loop-key-events-bar">
          <span className="muted small loop-key-events-bar-label">
            Key events in this loop ({currentLoopKeyEvents.length})
          </span>
          <div className="loop-key-events-bar-badges">
            {currentLoopKeyEvents.map((evt, i) => (
              <span
                key={i}
                id={loopEventAnchorId(evt, currentLoopIndex!, i)}
                className="loop-key-events-bar-anchor"
              >
                <LoopEventBadge
                  event={evt}
                  onClick={(e) =>
                    handleBadgeClick(
                      e,
                      currentLoopIndex,
                      loopEventAnchorId(e, currentLoopIndex!, i),
                    )
                  }
                />
              </span>
            ))}
          </div>
        </div>
      )}

      {popoverState && (
        <LoopActionPopover
          mode={popoverState.mode}
          event={popoverState.event}
          onClose={() => setPopoverState(undefined)}
          onDecide={
            popoverState.mode === "permission"
              ? (args) => handleDecide(popoverState.event, args)
              : undefined
          }
        />
      )}
    </div>
  );
}

/** 退化模式 / unassigned 区的事件单行。 */
function EventRow({
  index,
  event,
  onBadgeClick,
  anchorId,
}: {
  index: number;
  event: LoopEvent;
  onBadgeClick?: (event: LoopEvent) => void;
  anchorId?: string;
}) {
  const isKey = isKeyEvent(event);
  const labelParts: string[] = [];
  if (event && typeof event === "object") {
    const evt = event as Record<string, unknown>;
    if (typeof evt.category === "string") labelParts.push(evt.category);
    if (typeof evt.kind === "string") labelParts.push(evt.kind);
  }
  const label = labelParts.join(" · ") || "(unknown event)";
  return (
    <li className="loop-timeline-event-row" data-event-index={index} id={anchorId}>
      <span className="loop-timeline-event-idx muted small">#{index + 1}</span>
      {isKey ? (
        <LoopEventBadge event={event} onClick={onBadgeClick} />
      ) : (
        <span className="loop-timeline-event-label muted small">{label}</span>
      )}
    </li>
  );
}
