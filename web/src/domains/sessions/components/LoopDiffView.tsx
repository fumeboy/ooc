/**
 * LoopDiffView — Round 9 E3 主区。
 *
 * 把当前 loop 的 windowsSnapshot vs 上一 loop 的 windowsSnapshot 算成 4 态 diff 表，
 * 渲染为 WindowDiffRow 列表。点击单条 row 展开 → lazy fetch `loop_NNNN.input.json`，
 * 在 row 内嵌入 LLMInputJsonViewer 看完整内容。
 *
 * 退化（design §1.1 风险栏 / §3.2 optional）：
 *   - current loop 没 windowsSnapshot 字段（后端 E2 还没接 / 老 loop）→ 显示提示
 *     "no snapshot data — backend may not have written windowsSnapshot yet."
 *   - previous loop 没 snapshot → 当前所有 window 显示 added（第一 loop 占位语义）
 *
 * 不重复造结构化树视图 — 展开 detail 用 LLMInputJsonViewer（与 R0c LoopEntry 同款）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { endpoints } from "../../../transport/endpoints";
import { requestJson } from "../../../transport/http";
import type { FileContent } from "../../files/model";
import { LLMInputJsonViewer } from "../../files/components/LLMInputJsonViewer";
import {
  computeWindowDiff,
  type WindowSnapshotEntry,
} from "./window-diff.helpers";
import { WindowDiffRow } from "./WindowDiffRow";

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
  const [details, setDetails] = useState<LoopFullDetails | undefined>(undefined);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | undefined>(undefined);
  const [detailsForLoop, setDetailsForLoop] = useState<number | undefined>(undefined);

  const diff = useMemo(
    () => computeWindowDiff(currentSnapshot, previousSnapshot),
    [currentSnapshot, previousSnapshot],
  );

  // Loop 切换时重置展开 / 清除旧 details。
  useEffect(() => {
    setExpandedId(undefined);
    if (detailsForLoop !== currentLoopIndex) {
      setDetails(undefined);
      setDetailsError(undefined);
    }
  }, [currentLoopIndex, detailsForLoop]);

  // Lazy fetch loop full details — 只在有 expandedId 时触发，且不重复拉。
  useEffect(() => {
    if (!expandedId) return;
    if (details && detailsForLoop === currentLoopIndex) return;
    if (detailsLoading) return;
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(undefined);
    req<LoopFullDetails>(
      endpoints.runtimeGetLoopDebug(sessionId, objectId, threadId, currentLoopIndex),
    )
      .then((res) => {
        if (cancelled) return;
        setDetails(res);
        setDetailsForLoop(currentLoopIndex);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
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
    details,
    detailsForLoop,
    currentLoopIndex,
    detailsLoading,
    req,
    sessionId,
    objectId,
    threadId,
  ]);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? undefined : id));
  }, []);

  const renderDetail = (windowId: string) => {
    if (detailsLoading) return <div className="muted small">Loading loop details…</div>;
    if (detailsError) {
      return (
        <div className="error" role="alert">
          加载失败: {detailsError}
        </div>
      );
    }
    if (!details) return null;
    return <WindowExpandedDetail input={details.input} loopIndex={currentLoopIndex} windowId={windowId} />;
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

/**
 * 用现有 LLMInputJsonViewer 渲染当前 loop 的 input.json —— 与 R0c LoopEntry 同款。
 * MVP：暂时不按 windowId 过滤；让 LLMInputJsonViewer 显示完整 input items + system context
 * （内含 contextSnapshot），用户可在其中检索具体 window。
 *
 * windowId 仅作 anchor / tooltip；未来增强可加 prop 让 LLMInputJsonViewer 高亮指定 window。
 */
function WindowExpandedDetail({
  input,
  loopIndex,
  windowId,
}: {
  input: unknown;
  loopIndex: number;
  windowId: string;
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
  const fakePath = `loop_${String(loopIndex).padStart(4, "0")}.input.json#${windowId}`;
  const file: FileContent = {
    path: fakePath,
    content,
    size: content.length,
  };
  return <LLMInputJsonViewer file={file} />;
}
