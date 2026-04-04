/**
 * EffectsTab —— Sessions（Flow 列表）展示
 *
 * @ref docs/哲学文档/gene.md#G2 — renders — Flow 列表（sessionId, status, 时间）
 * @ref docs/哲学文档/gene.md#G8 — renders — flows/ 目录下的任务执行记录
 * @ref docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { fetchSessions } from "../api/client";
import { lastFlowEventAtom } from "../store/session";
import { FlowDetail } from "./FlowDetail";
import { StatusBadge } from "../components/ui/Badge";
import { cn } from "../lib/utils";
import type { FlowSummary } from "../api/types";

interface EffectsTabProps {
  objectName: string;
}

export function EffectsTab({ objectName }: EffectsTabProps) {
  const [effects, setEffects] = useState<FlowSummary[] | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const lastEvent = useAtomValue(lastFlowEventAtom);

  useEffect(() => {
    setEffects(null);
    setSelectedTaskId(null);
    fetchSessions().then(setEffects).catch(console.error);
  }, [objectName]);

  /* SSE 实时更新：收到当前对象的 flow 事件时刷新列表 */
  useEffect(() => {
    if (!lastEvent) return;
    if ("objectName" in lastEvent && lastEvent.objectName === objectName) {
      fetchSessions().then(setEffects).catch(console.error);
    }
  }, [lastEvent]);

  if (!effects) {
    return <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>;
  }

  if (selectedTaskId) {
    return (
      <div>
        <button
          onClick={() => setSelectedTaskId(null)}
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-4"
        >
          ← 返回列表
        </button>
        <FlowDetail objectName={objectName} sessionId={selectedTaskId} />
      </div>
    );
  }

  if (effects.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">(暂无 effects)</p>;
  }

  return (
    <div className="space-y-0.5">
      {effects.map((e) => (
        <button
          key={e.sessionId}
          onClick={() => setSelectedTaskId(e.sessionId)}
          className={cn(
            "w-full text-left rounded px-3 py-2.5",
            "hover:bg-[var(--accent)] transition-colors",
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">
              {formatTime(e.createdAt)}
            </span>
            <StatusBadge status={e.status} />
            <span className="ml-auto text-xs text-[var(--muted-foreground)]">
              {e.messageCount} msg · {e.actionCount} act
            </span>
          </div>
          {e.firstMessage && (
            <p className="text-sm mt-1 truncate">
              {e.firstMessage}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}hr ago`;
  return new Date(ts).toLocaleDateString();
}
