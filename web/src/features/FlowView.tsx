/**
 * FlowView — 单个 Flow 对象的详情视图
 *
 * Tabs: Timeline / Process / Readme / Data / UI
 * Data tab 使用分栏设计：左栏 Flow data，右栏 Stone data。
 *
 * @ref docs/哲学文档/gene.md#G2 — renders — Flow 状态机
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { lastFlowEventAtom, refreshKeyAtom } from "../store/session";
import { fetchFlow, fetchSessionTree, fetchFileContent, fetchObject } from "../api/client";
import { StatusBadge } from "../components/ui/Badge";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { ObjectReadmeView } from "./ObjectReadmeView";
import { ProcessView } from "./ProcessView";
import { DynamicUI } from "./DynamicUI";
import { ActionCard, TalkCard } from "../components/ui/ActionCard";
import { CodeMirrorViewer } from "../components/ui/CodeMirrorViewer";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { cn } from "../lib/utils";
import type { FlowData, FlowMessage, Action, TimelineEntry, StoneData } from "../api/types";

interface FlowViewProps {
  /** session ID（顶层 taskId） */
  sessionId: string;
  /** flow 所属的对象名称 */
  objectName: string;
  /** 初始 tab（由路由指定） */
  initialTab?: string;
}

const BASE_TABS = ["Timeline", "Process", "Readme", "Data", "Memory"] as const;
type Tab = "Timeline" | "Process" | "Readme" | "Data" | "Memory" | "UI";

export function FlowView({ sessionId, objectName, initialTab }: FlowViewProps) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [stone, setStone] = useState<StoneData | null>(null);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "Timeline");
  const [hasUI, setHasUI] = useState(false);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => {
    setFlow(null);
    setStone(null);
    setTab((initialTab as Tab) || "Timeline");
    fetchFlow(sessionId).then(setFlow).catch(console.error);
    fetchObject(objectName).then(setStone).catch(() => setStone(null));
  }, [sessionId, objectName, refreshKey]);

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

  /* 检查该对象是否有 files/ui/ 目录 */
  useEffect(() => {
    fetchSessionTree(sessionId).then((tree) => {
      const flowsDir = tree.children?.find((c) => c.name === "flows");
      const objectDir = flowsDir?.children?.find((c) => c.name === objectName);
      const filesDir = objectDir?.children?.find((c) => c.name === "files");
      const uiDir = filesDir?.children?.find((c) => c.name === "ui");
      const found = !!uiDir;
      setHasUI(found);
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

  /* 构建该对象的时间线 */
  const objectMessages = flow.messages.filter(
    (m) => m.from === objectName || m.to === objectName
  );

  const collectActions = (node: any): Action[] => {
    const actions: Action[] = [...(node.actions ?? [])];
    for (const child of node.children ?? []) {
      actions.push(...collectActions(child));
    }
    return actions;
  };
  const actions = collectActions(process.root);

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
      {/* 头部：左侧信息 + 右侧 Tabs 同行 */}
      <div className="flex items-center justify-between px-4 sm:px-8 py-2 gap-4 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <ObjectAvatar name={objectName} size="md" />
          <h2 className="text-lg sm:text-xl font-bold leading-none" style={{ fontFamily: "var(--heading-font)" }}>
            {objectName}
          </h2>
          <StatusBadge status={status} />
        </div>

        {/* Tab 按钮组 */}
        <div className="flex items-center bg-[var(--accent)] rounded-lg p-0.5 overflow-x-auto scrollbar-hide">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition-all whitespace-nowrap",
                tab === t
                  ? "bg-[var(--card)] text-[var(--foreground)] font-medium shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t}
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
                return <TalkCard key={`msg-${i}`} msg={m} />;
              }
              if (entry.kind === "action") {
                const a = entry.data as Action;
                return <ActionCard key={`act-${i}`} action={a} objectName={objectName} />;
              }
              return null;
            })}
          </div>
        )}
        {tab === "Process" && <ProcessView process={process} />}
        {tab === "Readme" && <ObjectReadmeView objectName={objectName} />}
        {tab === "Data" && (
          <SplitDataTab sessionId={sessionId} objectName={objectName} stoneData={stone?.data} />
        )}
        {tab === "Memory" && (
          <FlowMemoryTab sessionId={sessionId} objectName={objectName} />
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

/** 分栏 Data Tab — 左栏 Flow data，右栏 Stone data */
function SplitDataTab({
  sessionId,
  objectName,
  stoneData,
}: {
  sessionId: string;
  objectName: string;
  stoneData?: Record<string, unknown>;
}) {
  const [flowContent, setFlowContent] = useState<string | null>(null);
  const refreshKey = useAtomValue(lastFlowEventAtom);

  useEffect(() => {
    const path = `flows/${sessionId}/flows/${objectName}/data.json`;
    fetchFileContent(path)
      .then((raw) => {
        try { setFlowContent(JSON.stringify(JSON.parse(raw), null, 2)); }
        catch { setFlowContent(raw); }
      })
      .catch(() => setFlowContent("{}"));
  }, [sessionId, objectName, refreshKey]);

  const stoneContent = stoneData
    ? JSON.stringify(stoneData, null, 2)
    : "{}";

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* 左栏：Flow Data */}
      <div className="flex-1 min-w-0 flex flex-col">
        <h3 className="text-xs font-medium text-[var(--muted-foreground)] mb-2 uppercase tracking-wide">
          Flow Data
        </h3>
        <div className="flex-1 overflow-auto rounded-lg border border-[var(--border)]">
          {flowContent === null
            ? <p className="text-sm text-[var(--muted-foreground)] p-3">加载中...</p>
            : <CodeMirrorViewer content={flowContent} ext="json" />
          }
        </div>
      </div>

      {/* 右栏：Stone Data */}
      <div className="flex-1 min-w-0 flex flex-col">
        <h3 className="text-xs font-medium text-[var(--muted-foreground)] mb-2 uppercase tracking-wide">
          Stone Data
        </h3>
        <div className="flex-1 overflow-auto rounded-lg border border-[var(--border)]">
          <CodeMirrorViewer content={stoneContent} ext="json" />
        </div>
      </div>
    </div>
  );
}

/** Flow Memory Tab — 展示 flow 的 memory.md */
function FlowMemoryTab({ sessionId, objectName }: { sessionId: string; objectName: string }) {
  const [content, setContent] = useState<string | null>(null);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => {
    const path = `flows/${sessionId}/flows/${objectName}/memory.md`;
    fetchFileContent(path)
      .then(setContent)
      .catch(() => setContent(""));
  }, [sessionId, objectName, refreshKey]);

  if (content === null) {
    return <p className="text-sm text-[var(--muted-foreground)] p-4">加载中...</p>;
  }

  if (!content) {
    return <p className="text-sm text-[var(--muted-foreground)] p-4">暂无记忆</p>;
  }

  return (
    <div className="p-4 overflow-auto">
      <MarkdownContent content={content} />
    </div>
  );
}