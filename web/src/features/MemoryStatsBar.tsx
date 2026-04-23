/**
 * MemoryStatsBar —— Stone Memory tab 顶部的健康度统计条（Phase 4）
 *
 * 展示字段：
 * - total entries
 * - pinned（高亮）
 * - avg age（天）
 * - latest curation 时间 + merged/kept
 *
 * 额外提供一个"立即 curate"按钮，点击后调 /api/stones/:name/memory/curate
 * 拉一次最新 stats 并刷新视图。
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation_phase2.md — Phase 4
 * @ref kernel/web/src/api/client.ts — depends — fetchMemoryStats, triggerMemoryCuration
 */

import { useEffect, useState } from "react";
import { fetchMemoryStats, triggerMemoryCuration, type MemoryStats } from "../api/client";

interface Props {
  objectName: string;
}

/** 把 ISO 时间串格式化成"N 分钟前 / N 小时前 / YYYY-MM-DD" */
function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return iso;
  const diffMs = Date.now() - d;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return iso.slice(0, 10);
}

export function MemoryStatsBar({ objectName }: Props) {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const s = await fetchMemoryStats(objectName);
      setStats(s);
    } catch (e: any) {
      setErr(e?.message ?? "加载 memory stats 失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    /* 不做轮询——curator 后端 5 分钟级别刷新，用户点"curate now"或切 tab 再拉就够 */
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [objectName]);

  const onCurate = async () => {
    setLoading(true);
    setErr(null);
    try {
      await triggerMemoryCuration(objectName);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "触发 curation 失败");
    } finally {
      setLoading(false);
    }
  };

  if (err) {
    return (
      <div className="text-xs text-[var(--destructive)] mb-3">Memory 统计加载失败：{err}</div>
    );
  }

  if (!stats) {
    return (
      <div className="text-xs text-[var(--muted-foreground)] mb-3">加载 Memory 统计中…</div>
    );
  }

  const lastC = stats.lastCuration;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs mb-3 px-3 py-2 rounded-md bg-[var(--accent)] border border-[var(--border)]">
      <Stat label="Total" value={String(stats.total)} />
      <Stat label="Pinned" value={String(stats.pinned)} tone="primary" />
      <Stat label="Avg Age" value={stats.total > 0 ? `${stats.avgAgeDays} 天` : "—"} />
      <Stat label="Latest Entry" value={formatRelative(stats.latestCreatedAt)} />
      <Stat
        label="Last Curation"
        value={
          lastC
            ? `${formatRelative(lastC.at)} · merged=${lastC.merged} kept=${lastC.kept}` +
              (lastC.gc ? ` · gc[expired=${lastC.gc.expired} deleted=${lastC.gc.deleted}${lastC.gc.dryRun ? " dry-run" : ""}]` : "")
            : "从未运行"
        }
      />
      <button
        onClick={onCurate}
        disabled={loading}
        className="ml-auto px-2 py-0.5 rounded-md text-[var(--primary-foreground)] bg-[var(--primary)] hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading ? "…" : "立即 Curate"}
      </button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[var(--muted-foreground)]">{label}:</span>
      <span
        className={
          tone === "primary"
            ? "font-medium text-[var(--primary)]"
            : "font-medium text-[var(--foreground)]"
        }
      >
        {value}
      </span>
    </div>
  );
}
