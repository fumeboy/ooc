/**
 * LoopTimeline — Agent-loop Visualizer 主组件 (R0c plan §6.1).
 *
 * 数据流:
 * 1. GET /api/runtime/.../debug/loops → list loops (只含 meta, 不含 input/output 全文)
 * 2. GET /api/flows/:sid/objects/:oid/threads/:tid → thread.events
 * 3. 把 thread.events 按时间戳启发分配到对应 loopIndex (见 partitionEventsByLoop)
 * 4. 渲染 LoopEntry 列表; 退化模式 (loops 为空) 直接展示 events 升序序列
 *
 * 退化模式 (debug 关闭):
 * - 顶部提示条 "Loop debug 未启用, 仅显示事件序列。" + 一键启用按钮 (POST runtimeDebugEnable)
 * - events 直接平铺, 无 loop 分组; 关键 event 仍用 LoopEventBadge 高亮
 * - 不显示 latency / messageCount (无数据)
 *
 * 不做的事 (本轮):
 * - 不监听 SSE / 不轮询 — Mount + 手动 refresh; 父组件可在用户切回 tab 时强制 re-mount
 * - 不持久化展开状态到 URL — tab 切换时丢失;后续 phase 可加 query param
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Power } from "lucide-react";
import { endpoints } from "../../../transport/endpoints";
import { requestJson } from "../../../transport/http";
import { LoopEntry, loopEventAnchorId, type LoopListEntry } from "./LoopEntry";
import { LoopEventBadge, isKeyEvent, type LoopEvent } from "./LoopEventBadge";
import { LoopActionPopover, type LoopActionPopoverMode } from "./LoopActionPopover";

export interface LoopTimelineProps {
  sessionId: string;
  objectId: string;
  threadId: string;
  /**
   * 测试注入点: 替换默认 requestJson, 让单测可以 mock 后端响应。
   * 生产环境保持 undefined → 走真实 HTTP。
   */
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
 * 启发式 (plan §4 不强制要求精确分组):
 * - ProcessEvent 当前没有 createdAt; 唯一可用信号是 events 数组的 **顺序**。
 * - 按 loopIndex 升序对 loops 做 "区段切片": 用 meta.startedAt/finishedAt 做边界 hint,
 *   但因 events 无时间戳, 实际只能用 **比例切分** — 把 events 按 loops 数量等分。
 * - 这是 plan 允许的 "回退到 events 升序分页, 每个 loop 包含上一 loop 之后到本 loop
 *   结束前的所有 events" 的最简实现; 后续可加更聪明的对齐 (例如 thinkloop 写入时给
 *   events 附 loopIndex 字段)。
 *
 * 返回 { perLoop: Map<loopIndex, events[]>, unassigned: events[] }。
 * unassigned 在 plan 允许时显示在 timeline 底部 ("unassigned events" 区);
 * 当前实现 events 全部分配, unassigned 始终为空 — 留个 hook 给未来精确对齐用。
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

  // 简单等分: events 数 / loops 数, 余数堆到最后一个 loop。
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
 * R0d: 纯函数 — 把 badge 单击映射到 timeline 的下一步动作。
 *
 * 决策表:
 *  - permission_ask + 无 decided → "open-permission" (弹层让用户决议)
 *  - events_summary               → "open-summary"   (弹层显示全文)
 *  - 其它关键 event               → "scroll"         (滚到 anchor + 展开所在 loop)
 *
 * 拎出来便于单测在无 DOM 环境下断言交互意图,
 * UI 层 (handleBadgeClick) 调用本函数后再执行 side effect。
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
 * R0d: 纯函数 — 把 popover 提交参数 + 目标 event 编排成发给 backend 的 decide body。
 *
 * 选 eventId 的优先级:
 *  1. event.id (Q0c 写入或 backend 兜底写过的)
 *  2. event.toolCallId + "_ask" (与 backend service.decidePermission 同款 fallback)
 *  3. 都没有 → 不带 eventId, 让 backend 选最近一条 pending
 *
 * reason 为空字符串 / undefined → 不进 body (与 popover 内 UI 行为一致)。
 */
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

