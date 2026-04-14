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
import { ThreadsTreeView } from "./ThreadsTreeView";
import { DynamicUI } from "./DynamicUI";
import { ActionCard, TalkCard } from "../components/ui/ActionCard";
import { CodeMirrorViewer } from "../components/ui/CodeMirrorViewer";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { cn } from "../lib/utils";
import { X } from "lucide-react";
import type { FlowData, FlowMessage, Action, TimelineEntry, StoneData } from "../api/types";

interface FlowViewProps {
  /** session ID（顶层 sessionId） */
  sessionId: string;
  /** flow 所属的对象名称 */
  objectName: string;
  /** 初始 tab（由路由指定） */
  initialTab?: string;
}

const BASE_TABS = ["Timeline", "Process", "Data", "Memory"] as const;
type Tab = "Timeline" | "Process" | "Data" | "Memory" | "UI" | null;

export function FlowView({ sessionId, objectName, initialTab }: FlowViewProps) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [stone, setStone] = useState<StoneData | null>(null);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || null);
  const [hasUI, setHasUI] = useState(false);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => {
    setFlow(null);
    setStone(null);
    setTab((initialTab as Tab) || null);
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
    if ("sessionId" in lastEvent && lastEvent.sessionId === sessionId) {
      fetchFlow(sessionId).then(setFlow).catch(console.error);
    }
  }, [lastEvent]);

  /* 检查该对象是否有 ui/pages/ 目录 */
  useEffect(() => {
    fetchSessionTree(sessionId).then((tree) => {
      const objectsDir = tree.children?.find((c) => c.name === "objects");
      const objectDir = objectsDir?.children?.find((c) => c.name === objectName);
      const uiDir = objectDir?.children?.find((c) => c.name === "ui");
      const pagesDir = uiDir?.children?.find((c) => c.name === "pages");
      const found = !!pagesDir;
      setHasUI(found);
      if (found && !initialTab) {
        setTab("UI");
      } else if (!found && initialTab === "UI") {
        /* initialTab 指定了 UI 但实际没有 UI 目录，回退到 Readme */
        setTab(null);
      }
    }).catch(() => setHasUI(false));
  }, [sessionId, objectName, initialTab]);

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

  const collectActions = (node: any): (Action & { _origIndex: number })[] => {
    const actions: (Action & { _origIndex: number })[] = [];
    let index = 0;
    const walk = (n: any) => {
      for (const a of n.actions ?? []) {
        actions.push({ ...a, _origIndex: index++ });
      }
      for (const child of n.children ?? []) {
        walk(child);
      }
    };
    walk(node);
    return actions;
  };
  const actions = collectActions(process.root);

  const timeline: TimelineEntry[] = [
    ...objectMessages.map((m): TimelineEntry => ({ kind: "message", data: m, objectName })),
    ...actions.map((a): TimelineEntry => ({ kind: "action", data: a, objectName })),
  ].sort((a, b) => {
    const ta = a.kind === "message" ? a.data.timestamp : a.kind === "action" ? a.data.timestamp : 0;
    const tb = b.kind === "message" ? b.data.timestamp : b.kind === "action" ? b.data.timestamp : 0;
    if (ta !== tb) return ta - tb;
    // 时间戳相同时：
    // - 如果都是 action，按先序遍历的原始顺序排列
    // - 如果是 message 和 action，保持它们在原始数组中的相对顺序
    if (a.kind === "action" && b.kind === "action") {
      return (a.data as any)._origIndex - (b.data as any)._origIndex;
    }
    return 0;
  });

  return (
    <div className="h-full flex flex-col">
      {/* 头部：左侧信息 + 右侧 Tabs 同行 */}
      <div className="flex items-center justify-between px-4 sm:px-8 py-2 gap-4 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <ObjectAvatar name={objectName} size="md" />
          <h2 className="text-lg sm:text-xl font-bold leading-none truncate" style={{ fontFamily: "var(--heading-font)" }}>
            {objectName}
          </h2>
          <StatusBadge status={status} />
        </div>

        {/* Tab 按钮组 */}
        <div className="flex items-center bg-[var(--accent)] rounded-lg p-0.5 overflow-x-auto scrollbar-hide shrink-0">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(tab === t ? null : t)}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition-all whitespace-nowrap shrink-0",
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

      {/* 内容区：Readme 底层 + 抽屉覆盖 */}
      <div className="flex-1 relative overflow-hidden">
        {/* Readme 主内容（始终渲染） */}
        <div className="absolute inset-0 overflow-auto px-4 sm:px-8 py-4 sm:py-6">
          <ObjectReadmeView objectName={objectName} />
        </div>

        {/* 底部抽屉：从底部升起 */}
        {tab && (
          <div
            className="absolute mx-2 bottom-0 left-0 right-0 bg-[var(--card)] border border-border rounded-t-xl shadow-xl h-[90%] animate-in slide-in-from-bottom duration-300"
          >
            {/* iOS 风格装饰条 */}
            <div
              className="flex items-center justify-center py-2 cursor-pointer"
              onClick={() => setTab(null)}
            >
              <div className="w-16 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* 抽屉头部：标题 + 关闭按钮 */}
            <div className="flex items-center justify-between px-4 pb-2 shrink-0">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">{tab}</span>
              <button
                onClick={() => setTab(null)}
                className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
                title="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 抽屉内容 */}
            <div className="h-[calc(100%-56px)] overflow-auto px-4 pb-4">
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
              {tab === "Process" && (
                (process as any)?.isThreadTree
                  ? <ThreadsTreeView process={process} sessionId={sessionId} objectName={objectName} />
                  : <ProcessView process={process} />
              )}
              {tab === "Data" && (
                <SplitDataTab sessionId={sessionId} objectName={objectName} stoneData={stone?.data} />
              )}
              {tab === "Memory" && (
                <FlowMemoryTab sessionId={sessionId} objectName={objectName} />
              )}
              {tab === "UI" && (
                <DynamicUI
                  importPath={`@flows/${sessionId}/objects/${objectName}/ui/pages/index.tsx`}
                  componentProps={{ sessionId, objectName }}
                />
              )}
            </div>
          </div>
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
    const path = `flows/${sessionId}/objects/${objectName}/data.json`;
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
    const path = `flows/${sessionId}/objects/${objectName}/memory.md`;
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