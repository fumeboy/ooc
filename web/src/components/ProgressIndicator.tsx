/**
 * ProgressIndicator — 迭代进度指示器
 *
 * 展示当前 Flow 的 ThinkLoop 迭代进度。
 * 位于 MessageDock 顶部。
 */
import { useAtomValue } from "jotai";
import { flowProgressAtom } from "../store/progress";

/** 根据进度比例返回颜色 class */
function getProgressColor(ratio: number): string {
  if (ratio > 0.8) return "bg-red-500";
  if (ratio > 0.6) return "bg-amber-500";
  return "bg-[var(--primary)]";
}

export function ProgressIndicator() {
  const progress = useAtomValue(flowProgressAtom);
  if (!progress) return null;

  const flowRatio = progress.iterations / progress.maxIterations;
  const globalRatio = progress.totalIterations / progress.maxTotalIterations;
  const ratio = Math.max(flowRatio, globalRatio);
  const percent = Math.min(ratio * 100, 100);
  const colorClass = getProgressColor(ratio);

  return (
    <div className="px-4 py-2 shrink-0">
      <div className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)] mb-1">
        <span>迭代进度</span>
        <span>{progress.iterations} / {progress.maxIterations}</span>
      </div>
      <div className="h-1 rounded-full bg-[var(--muted)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
