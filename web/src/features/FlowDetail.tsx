/**
 * FlowDetail —— Flow 详情视图
 *
 * @ref docs/哲学文档/gene.md#G2 — renders — Flow 状态机（running/waiting/finished/failed）
 * @ref docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 * @ref src/types/flow.ts — references — FlowData, FlowMessage 类型
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { lastFlowEventAtom } from "../store/session";
import { fetchFlow, resumeFlow } from "../api/client";
import type { FlowData, FlowMessage } from "../api/types";
import { cn } from "../lib/utils";
import { StatusBadge } from "../components/ui/Badge";
import { CodeBlock } from "../components/ui/CodeBlock";
import { ProcessView } from "./ProcessView";

interface FlowDetailProps {
  objectName: string;
  taskId: string;
}

const SUB_TABS = ["Messages", "Process"] as const;
type SubTab = (typeof SUB_TABS)[number];

export function FlowDetail({ objectName, taskId }: FlowDetailProps) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("Messages");
  const [resuming, setResuming] = useState(false);
  const lastEvent = useAtomValue(lastFlowEventAtom);

  useEffect(() => {
    setFlow(null);
    fetchFlow(taskId).then(setFlow).catch(console.error);
  }, [objectName, taskId]);

  /* SSE 实时更新：当收到与当前 Flow 相关的事件时，重新 fetch */
  useEffect(() => {
    if (!lastEvent || !flow) return;
    if ("taskId" in lastEvent && lastEvent.taskId === taskId) {
      fetchFlow(taskId).then(setFlow).catch(console.error);
    }
  }, [lastEvent]);

  if (!flow) {
    return <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>;
  }

  const pendingOutput = flow.data?._pendingOutput as string | undefined;
  const pausedContext = flow.data?._pausedContext as { systemPrompt: string; chatMessages: { role: string; content: string }[] } | undefined;

  const handleResume = async () => {
    setResuming(true);
    try {
      await resumeFlow(objectName, flow.taskId);
      const updated = await fetchFlow(taskId);
      setFlow(updated);
    } catch (e) {
      console.error(e);
    } finally {
      setResuming(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <span className="text-sm font-mono text-[var(--muted-foreground)]">{flow.taskId.slice(0, 12)}</span>
        <StatusBadge status={flow.status} />
      </div>

      {/* 暂停状态面板 */}
      {flow.status === "pausing" && pendingOutput && (
        <PausedPanel
          pendingOutput={pendingOutput}
          pausedContext={pausedContext}
          onResume={handleResume}
          resuming={resuming}
        />
      )}

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

/** 暂停状态面板：显示 context + pending output + 恢复按钮 */
function PausedPanel({
  pendingOutput,
  pausedContext,
  onResume,
  resuming,
}: {
  pendingOutput: string;
  pausedContext?: { systemPrompt: string; chatMessages: { role: string; content: string }[] };
  onResume: () => void;
  resuming: boolean;
}) {
  const [showContext, setShowContext] = useState(false);

  return (
    <div className="mb-5 rounded bg-[var(--warm-muted)] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Flow 已暂停</span>
        <button
          onClick={onResume}
          disabled={resuming}
          className="px-3 py-1 text-xs rounded bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {resuming ? "恢复中..." : "恢复执行"}
        </button>
      </div>

      {/* 待执行的 LLM Output */}
      <div className="mb-2">
        <p className="text-xs text-[var(--muted-foreground)] mb-1">待执行的 LLM Output:</p>
        <CodeBlock maxHeight="max-h-60">{pendingOutput}</CodeBlock>
      </div>

      {/* Context（可折叠） */}
      {pausedContext && (
        <div>
          <button
            onClick={() => setShowContext(!showContext)}
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {showContext ? "▾ 收起 Context" : "▸ 查看 Context"}
          </button>
          {showContext && (
            <div className="mt-2 space-y-2">
              <div>
                <p className="text-xs text-[var(--muted-foreground)] mb-1">System Prompt:</p>
                <CodeBlock maxHeight="max-h-60">{pausedContext.systemPrompt}</CodeBlock>
              </div>
              {pausedContext.chatMessages.length > 0 && (
                <div>
                  <p className="text-xs text-[var(--muted-foreground)] mb-1">Chat Messages:</p>
                  <div className="space-y-1">
                    {pausedContext.chatMessages.map((m, i) => (
                      <div key={i} className="text-xs font-mono bg-[var(--card)] rounded p-2">
                        <span className="text-[var(--muted-foreground)]">[{m.role}]</span>
                        <pre className="whitespace-pre-wrap mt-0.5 overflow-auto max-h-40">{m.content}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
