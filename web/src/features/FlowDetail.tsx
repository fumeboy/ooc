/**
 * FlowDetail —— Flow 详情视图
 *
 * 2026-04-21 旧 Flow 架构退役：删除 PausedPanel（线程树架构的 pause 走文件级调试，
 * 不再通过 HTTP JSON 字段暴露）。保留 Messages / Process 两个 subtab。
 *
 * @ref docs/哲学文档/gene.md#G2 — renders — Flow 状态机（running/waiting/finished/failed）
 * @ref docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 * @ref src/types/flow.ts — references — FlowData, FlowMessage 类型
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { lastFlowEventAtom } from "../store/session";
import { fetchFlow } from "../api/client";
import type { FlowData, FlowMessage } from "../api/types";
import { cn } from "../lib/utils";
import { StatusBadge } from "../components/ui/Badge";
import { ProcessView } from "./ProcessView";

interface FlowDetailProps {
  objectName: string;
  sessionId: string;
}

const SUB_TABS = ["Messages", "Process"] as const;
type SubTab = (typeof SUB_TABS)[number];

export function FlowDetail({ objectName, sessionId }: FlowDetailProps) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("Messages");
  const lastEvent = useAtomValue(lastFlowEventAtom);

  useEffect(() => {
    setFlow(null);
    fetchFlow(sessionId).then(setFlow).catch(console.error);
  }, [objectName, sessionId]);

  /* SSE 实时更新：当收到与当前 Flow 相关的事件时，重新 fetch */
  useEffect(() => {
    if (!lastEvent || !flow) return;
    if ("sessionId" in lastEvent && lastEvent.sessionId === sessionId) {
      fetchFlow(sessionId).then(setFlow).catch(console.error);
    }
  }, [lastEvent]);

  if (!flow) {
    return <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <span className="text-sm font-mono text-[var(--muted-foreground)]">{flow.sessionId.slice(0, 12)}</span>
        <StatusBadge status={flow.status} />
      </div>

      {/* Underline tabs */}
      <div className="flex gap-0 mb-5 border-b border-[var(--border)]">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={cn(
              "px-3 pb-2 text-sm transition-colors relative",
              subTab === t
                ? "text-[var(--foreground)] font-medium"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {t}
            {t === "Messages" && ` (${flow.messages.length})`}
            {subTab === t && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--foreground)] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {subTab === "Messages" && <MessagesView messages={flow.messages} />}
      {subTab === "Process" && flow.process && (
        <ProcessView process={flow.process} />
      )}
      {subTab === "Process" && !flow.process && (
        <p className="text-sm text-[var(--muted-foreground)]">(暂无 process 数据)</p>
      )}
    </div>
  );
}

function MessagesView({ messages }: { messages: FlowMessage[] }) {
  if (messages.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">(无消息)</p>;
  }

  return (
    <div className="space-y-3">
      {messages.map((msg, i) => (
        <div key={i}>
          <span className="text-xs text-[var(--muted-foreground)]">
            {msg.from} → {msg.to}
          </span>
          <p className="text-sm mt-0.5 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        </div>
      ))}
    </div>
  );
}
