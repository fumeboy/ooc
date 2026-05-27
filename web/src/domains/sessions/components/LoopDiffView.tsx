/**
 * LoopDiffView — Round 9 E3 主区 + Round 10 F3 type-dispatch diff renderer。
 *
 * 折叠态：windowsSnapshot vs previous windowsSnapshot 算成 4 态 diff 表，
 * 渲染为 WindowDiffRow 列表。
 *
 * 展开态（Round 10 F3 改造）：
 *   - 不再统一嵌 LLMInputJsonViewer 看全文
 *   - 按 window type 派发到 window-diff-renderers/<Type>WindowDiff
 *   - file_window：从 currentEntry.fileDiff 直接拿 prev/cur 内容 → CodeMirror Merge unified
 *   - 其它 type：fetch 当前 loop + 上一 loop 的 input.json，从两份的
 *     contextSnapshot.contextWindows 中按 id 提取对应 window 对象，传给 renderer
 *   - 未注册 type / renderer 抛错 → FallbackJsonDiff（由 DiffRendererErrorBoundary 兜底）
 *
 * cache：keyed by loopIndex（避免切换 window 时重复 fetch 同 loop 的 input.json）。
 *
 * 退化（不变）：
 *   - current loop 没 windowsSnapshot 字段 → 提示 "no snapshot data"
 *   - previous loop 没 snapshot → 当前所有 window 显示 added（第一 loop 占位语义）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endpoints } from "../../../transport/endpoints";
import { requestJson } from "../../../transport/http";
import {
  computeWindowDiff,
  type WindowSnapshotEntry,
} from "./window-diff.helpers";
import { WindowDiffRow } from "./WindowDiffRow";
// side-effect: 触发所有 type renderer 注册
import "./window-diff-renderers";
import {
  DiffRendererErrorBoundary,
  FallbackJsonDiff,
  getWindowDiffRenderer,
} from "./window-diff-renderers";

export interface LoopDiffViewProps {
  sessionId: string;
  objectId: string;
  threadId: string;
  currentLoopIndex: number;
  currentSnapshot: WindowSnapshotEntry[] | undefined;
  previousSnapshot: WindowSnapshotEntry[] | undefined;
  /** 测试注入点：替换 requestJson。 */
  fetcher?: typeof requestJson;
}

type LoopFullDetails = { input: unknown; output: unknown; meta: unknown };

/** 在一个 contextSnapshot 中按 id 找到对应 window 对象。 */
function extractWindowFromInput(input: unknown, windowId: string): unknown {
  if (!input || typeof input !== "object") return undefined;
  const inputItems = (input as Record<string, unknown>).inputItems;
  // contextSnapshot 在新版 llm.input.json 上是顶层字段
  const ctxSnapshot = (input as Record<string, unknown>).contextSnapshot;
  const lookup = (snapshot: unknown): unknown => {
    if (!snapshot || typeof snapshot !== "object") return undefined;
    const windows = (snapshot as Record<string, unknown>).contextWindows;
    if (!Array.isArray(windows)) return undefined;
    for (const w of windows) {
      if (w && typeof w === "object" && (w as Record<string, unknown>).id === windowId) {
        return w;
      }
    }
    return undefined;
  };
  const fromTop = lookup(ctxSnapshot);
  if (fromTop !== undefined) return fromTop;
  // 兜底：旧版 llm.input.json 把 snapshot 套在某 input item 上
  if (Array.isArray(inputItems)) {
    for (const item of inputItems) {
      if (item && typeof item === "object") {
        const snap = (item as Record<string, unknown>).contextSnapshot;
        const found = lookup(snap);
        if (found !== undefined) return found;
      }
    }
  }
  return undefined;
}

