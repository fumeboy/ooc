/**
 * FlowView — 单个 Flow 对象的详情视图
 *
 * Tabs: Process / Data / Memory / UI
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
import { EffectsTab } from "./EffectsTab";
import { DynamicUI } from "./DynamicUI";
import { CodeMirrorViewer } from "../components/ui/CodeMirrorViewer";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { cn } from "../lib/utils";
import { X } from "lucide-react";
import type { FlowData, StoneData } from "../api/types";

interface FlowViewProps {
  /** session ID（顶层 sessionId） */
  sessionId: string;
  /** flow 所属的对象名称 */
  objectName: string;
  /** 初始 tab（由路由指定） */
  initialTab?: string;
}

/* tabs 与 ObjectDetail 对齐：Process / Data / Effects / Memory (+View)
 * 注：FlowView 没有 Readme tab（Readme 作为背景底层已经始终可见） */
const BASE_TABS = ["Process", "Data", "Effects", "Memory"] as const;
type Tab = "Process" | "Data" | "Effects" | "Memory" | "View" | null;

export function FlowView({ sessionId, objectName, initialTab }: FlowViewProps) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [stone, setStone] = useState<StoneData | null>(null);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || null);
  const [hasView, setHasView] = useState(false);
  /** 默认加载的 view 名称（main 优先，否则取第一个） */
  const [defaultViewName, setDefaultViewName] = useState<string | null>(null);
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

  /* 检查该对象是否有 views/ 目录（任一 view） */
  useEffect(() => {
    fetchSessionTree(sessionId).then((tree) => {
      const objectsDir = tree.children?.find((c) => c.name === "objects");
      const objectDir = objectsDir?.children?.find((c) => c.name === objectName);
      const viewsDir = objectDir?.children?.find((c) => c.name === "views");
      const viewDirs = viewsDir?.children?.filter((c) => c.type === "directory") ?? [];
      const viewNames = viewDirs.map((d) => d.name);
      const found = viewNames.length > 0;
      setHasView(found);
      setDefaultViewName(viewNames.includes("main") ? "main" : (viewNames[0] ?? null));
      if (found && !initialTab) {
        setTab("View");
      } else if (!found && initialTab === "View") {
        /* initialTab 指定了 View 但实际没有 views/ 目录，回退到 Readme */
        setTab(null);
      }
    }).catch(() => setHasView(false));
  }, [sessionId, objectName, initialTab]);

  const tabs: Tab[] = hasView ? [...BASE_TABS, "View"] : [...BASE_TABS];

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
              {tab === "Process" && (
                (process as any)?.isThreadTree
                  ? <ThreadsTreeView process={process} sessionId={sessionId} objectName={objectName} />
                  : <ProcessView process={process} />
              )}
              {tab === "Data" && (
                <SplitDataTab sessionId={sessionId} objectName={objectName} stoneData={stone?.data} />
              )}
              {tab === "Effects" && (
                <EffectsTab objectName={objectName} />
              )}
              {tab === "Memory" && (
                <FlowMemoryTab sessionId={sessionId} objectName={objectName} />
              )}
              {tab === "View" && defaultViewName && (
                <DynamicUI
                  importPath={`@flows/${sessionId}/objects/${objectName}/views/${defaultViewName}/frontend.tsx`}
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