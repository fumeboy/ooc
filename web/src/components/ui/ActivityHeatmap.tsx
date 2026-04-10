/**
 * ActivityHeatmap — 当月使用热力图
 *
 * 模仿 GitHub commit 热力图，用格子展示用户当月每天使用 OOC 系统的次数。
 * 数据来源：sessions 列表的 createdAt 时间戳。
 */
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { userSessionsAtom } from "../../store/session";
import { cn } from "../../lib/utils";

/** 热力颜色等级（0-4） */
const HEAT_COLORS = [
  "bg-[var(--accent)]",           // 0: 无活动
  "bg-emerald-200 dark:bg-emerald-900",  // 1: 少量
  "bg-emerald-300 dark:bg-emerald-700",  // 2: 中等
  "bg-emerald-400 dark:bg-emerald-600",  // 3: 较多
  "bg-emerald-500 dark:bg-emerald-500",  // 4: 大量
];

function getHeatLevel(count: number): number {
  if (count === 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** 获取当月的天数 */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** 获取当月第一天是星期几（0=周日） */
function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const MONTH_NAMES = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

export function ActivityHeatmap() {
  const sessions = useAtomValue(userSessionsAtom);

  const { year, month, days, dayCounts, totalSessions } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const daysInMonth = getDaysInMonth(y, m);

    /* 统计当月每天的 session 数 */
    const counts = new Map<number, number>();
    for (const s of sessions) {
      const ts = s.createdAt ?? s.updatedAt;
      if (!ts) continue;
      const d = new Date(ts);
      if (d.getFullYear() === y && d.getMonth() === m) {
        const day = d.getDate();
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
    }

    const dayArr = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);

    return { year: y, month: m, days: dayArr, dayCounts: counts, totalSessions: total };
  }, [sessions]);

  const firstDayOfWeek = getFirstDayOfWeek(year, month);
  const today = new Date().getDate();

  /* 构建网格：7 行（周日-周六）× N 列 */
  const totalCells = firstDayOfWeek + days.length;
  const cols = Math.ceil(totalCells / 7);

  return (
    <div className="px-3 py-3 shrink-0 w-full">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {MONTH_NAMES[month]} {year}
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {totalSessions} sessions
        </span>
      </div>

      {/* 热力图网格 */}
      <div className="flex gap-[3px]">
        {/* 周标签 */}
        <div className="flex flex-col gap-[3px] shrink-0">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="w-3 h-3 flex items-center justify-center text-[7px] text-[var(--muted-foreground)]"
            >
              {i % 2 === 1 ? label : ""}
            </div>
          ))}
        </div>

        {/* 格子列 */}
        {Array.from({ length: cols }, (_, col) => (
          <div key={col} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, row) => {
              const cellIndex = col * 7 + row;
              const dayNum = cellIndex - firstDayOfWeek + 1;
              const isValidDay = dayNum >= 1 && dayNum <= days.length;

              if (!isValidDay) {
                return <div key={row} className="w-3 h-3" />;
              }

              const count = dayCounts.get(dayNum) ?? 0;
              const level = getHeatLevel(count);
              const isToday = dayNum === today;

              return (
                <div
                  key={row}
                  className={cn(
                    "w-3 h-3 rounded-[2px] transition-colors",
                    HEAT_COLORS[level],
                    isToday && "ring-1 ring-[var(--foreground)] ring-offset-1 ring-offset-[var(--panel-bg)]",
                  )}
                  title={`${month + 1}月${dayNum}日: ${count} sessions`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