/**
 * R0d: 把 "build body + fire HTTP" 抽出来便于单测 (注入 fetcher mock 即可断言收到的 body / path)。
 * 失败时 throw — popover 负责 catch + 显示。
 */
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
  const [loops, setLoops] = useState<LoopListEntry[] | undefined>(undefined);
  const [thread, setThread] = useState<ThreadResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [enablingDebug, setEnablingDebug] = useState(false);
  const [debugToggleError, setDebugToggleError] = useState<string | undefined>(undefined);
  // R0d: 父级受控 forceExpand — 单击其它 loop 内 badge 时把目标 loop 展开。
  const [forcedExpandLoopIndex, setForcedExpandLoopIndex] = useState<number | undefined>(undefined);
  // R0d: 弹层状态 (permission ask 决议 / events_summary 全文展开)
  const [popoverState, setPopoverState] = useState<
    | { mode: LoopActionPopoverMode; event: LoopEvent }
    | undefined
  >(undefined);

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

  /**
   * R0d: badge 单击的总调度。
   * - permission_ask 且 pending → 开 popover (mode=permission)
   * - permission_ask 且 decided → 仅 scroll + 展开所在 loop (无需弹层)
   * - events_summary → 开 popover (mode=summary)
   * - 其它关键 event (context_compressed / permission_denied / tool_result fail) →
   *   只做 scroll + 展开 (退化 timeline 没有 loop entry, 仅 scroll 即可)。
   *
   * 退化模式 (loopsList 空) 不传 onBadgeClick, 这里只服务正常模式;
   * 退化模式 badge 直接走 LoopEventBadge 默认无 onClick 行为。
   */
  const handleBadgeClick = useCallback(
    (event: LoopEvent, ownerLoopIndex: number | undefined, anchorId: string) => {
      const action = planBadgeClickAction(event);
      if (action.type === "open-permission") {
        setPopoverState({ mode: "permission", event });
        return;
      }
      if (action.type === "open-summary") {
        setPopoverState({ mode: "summary", event });
        return;
      }
      // scroll: 展开目标 loop + scroll 到 anchor。
      if (typeof ownerLoopIndex === "number") {
        setForcedExpandLoopIndex(ownerLoopIndex);
      }
      // 用 rAF 等 forceExpand 引起的 render 落地再 scroll, 避免在 collapsed 时滚到空 DOM。
      const raf =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : (cb: () => void) => setTimeout(cb, 16);
      raf(() => {
        const el = typeof document !== "undefined" ? document.getElementById(anchorId) : null;
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    },
    [],
  );

  /**
   * R0d: permission popover 内 Approve / Reject 提交 — 触发 backend HTTP,
   * 成功后 refresh timeline (拉取最新 thread.events, badge 由 yellow → green/red 自然过渡)。
   * 失败时 throw 让 popover 显示错误 (silent-swallow ban)。
   */
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
      // 成功 — refresh + 关闭 popover
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
      // 不自动 reload — 已存在的 thread.events 不会因 enable 立刻获得 loop debug;
      // 提示用户 "新一轮 LLM 调用后 loops 会出现"。父级若想 reload 可点 refresh 按钮。
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
          <div className="loop-timeline-title">Loop Timeline</div>
          <div className="muted small">loading…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loop-timeline">
        <div className="loop-timeline-header">
          <div className="loop-timeline-title">Loop Timeline</div>
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

  const loopsList = loops ?? [];
  const events = (thread?.events ?? []) as LoopEvent[];
  const debugDisabled = loopsList.length === 0;
  const hasAnyData = loopsList.length > 0 || events.length > 0;

  // 空态: 没有 loops 也没有 events
  if (!hasAnyData) {
    return (
      <div className="loop-timeline">
        <div className="loop-timeline-header">
          <div className="loop-timeline-title">Loop Timeline</div>
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

  // 退化模式: loops 空 + events 非空
  if (debugDisabled) {
    return (
      <div className="loop-timeline">
        <div className="loop-timeline-header">
          <div className="loop-timeline-title">Loop Timeline</div>
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
              onBadgeClick={(e) => handleBadgeClick(e, undefined, `loop-event-degraded-${i}`)}
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

  // 正常模式
  const { perLoop, unassigned } = partitionEventsByLoop(loopsList, events);

  return (
    <div className="loop-timeline">
      <div className="loop-timeline-header">
        <div className="loop-timeline-title">Loop Timeline</div>
        <span className="muted small">
          {loopsList.length} loop{loopsList.length === 1 ? "" : "s"} · {events.length} events
        </span>
        <button type="button" className="btn small" onClick={() => void load()} title="Refresh">
          <RefreshCw size={11} style={{ marginRight: 4 }} />
          Refresh
        </button>
      </div>
      <ol className="loop-timeline-list" data-testid="loop-timeline-list">
        {loopsList.map((entry) => {
          const loopEvents = (perLoop.get(entry.loopIndex) ?? []).filter(isKeyEvent);
          return (
            <LoopEntry
              key={entry.loopIndex}
              sessionId={sessionId}
              objectId={objectId}
              threadId={threadId}
              entry={entry}
              events={loopEvents}
              forceExpand={forcedExpandLoopIndex === entry.loopIndex}
              onBadgeClick={(evt) => {
                const idx = loopEvents.indexOf(evt);
                const anchorId = loopEventAnchorId(evt, entry.loopIndex, idx >= 0 ? idx : 0);
                handleBadgeClick(evt, entry.loopIndex, anchorId);
              }}
            />
          );
        })}
      </ol>
      {unassigned.length > 0 && (
        <details className="loop-timeline-unassigned">
          <summary className="muted small">{unassigned.length} unassigned events</summary>
          <ol>
            {unassigned.map((evt, i) => (
              <EventRow key={i} index={i} event={evt} />
            ))}
          </ol>
        </details>
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

/** 退化模式 / unassigned 区的事件单行 — 关键 event 用 badge, 其它显示 category/kind 文字。 */
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