export function LoopDiffView({
  sessionId,
  objectId,
  threadId,
  currentLoopIndex,
  currentSnapshot,
  previousSnapshot,
  fetcher,
}: LoopDiffViewProps) {
  const req = fetcher ?? requestJson;
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined);

  // ----- loop input.json cache -----
  // key = loopIndex；value = input payload
  const loopInputCache = useRef<Map<number, unknown>>(new Map());
  const [currentInputState, setCurrentInputState] = useState<unknown>(undefined);
  const [previousInputState, setPreviousInputState] = useState<unknown>(undefined);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | undefined>(undefined);

  const diff = useMemo(
    () => computeWindowDiff(currentSnapshot, previousSnapshot),
    [currentSnapshot, previousSnapshot],
  );

  // Loop 切换时重置展开 + 清缓存（避免不同 loop 数据互相污染）
  useEffect(() => {
    setExpandedId(undefined);
    setCurrentInputState(undefined);
    setPreviousInputState(undefined);
    setDetailsError(undefined);
    loopInputCache.current.clear();
  }, [currentLoopIndex]);

  // 找到对应 entry（用 entry.current ?? entry.previous）的辅助
  const entryByIdMemo = useMemo(() => {
    const map = new Map<string, (typeof diff)[number]>();
    for (const e of diff) map.set(e.id, e);
    return map;
  }, [diff]);

  // 拉一个 loop input；带 cache。
  const fetchLoopInput = useCallback(
    async (loopIdx: number): Promise<unknown> => {
      const cache = loopInputCache.current;
      if (cache.has(loopIdx)) return cache.get(loopIdx);
      const res = await req<LoopFullDetails>(
        endpoints.runtimeGetLoopDebug(sessionId, objectId, threadId, loopIdx),
      );
      cache.set(loopIdx, res.input);
      return res.input;
    },
    [req, sessionId, objectId, threadId],
  );

  // 展开某 window 时，按 type 判断是否需要 fetch input.json
  useEffect(() => {
    if (!expandedId) return;
    const entry = entryByIdMemo.get(expandedId);
    if (!entry) return;
    // file_window 走 fileDiff payload 路径 — 不需要 fetch
    if (entry.type === "file") {
      const cur = entry.current;
      // 若有 fileDiff payload，直接渲染；否则 fallback 仍需 input 兜底（content 提取）
      if (cur?.fileDiff) return;
    }
    // 其它 type：要 fetch current + previous input
    if (detailsLoading) return;
    if (
      currentInputState !== undefined &&
      (previousSnapshot === undefined || previousInputState !== undefined)
    ) {
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(undefined);
    const tasks: Promise<void>[] = [];
    if (currentInputState === undefined) {
      tasks.push(
        fetchLoopInput(currentLoopIndex).then((inp) => {
          if (!cancelled) setCurrentInputState(inp);
        }),
      );
    }
    if (
      previousInputState === undefined &&
      previousSnapshot !== undefined &&
      currentLoopIndex > 0
    ) {
      tasks.push(
        fetchLoopInput(currentLoopIndex - 1).then(
          (inp) => {
            if (!cancelled) setPreviousInputState(inp);
          },
          // previous loop 不存在不应 throw 整个加载；记 warn 即可
          (e: unknown) => {
            console.warn(
              `[LoopDiffView] fetch previous loop ${currentLoopIndex - 1} failed:`,
              e,
            );
          },
        ),
      );
    }
    Promise.all(tasks)
      .catch((e: unknown) => {
        if (!cancelled)
          setDetailsError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    expandedId,
    entryByIdMemo,
    fetchLoopInput,
    currentLoopIndex,
    detailsLoading,
    currentInputState,
    previousInputState,
    previousSnapshot,
  ]);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? undefined : id));
  }, []);

  const renderDetail = (windowId: string) => {
    const entry = entryByIdMemo.get(windowId);
    if (!entry) return null;
    const windowType = entry.type;

    // file_window：优先用 entry.current.fileDiff（不需 input fetch）
    if (windowType === "file") {
      const Renderer = getWindowDiffRenderer("file") ?? FallbackJsonDiff;
      // previous/current 直接传 entry，FileWindowDiff 内部会 extract fileDiff
      return (
        <DiffRendererErrorBoundary
          previous={entry.previous}
          current={entry.current}
          windowType={windowType}
          windowId={windowId}
        >
          <Renderer
            previous={entry.previous}
            current={entry.current}
            windowType={windowType}
            windowId={windowId}
          />
        </DiffRendererErrorBoundary>
      );
    }

    // 其它 type：从 fetch 到的 input.json 中提取 window 对象
    if (detailsLoading) {
      return <div className="muted small">Loading loop details…</div>;
    }
    if (detailsError) {
      return (
        <div className="error" role="alert">
          加载失败: {detailsError}
        </div>
      );
    }
    const previousObj =
      previousInputState !== undefined
        ? extractWindowFromInput(previousInputState, windowId)
        : undefined;
    const currentObj =
      currentInputState !== undefined
        ? extractWindowFromInput(currentInputState, windowId)
        : undefined;
    const Renderer = getWindowDiffRenderer(windowType) ?? FallbackJsonDiff;
    return (
      <DiffRendererErrorBoundary
        previous={previousObj}
        current={currentObj}
        windowType={windowType}
        windowId={windowId}
      >
        <Renderer
          previous={previousObj}
          current={currentObj}
          windowType={windowType}
          windowId={windowId}
        />
      </DiffRendererErrorBoundary>
    );
  };

  // No snapshot data — current undefined（不是空数组；是字段缺失）
  if (!Array.isArray(currentSnapshot)) {
    return (
      <div className="loop-diff-view loop-diff-view-empty" data-testid="loop-diff-view-empty">
        <div className="muted small">
          no snapshot data — backend may not have written <code>windowsSnapshot</code> yet for this
          loop. (E3 frontend ready, awaiting E2 backend.)
        </div>
      </div>
    );
  }

  if (diff.length === 0) {
    return (
      <div className="loop-diff-view loop-diff-view-empty" data-testid="loop-diff-view-empty">
        <div className="muted small">No windows in this loop.</div>
      </div>
    );
  }

  const previousMissing = !Array.isArray(previousSnapshot);

  return (
    <div className="loop-diff-view" data-testid="loop-diff-view">
      <div className="loop-diff-view-head">
        <span className="muted small">
          Windows ({diff.length})
          {previousMissing
            ? " · first loop with snapshot data"
            : ` · vs Loop #${String(currentLoopIndex - 1).padStart(4, "0")}`}
        </span>
      </div>
      <ul className="loop-diff-view-list" data-testid="loop-diff-view-list">
        {diff.map((entry) => (
          <WindowDiffRow
            key={entry.id}
            entry={entry}
            expanded={expandedId === entry.id}
            onToggleExpand={() => handleToggle(entry.id)}
            detail={expandedId === entry.id ? renderDetail(entry.id) : undefined}
          />
        ))}
      </ul>
    </div>
  );
}
