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
import { DiffRendererErrorBoundary } from "./window-diff-renderers";
import { WindowDiff } from "./window-diff/resolveWindowDiff";

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

/**
 * Round 14 H1 修复 — fetch-loop-inputs 纯函数 helper（可单测）。
 *
 * 把 LoopDiffView useEffect 内部 "拉 current + previous loop input.json" 的协作逻辑
 * 抽出来，便于 bun:test 真异步覆盖（防 Round 10 单测 mock 同步返回掩盖 self-cancelling
 * bug 这种回归）。
 *
 * 行为契约：
 *   - 若 needsCurrent → 调 fetchLoop(currentLoopIndex) 拿当前 loop input
 *   - 若 needsPrevious 且 currentLoopIndex>0 → 拉前一 loop input；前一 loop 不存在不应
 *     传染整体失败（catch 内 warn 即可）
 *   - 任何 fetcher reject（current 维度）→ rethrow，调用方 setDetailsError 暴露
 *   - 返回 { current, previous }，由调用方写 state
 */
export interface LoopInputFetchPlan {
  fetchLoop: (loopIdx: number) => Promise<unknown>;
  currentLoopIndex: number;
  needsCurrent: boolean;
  needsPrevious: boolean;
}

export interface LoopInputFetchResult {
  current?: unknown;
  previous?: unknown;
}

export async function fetchLoopInputsForDiff(
  plan: LoopInputFetchPlan,
): Promise<LoopInputFetchResult> {
  const result: LoopInputFetchResult = {};
  const tasks: Promise<void>[] = [];
  if (plan.needsCurrent) {
    tasks.push(
      plan.fetchLoop(plan.currentLoopIndex).then((inp) => {
        result.current = inp;
      }),
    );
  }
  if (plan.needsPrevious && plan.currentLoopIndex > 0) {
    tasks.push(
      plan.fetchLoop(plan.currentLoopIndex - 1).then(
        (inp) => {
          result.previous = inp;
        },
        // previous loop 不存在不应传染整体失败 — 与原 effect 行为对齐
        (e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[LoopDiffView] fetch previous loop ${plan.currentLoopIndex - 1} failed:`,
            e,
          );
        },
      ),
    );
  }
  // current 维度任一抛错 → Promise.all reject → 调用方 catch
  await Promise.all(tasks);
  return result;
}

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
  // Round 14 H1: inFlightRef 防重入。ref 不进 deps array → effect 不会因为 detailsLoading
  // 自己 set 自己而 self-cancel（旧 bug: cleanup 设 cancelled=true 后 finally 不再写
  // setDetailsLoading(false), UI 永远 stuck on "Loading…"）。
  const inFlightRef = useRef(false);

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
  // Round 14 H1: 用 inFlightRef 防重入；从 deps array 删除 detailsLoading 避免 self-cancel；
  // 即便组件 unmount / loop 切换 (cancelled=true), 也保证 inFlightRef 清零，下次 effect
  // 触发能继续工作。setDetailsLoading(false) 同样无条件执行 —— 避免 stuck on loading。
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
    if (inFlightRef.current) return;
    const needsCurrent = currentInputState === undefined;
    const needsPrevious =
      previousInputState === undefined && previousSnapshot !== undefined;
    if (!needsCurrent && !needsPrevious) return;

    let cancelled = false;
    inFlightRef.current = true;
    setDetailsLoading(true);
    setDetailsError(undefined);

    fetchLoopInputsForDiff({
      fetchLoop: fetchLoopInput,
      currentLoopIndex,
      needsCurrent,
      needsPrevious,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.current !== undefined) setCurrentInputState(res.current);
        if (res.previous !== undefined) setPreviousInputState(res.previous);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setDetailsError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        // 无条件清零 inFlight + loading — 即便 cancelled，避免下次 effect 触发时
        // inFlightRef 残留 true 卡死，或 detailsLoading 残留 true 让 UI stuck。
        inFlightRef.current = false;
        setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    expandedId,
    entryByIdMemo,
    fetchLoopInput,
    currentLoopIndex,
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
    const windowType = entry.type ?? "unknown";

    // file_window：entry.current 带后端附挂的 fileDiff，免 fetch 直传 WindowDiff（C-2）
    if (entry.type === "file") {
      return (
        <DiffRendererErrorBoundary
          previous={entry.previous}
          current={entry.current}
          windowType={windowType}
          windowId={windowId}
        >
          <WindowDiff
            previous={entry.previous}
            current={entry.current}
            sessionId={sessionId}
          />
        </DiffRendererErrorBoundary>
      );
    }

    // 其它 type：从 fetch 到的 input.json 中提取完整 window 对象后传 WindowDiff（C-2）
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
    return (
      <DiffRendererErrorBoundary
        previous={previousObj}
        current={currentObj}
        windowType={windowType}
        windowId={windowId}
      >
        <WindowDiff
          previous={previousObj}
          current={currentObj}
          sessionId={sessionId}
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
