/**
 * LoopEntry — 单条 loop 行 (R0c plan §6.1).
 *
 * 列表态: loopIndex / startedAt / latencyMs / messageCount / toolCount / 关键 event chips +
 * 展开按钮。展开态 lazy fetch loop_NNNN.{input,output,meta}.json 三件套, 用现有
 * LLMInputJsonViewer + JsonTreeView 渲染, 不重复造结构化树视图。
 *
 * 设计取舍:
 * - 不在 LoopEntry 内部直接读 ProcessEvent 时间戳给 events 排序; events 由父组件
 *   (LoopTimeline) 用 meta.startedAt/finishedAt 启发分配后通过 props 传入。
 * - 单 loop 详情 lazy: 用户没点展开就不发 fetch (避免长 thread 一次拉 N 个 loop 全文)。
 * - silent-swallow ban: 单 loop 详情 fetch 失败 → 渲染明显错误条, 不静默 fallback。
 */

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { endpoints } from "../../../transport/endpoints";
import { requestJson } from "../../../transport/http";
import type { FileContent } from "../../files/model";
import { LLMInputJsonViewer } from "../../files/components/LLMInputJsonViewer";
import { JsonTreeView } from "../../files/components/JsonTreeView";
import { LoopEventBadge, type LoopEvent } from "./LoopEventBadge";

/**
 * R0d: 给单个 ProcessEvent 在 DOM 里生成一个稳定 anchor id, 让 timeline 跨 loop entry
 * scrollIntoView 时能定位过来。优先用 event.id (Q0c 后续 backend 写入); 没有时回退到
 * toolCallId / earliestEventId / loop_idx 派生 — 与 backend decidePermission 路径用的
 * fallback 同款 (toolCallId_ask)。
 */
export function loopEventAnchorId(event: LoopEvent, loopIndex: number, idxInLoop: number): string {
  const id = typeof event.id === "string" ? event.id : undefined;
  if (id) return `loop-event-${id}`;
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
  if (toolCallId) return `loop-event-${toolCallId}`;
  return `loop-event-loop${loopIndex}-${idxInLoop}`;
}

/** R0c: LoopMeta 与 src/persistable/debug-file.ts:LlmLoopDebugMetaRecord 形态对齐 (前端重声明)。 */
export interface LoopMeta {
  threadId: string;
  loopIndex: number;
  provider?: string;
  model?: string;
  startedAt: number;
  finishedAt: number;
  latencyMs: number;
  messageCount: number;
  toolCount: number;
  toolCallCount: number;
  contextBytes: number;
  resultTextBytes: number;
  status: "ok" | "paused" | "error";
  error?: string;
}

export interface LoopListEntry {
  loopIndex: number;
  hasInput: boolean;
  hasOutput: boolean;
  hasMeta: boolean;
  meta?: LoopMeta;
}

export interface LoopEntryProps {
  sessionId: string;
  objectId: string;
  threadId: string;
  entry: LoopListEntry;
  /** 父组件预先分配给本 loop 的 ProcessEvent 列表 (用于关键 event chips)。 */
  events: LoopEvent[];
  /**
   * R0d: 父组件强制本 entry 展开 (例如用户从 timeline 上方单击 badge 跳转过来)。
   * 受控展开 prop — 默认 undefined 时由组件内部 state 控制 (与 R0c 行为兼容)。
   * 取 true → 展开; 取 false → 不强制 (仍由用户操作切换)。
   */
  forceExpand?: boolean;
  /** R0d: badge 单击事件透传给父级 — 父级决定是 scroll / 展开 / 弹 popover。 */
  onBadgeClick?: (event: LoopEvent) => void;
}

/** "1234ms" → "1.2s" / "120ms" / "--" (无数据)。 */
function formatLatency(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** ms timestamp → "12:34:56" 本地相对时间。 */
function formatTime(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--";
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "--";
  }
}

/** 4 位 0 padding loopIndex → "#0001"。 */
function formatLoopIndex(n: number): string {
  return `#${String(n).padStart(4, "0")}`;
}

type LoopFullDetails = {
  input: unknown;
  output: unknown;
  meta: unknown;
};

