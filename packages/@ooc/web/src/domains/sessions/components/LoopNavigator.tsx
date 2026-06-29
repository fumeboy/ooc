/**
 * LoopNavigator — Loop Time Machine 导航 bar。
 *
 * 显示当前 loop 编号 + 元信息（时间 / latency / message count）+ 三个按钮：
 *   [← Prev] Loop #NNNN of M [Next →]   [⏭ Latest]
 *
 * 行为：
 *   - Prev / Next 切到 loop ± 1；边界 disabled
 *   - Latest 跳到最新 loop（max loopIndex）
 *   - 键盘 ←/→：focus 在主组件时生效（由父组件挂 keydown listener；本组件只暴露 props）
 *
 * 不做 fetch / state — 完全受控；切 loop 走 onSelectLoop 回调由父级写 URL。
 */

import { ChevronLeft, ChevronRight, SkipForward } from "lucide-react";
import type { LoopListEntry } from "./loop-types";

export interface LoopNavigatorProps {
  /** 全部 loop 列表（已按 loopIndex 升序）。 */
  loops: LoopListEntry[];
  /** 当前查看的 loopIndex（不传 = Latest = 最后一个）。 */
  currentLoopIndex: number;
  /** 切到指定 loopIndex；父级负责写 URL + scroll mini timeline。 */
  onSelectLoop: (loopIndex: number) => void;
}

/** "1234ms" → "1.2s" / "120ms" / "--"。 */
function formatLatency(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** ms timestamp → "12:34:56"。 */
function formatTime(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--";
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "--";
  }
}

/** "#0023"。 */
function formatLoopIndex(n: number): string {
  return `#${String(n).padStart(4, "0")}`;
}

export function LoopNavigator({
  loops,
  currentLoopIndex,
  onSelectLoop,
}: LoopNavigatorProps) {
  if (loops.length === 0) return null;

  const sortedLoops = [...loops].sort((a, b) => a.loopIndex - b.loopIndex);
  const firstIndex = sortedLoops[0]!.loopIndex;
  const lastIndex = sortedLoops[sortedLoops.length - 1]!.loopIndex;
  const currentEntry = sortedLoops.find((l) => l.loopIndex === currentLoopIndex);
  const meta = currentEntry?.meta;

  const prevLoop = (() => {
    for (let i = sortedLoops.length - 1; i >= 0; i--) {
      if (sortedLoops[i]!.loopIndex < currentLoopIndex) return sortedLoops[i]!.loopIndex;
    }
    return undefined;
  })();
  const nextLoop = sortedLoops.find((l) => l.loopIndex > currentLoopIndex)?.loopIndex;

  const total = sortedLoops.length;
  const positionInList = sortedLoops.findIndex((l) => l.loopIndex === currentLoopIndex) + 1;

  return (
    <div className="loop-navigator" data-testid="loop-navigator">
      <div className="loop-navigator-row">
        <button
          type="button"
          className="btn small"
          onClick={() => prevLoop !== undefined && onSelectLoop(prevLoop)}
          disabled={prevLoop === undefined}
          title="Previous loop (←)"
          data-testid="loop-navigator-prev"
        >
          <ChevronLeft size={12} style={{ marginRight: 4 }} />
          Prev
        </button>
        <div className="loop-navigator-title">
          <span className="loop-navigator-index">{formatLoopIndex(currentLoopIndex)}</span>
          <span className="muted small">
            {positionInList > 0 ? `${positionInList} of ${total}` : `(${firstIndex}-${lastIndex})`}
          </span>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={() => nextLoop !== undefined && onSelectLoop(nextLoop)}
          disabled={nextLoop === undefined}
          title="Next loop (→)"
          data-testid="loop-navigator-next"
        >
          Next
          <ChevronRight size={12} style={{ marginLeft: 4 }} />
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => currentLoopIndex !== lastIndex && onSelectLoop(lastIndex)}
          disabled={currentLoopIndex === lastIndex}
          title="Jump to latest loop"
          data-testid="loop-navigator-latest"
        >
          <SkipForward size={12} style={{ marginRight: 4 }} />
          Latest
        </button>
      </div>
      {meta && (
        <div className="loop-navigator-meta muted small">
          <span title={`startedAt ${meta.startedAt}`}>{formatTime(meta.startedAt)}</span>
          <span>·</span>
          <span title="latencyMs">{formatLatency(meta.latencyMs)}</span>
          <span>·</span>
          <span>{meta.messageCount} msg</span>
          <span>·</span>
          <span>{meta.toolCount} tools</span>
          {meta.status === "paused" && (
            <span className="pill loop-entry-pill-paused">paused</span>
          )}
          {meta.status === "error" && (
            <span className="pill loop-entry-pill-error">error</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 计算"按 Prev / Next 后该跳到哪个 loopIndex"——纯函数，便于单测断言键盘 / button 行为
 * 不依赖 DOM。
 *
 * 返回 undefined → 表示边界，不切。
 */
export function planNavigate(
  loops: LoopListEntry[],
  currentLoopIndex: number,
  direction: "prev" | "next" | "latest",
): number | undefined {
  if (loops.length === 0) return undefined;
  const sorted = [...loops].sort((a, b) => a.loopIndex - b.loopIndex);
  if (direction === "latest") {
    const last = sorted[sorted.length - 1]!.loopIndex;
    return last === currentLoopIndex ? undefined : last;
  }
  if (direction === "prev") {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i]!.loopIndex < currentLoopIndex) return sorted[i]!.loopIndex;
    }
    return undefined;
  }
  // next
  const next = sorted.find((l) => l.loopIndex > currentLoopIndex);
  return next?.loopIndex;
}
