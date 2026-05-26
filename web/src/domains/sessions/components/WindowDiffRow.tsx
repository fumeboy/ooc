/**
 * WindowDiffRow — 单个 window 在当前 loop vs 上一 loop 的 diff 行。
 *
 * Round 9 E3：折叠态显示 icon + type + summary + diff status；
 * 点击 → 触发 onToggleExpand，由父级 LoopDiffView 展开嵌入 LLMInputJsonViewer 看完整内容。
 *
 * 视觉编码（design §5）：
 *   - added → 绿色背景
 *   - changed → 橙色边框
 *   - removed → 灰化 + strike-through（rule: previous 有，所以仍列出但用 disabled 视觉）
 *   - unchanged → 普通灰色
 */

import { ChevronRight } from "lucide-react";
import {
  describeDiffStatus,
  type WindowDiffEntry,
} from "./window-diff.helpers";

export interface WindowDiffRowProps {
  entry: WindowDiffEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  /** 展开后的 detail node（由父级注入，可为 LLMInputJsonViewer 或简单 JSON 树）。 */
  detail?: React.ReactNode;
}

export function WindowDiffRow({
  entry,
  expanded,
  onToggleExpand,
  detail,
}: WindowDiffRowProps) {
  const status = describeDiffStatus(entry.status);
  const display = entry.current ?? entry.previous;
  const summary = (() => {
    const raw = display?.summary;
    if (typeof raw === "string" && raw.length > 0) {
      return raw.length > 88 ? raw.slice(0, 88) + "…" : raw;
    }
    // 没 summary → 显示 status / compressLevel 一类元信息
    if (display?.status) return `(${display.status})`;
    return "";
  })();

  return (
    <li
      className={`window-diff-row window-diff-row-${status.className}`}
      data-window-id={entry.id}
      data-status={entry.status}
      data-testid={`window-diff-row-${entry.id}`}
    >
      <div
        className="window-diff-row-head"
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        aria-expanded={expanded}
      >
        <ChevronRight
          size={11}
          className={`window-diff-row-chevron ${expanded ? "is-open" : ""}`}
          aria-hidden
        />
        <span className="window-diff-row-status-icon" aria-hidden>
          {status.icon}
        </span>
        <span className="window-diff-row-type">{entry.type}</span>
        <code className="window-diff-row-id">{entry.id}</code>
        {summary && (
          <span className="window-diff-row-summary muted small">{summary}</span>
        )}
        <span className={`window-diff-row-pill window-diff-row-pill-${status.className}`}>
          {status.label}
        </span>
      </div>
      {expanded && detail && (
        <div className="window-diff-row-body">{detail}</div>
      )}
    </li>
  );
}
