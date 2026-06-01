/**
 * LoopMiniTimeline — Round 9 E3 顶部横向 mini strip。
 *
 * 每个 loop 一个圆点；当前 loop 高亮；有关键 event 的 loop 加色块角标。
 * 单击圆点 → onSelectLoop(loopIndex)。
 *
 * 视觉（design §5）：
 *   ◯─◯─●─◯─◯─◯─◯─◯─◯─◯ ...
 *           ^
 *
 * MVP：不做"远 loop 折叠"。loop 多了 → 横向滚动 + 当前 loop scroll-into-view (smooth)。
 *
 * 关键 event 信号：父级传入 perLoopKeyEventCount: Map<loopIndex, number>；
 * 数 > 0 → 圆点加角标。颜色 / icon 暂统一（不按 type 分发）—— mini timeline 只是
 * "有没有需要关注的事"，详情看 KeyEventsBar。
 */

import { useEffect, useRef } from "react";
import type { LoopListEntry } from "./loop-types";

export interface LoopMiniTimelineProps {
  loops: LoopListEntry[];
  currentLoopIndex: number;
  /** loopIndex → 关键 event 数（用于在圆点上加角标）。 */
  perLoopKeyEventCount?: Map<number, number>;
  onSelectLoop: (loopIndex: number) => void;
}

export function LoopMiniTimeline({
  loops,
  currentLoopIndex,
  perLoopKeyEventCount,
  onSelectLoop,
}: LoopMiniTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!currentRef.current) return;
    try {
      currentRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    } catch {
      // 不支持 scrollIntoView 选项（如老浏览器 / jsdom）— 忽略，不影响功能。
    }
  }, [currentLoopIndex]);

  if (loops.length === 0) return null;

  const sorted = [...loops].sort((a, b) => a.loopIndex - b.loopIndex);

  return (
    <div className="loop-mini-timeline" ref={containerRef} data-testid="loop-mini-timeline">
      {sorted.map((entry) => {
        const isCurrent = entry.loopIndex === currentLoopIndex;
        const keyCount = perLoopKeyEventCount?.get(entry.loopIndex) ?? 0;
        return (
          <button
            key={entry.loopIndex}
            ref={isCurrent ? currentRef : null}
            type="button"
            className={`loop-mini-timeline-dot ${isCurrent ? "is-current" : ""}`}
            data-loop-index={entry.loopIndex}
            data-current={isCurrent ? "true" : "false"}
            onClick={() => onSelectLoop(entry.loopIndex)}
            title={`Loop #${String(entry.loopIndex).padStart(4, "0")}${
              keyCount > 0 ? ` · ${keyCount} key event${keyCount === 1 ? "" : "s"}` : ""
            }`}
          >
            <span className="loop-mini-timeline-dot-marker" aria-hidden>
              {isCurrent ? "●" : "○"}
            </span>
            {keyCount > 0 && (
              <span
                className="loop-mini-timeline-event-flag"
                data-testid={`loop-mini-timeline-flag-${entry.loopIndex}`}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