export function LoopEntry({
  sessionId,
  objectId,
  threadId,
  entry,
  events,
  forceExpand,
  onBadgeClick,
}: LoopEntryProps) {
  const [expandedSelf, setExpandedSelf] = useState(false);
  // R0d: forceExpand=true 时合并到 expanded — 父级控制态优先 OR 自身态。
  const expanded = expandedSelf || forceExpand === true;
  const [details, setDetails] = useState<LoopFullDetails | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // lazy fetch: only when expanded for the first time
  useEffect(() => {
    if (!expanded || details || loading) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    requestJson<LoopFullDetails>(
      endpoints.runtimeGetLoopDebug(sessionId, objectId, threadId, entry.loopIndex),
    )
      .then((res) => {
        if (cancelled) return;
        setDetails(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, details, loading, sessionId, objectId, threadId, entry.loopIndex]);

  const meta = entry.meta;
  const keyEventCount = events.filter(Boolean).length;

  return (
    <li className="loop-entry" data-loop-index={entry.loopIndex}>
      <div
        className="loop-entry-head"
        role="button"
        tabIndex={0}
        onClick={() => setExpandedSelf((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpandedSelf((p) => !p);
          }
        }}
        aria-expanded={expanded}
      >
        <ChevronRight
          size={12}
          className={`loop-entry-chevron ${expanded ? "is-open" : ""}`}
          aria-hidden
        />
        <span className="loop-entry-index">{formatLoopIndex(entry.loopIndex)}</span>
        <span className="loop-entry-time muted small" title={meta ? `startedAt ${meta.startedAt}` : undefined}>
          {formatTime(meta?.startedAt)}
        </span>
        <span className="loop-entry-latency pill" title="latencyMs">
          {formatLatency(meta?.latencyMs)}
        </span>
        {meta && (
          <>
            <span className="pill" title="messageCount">
              {meta.messageCount} msg
            </span>
            <span className="pill" title="toolCount">
              {meta.toolCount} tools
            </span>
          </>
        )}
        {meta?.status === "paused" && <span className="pill loop-entry-pill-paused">paused</span>}
        {meta?.status === "error" && <span className="pill loop-entry-pill-error">error</span>}
        <span
          className="loop-entry-badges"
          // R0d: badge 容器是 head 的一部分; 阻止 click 冒泡到 head 以免顺手把
          // entry 切回 collapsed (badge 自身已有 onClick 抛事件)。
          onClick={(e) => {
            if (onBadgeClick) e.stopPropagation();
          }}
        >
          {events.map((evt, i) => (
            <span
              key={i}
              id={loopEventAnchorId(evt, entry.loopIndex, i)}
              className="loop-entry-badge-anchor"
            >
              <LoopEventBadge
                event={evt}
                onClick={onBadgeClick ? (e) => onBadgeClick(e) : undefined}
              />
            </span>
          ))}
        </span>
        {keyEventCount === 0 && events.length === 0 && meta === undefined && (
          <span className="muted small">(meta missing)</span>
        )}
      </div>
      {expanded && (
        <div className="loop-entry-body">
          {loading && <div className="muted small">Loading loop details…</div>}
          {error && (
            <div className="error" role="alert">
              加载失败: {error}
            </div>
          )}
          {!loading && !error && details && (
            <LoopDetails details={details} loopIndex={entry.loopIndex} threadId={threadId} />
          )}
        </div>
      )}
    </li>
  );
}

function LoopDetails({
  details,
  loopIndex,
  threadId,
}: {
  details: LoopFullDetails;
  loopIndex: number;
  threadId: string;
}) {
  const [tab, setTab] = useState<"input" | "output" | "meta">("input");
  return (
    <div className="loop-entry-tabs">
      <div className="loop-entry-tab-bar">
        <button
          type="button"
          className={`loop-entry-tab ${tab === "input" ? "is-active" : ""}`}
          onClick={() => setTab("input")}
        >
          input
        </button>
        <button
          type="button"
          className={`loop-entry-tab ${tab === "output" ? "is-active" : ""}`}
          onClick={() => setTab("output")}
        >
          output
        </button>
        <button
          type="button"
          className={`loop-entry-tab ${tab === "meta" ? "is-active" : ""}`}
          onClick={() => setTab("meta")}
        >
          meta
        </button>
      </div>
      <div className="loop-entry-tab-body">
        {tab === "input" && <LoopInputView input={details.input} loopIndex={loopIndex} threadId={threadId} />}
        {tab === "output" && <JsonTreeView value={details.output} rootLabel={`loop_${String(loopIndex).padStart(4, "0")}.output.json`} />}
        {tab === "meta" && <JsonTreeView value={details.meta} rootLabel={`loop_${String(loopIndex).padStart(4, "0")}.meta.json`} />}
      </div>
    </div>
  );
}

/**
 * 用现有 LLMInputJsonViewer 渲染 input — 复用 system context + input items 拆分视图。
 * 把 input JSON 装回 FileContent shape 喂进去, 避免重写一遍 input items 树。
 */
function LoopInputView({
  input,
  loopIndex,
  threadId,
}: {
  input: unknown;
  loopIndex: number;
  threadId: string;
}) {
  let content: string;
  try {
    content = JSON.stringify(input, null, 2);
  } catch (e) {
    return (
      <div className="error">
        loop input 序列化失败: {e instanceof Error ? e.message : String(e)}
      </div>
    );
  }
  const fakePath = `loop_${String(loopIndex).padStart(4, "0")}.input.json`;
  const file: FileContent = {
    path: fakePath,
    content,
    size: content.length,
  };
  // LLMInputJsonViewer 内部检测 inputItems 数组; 失败时回退原始 JSON 视图。
  // 退化路径 (输入没有 inputItems / contextSnapshot) 也由 LLMInputJsonViewer 处理。
  void threadId;
  return <LLMInputJsonViewer file={file} />;
}
