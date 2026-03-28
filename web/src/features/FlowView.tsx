/**
 * FlowView — 单个 Flow 对象的详情视图（Messages + Process 标签页）
 *
 * 类似 ObjectDetail 的布局，展示 Flow 的消息列表和行为树。
 * 点击文件树中带 .flow marker 的目录时展示此组件。
 *
 * @ref docs/哲学文档/gene.md#G2 — renders — Flow 状态机
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { lastFlowEventAtom } from "../store/session";
import { fetchFlow, fetchSessionTree, fetchFileContent } from "../api/client";
import { StatusBadge } from "../components/ui/Badge";
import { ProcessView } from "./ProcessView";
import { DynamicUI } from "./DynamicUI";
import { ActionCard, TalkCard } from "../components/ui/ActionCard";
import { CodeMirrorViewer } from "../components/ui/CodeMirrorViewer";
import { cn } from "../lib/utils";
import type { FlowData, FlowMessage, Action, TimelineEntry } from "../api/types";

interface FlowViewProps {
  /** session ID（顶层 taskId） */
  sessionId: string;
  /** flow 所属的对象名称 */
  objectName: string;
  /** 初始 tab（由路由指定） */
  initialTab?: string;
}

const BASE_TABS = ["Timeline", "Process", "Data"] as const;
type Tab = "Timeline" | "Process" | "Data" | "UI";

export function FlowView({ sessionId, objectName, initialTab }: FlowViewProps) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "Timeline");
  const [hasUI, setHasUI] = useState(false);
  const lastEvent = useAtomValue(lastFlowEventAtom);

  useEffect(() => {
    setFlow(null);
    setTab((initialTab as Tab) || "Timeline");
    fetchFlow(sessionId).then((data) => {
      /* 如果请求的是 sub-flow 对象，从 subFlows 中找到对应的 process */
      setFlow(data);
    }).catch(console.error);
  }, [sessionId, objectName]);

  /* initialTab 变化时切换 tab（同一 FlowView 内切换子文件） */
  useEffect(() => {
    if (initialTab) setTab(initialTab as Tab);
  }, [initialTab]);

  /* SSE 实时更新 */
  useEffect(() => {
    if (!lastEvent || !flow) return;
    if ("taskId" in lastEvent && lastEvent.taskId === sessionId) {
      fetchFlow(sessionId).then(setFlow).catch(console.error);
    }
  }, [lastEvent]);

  /* 检查该对象是否有 files/ui/ 目录（通过文件树数据判断） */
  useEffect(() => {
    fetchSessionTree(sessionId).then((tree) => {
      const flowsDir = tree.children?.find((c) => c.name === "flows");
      const objectDir = flowsDir?.children?.find((c) => c.name === objectName);
      const filesDir = objectDir?.children?.find((c) => c.name === "files");
      const uiDir = filesDir?.children?.find((c) => c.name === "ui");
      const found = !!uiDir;
      setHasUI(found);
      /* 有自定义 UI 且无外部指定 tab 时，默认展示 UI Tab */
      if (found && !initialTab) setTab("UI");
    }).catch(() => setHasUI(false));
  }, [sessionId, objectName]);

  const tabs: Tab[] = hasUI ? [...BASE_TABS, "UI"] : [...BASE_TABS];

  if (!flow) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--muted-foreground)] text-sm">
        加载中...
      </div>
    );
  }

  /* 找到该对象的 sub-flow process（如果有） */
  const subFlow = (flow as any).subFlows?.find((sf: any) => sf.stoneName === objectName);
  const process = subFlow?.process ?? flow.process;
  const status = subFlow?.status ?? flow.status;

  /* 构建该对象的时间线（只展示与该对象相关的消息和 action） */
  const objectMessages = flow.messages.filter(
    (m) => m.from === objectName || m.to === objectName
  );

  /* 从 process 中收集 actions */
  const collectActions = (node: any): Action[] => {
    const actions: Action[] = [...(node.actions ?? [])];
    for (const child of node.children ?? []) {
      actions.push(...collectActions(child));
    }
    return actions;
  };
  const actions = collectActions(process.root);

  /* 合并为时间线 */
  const timeline: TimelineEntry[] = [
    ...objectMessages.map((m): TimelineEntry => ({ kind: "message", data: m, objectName })),
    ...actions.map((a): TimelineEntry => ({ kind: "action", data: a, objectName })),
  ].sort((a, b) => {
    const ta = a.kind === "message" ? a.data.timestamp : a.kind === "action" ? a.data.timestamp : 0;
    const tb = b.kind === "message" ? b.data.timestamp : b.kind === "action" ? b.data.timestamp : 0;
    return ta - tb;
  });

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 sm:px-8 pt-6 sm:pt-10 pb-0">
        <div className="flex items-center gap-3">
          <h2
            className="text-2xl sm:text-3xl font-bold"
            style={{ fontFamily: "var(--heading-font)" }}
          >
            {objectName}
          </h2>
          <StatusBadge status={status} />
        </div>
        <p className="text-[var(--muted-foreground)] mt-1 text-xs font-mono">
          {flow.taskId.slice(0, 20)}
        </p>

        {/* Tab 栏 */}
        <div className="flex gap-0 mt-4 sm:mt-6 border-b border-[var(--border)] overflow-x-auto scrollbar-hide">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 pb-2 text-sm transition-colors relative whitespace-nowrap",
                tab === t
                  ? "text-[var(--foreground)] font-medium"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t}
              {tab === t && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--foreground)] rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-4 sm:py-6">
        {tab === "Timeline" && (
          <div className="space-y-2">
            {timeline.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">暂无记录</p>
            )}
            {timeline.map((entry, i) => {
              if (entry.kind === "message") {
                const m = entry.data as FlowMessage;
                return (
                  <TalkCard key={`msg-${i}`} msg={m} />
                );
              }
              if (entry.kind === "action") {
                const a = entry.data as Action;
                return (
                  <ActionCard key={`act-${i}`} action={a} objectName={objectName} />
                );
              }
              return null;
            })}
          </div>
        )}
        {tab === "Process" && <ProcessView process={process} />}
        {tab === "Data" && (
          <FlowDataTab sessionId={sessionId} objectName={objectName} />
        )}
        {tab === "UI" && (
          <DynamicUI
            importPath={`@flows/${sessionId}/flows/${objectName}/files/ui/index.tsx`}
            componentProps={{ sessionId, objectName }}
          />
        )}
      </div>
    </div>
  );
}

/** Flow Data Tab — 展示 flow 的 data.json */
function FlowDataTab({ sessionId, objectName }: { sessionId: string; objectName: string }) {
  const [content, setContent] = useState<string | null>(null);
  const refreshKey = useAtomValue(lastFlowEventAtom);

  useEffect(() => {
    const path = `flows/${sessionId}/flows/${objectName}/data.json`;
    fetchFileContent(path)
      .then((raw) => {
        try { setContent(JSON.stringify(JSON.parse(raw), null, 2)); }
        catch { setContent(raw); }
      })
      .catch(() => setContent("(无法加载 data.json)"));
  }, [sessionId, objectName, refreshKey]);

  if (content === null) {
    return <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>;
  }

  return <CodeMirrorViewer content={content} ext="json" />;
}
