/**
 * 视图注册 — 所有 Editor Tab Content 组件的注册
 *
 * 每个组件通过 viewRegistry.register() 注册，提供：
 * - match: 路径匹配函数
 * - priority: 优先级（高优先）
 * - tabKey: tab 合并键（相同 key 复用同一个 tab）
 * - tabLabel: tab 显示名
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { refreshKeyAtom } from "../store/session";
import { fetchFileContent } from "../api/client";
import { viewRegistry, type ViewProps } from "./registry";
import { cn } from "../lib/utils";
import { ObjectDetail } from "../features/ObjectDetail";
import { FlowView } from "../features/FlowView";
import { SessionGantt } from "../features/SessionGantt";
import { DynamicUI } from "../features/DynamicUI";
import { ProcessView } from "../features/ProcessView";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { CodeMirrorViewer } from "../components/ui/CodeMirrorViewer";
import { hasCustomUI } from "../objects";
import { talkTo } from "../api/client";
import type { Process } from "../api/types";
import type { StoneUIProps } from "../types/stone-ui";

/* ── 适配器组件：将 { path } 转换为各组件需要的 props ── */

/** Stone 适配器 — 从 path 提取 objectName 和 initialTab */
function StoneViewAdapter({ path }: ViewProps) {
  const name = path.match(/^stones\/([^/]+)/)?.[1] ?? "";
  /* 子路径 → initialTab */
  let initialTab: string | undefined;
  if (path.endsWith("/readme.md")) initialTab = "Readme";
  else if (path.endsWith("/data.json")) initialTab = "Data";
  else if (path.includes("/traits")) initialTab = "Effects";

  if (hasCustomUI(name)) {
    const stoneUIProps: StoneUIProps = {
      stone: { name, whoAmI: "", data: {} },
      sendMessage: (msg: string) => { talkTo(name, msg).catch(console.error); },
    };
    return (
      <DynamicUI
        importPath={`@stones/${name}/files/ui/index.tsx`}
        componentProps={stoneUIProps}
        fallback={<ObjectDetail objectName={name} initialTab={initialTab} />}
      />
    );
  }
  return <ObjectDetail objectName={name} initialTab={initialTab} />;
}

/** FlowView 适配器 — 从 path 提取 sessionId, objectName, initialTab */
function FlowViewAdapter({ path }: ViewProps) {
  const match = path.match(/^flows\/([^/]+)\/flows\/([^/]+)/);
  if (!match) return null;
  const sessionId = match[1]!;
  const objectName = match[2]!;

  /* 子路径 → initialTab */
  let initialTab: string | undefined;
  if (path.endsWith("/data.json")) initialTab = "Data";
  else if (path.endsWith("/process.json")) initialTab = "Process";
  else if (path.endsWith("/files/ui")) initialTab = "UI";

  return <FlowView sessionId={sessionId} objectName={objectName} initialTab={initialTab} />;
}

/** SessionGantt 适配器 */
function SessionGanttAdapter({ path }: ViewProps) {
  const sessionId = path.match(/^flows\/([^/]+)$/)?.[1] ?? "";
  return <SessionGantt sessionId={sessionId} />;
}

/** ReflectFlow 适配器 — stones/{name}/reflect/ 下的 Process + Data + Memory 视图 */
function ReflectFlowAdapter({ path }: ViewProps) {
  const objectName = path.match(/stones\/([^/]+)/)?.[1] ?? "";
  const basePath = `stones/${objectName}/reflect`;

  type ReflectTab = "Process" | "Data" | "Memory";
  let initialTab: ReflectTab = "Process";
  if (path.endsWith("/data.json")) initialTab = "Data";
  else if (path.endsWith("/memory.md")) initialTab = "Memory";

  const [tab, setTab] = useState<ReflectTab>(initialTab);
  const [process, setProcess] = useState<Process | null>(null);
  const [dataContent, setDataContent] = useState<string | null>(null);
  const [memoryContent, setMemoryContent] = useState<string | null>(null);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => { setTab(initialTab); }, [path]);

  useEffect(() => {
    fetchFileContent(`${basePath}/process.json`)
      .then((c) => setProcess(JSON.parse(c) as Process))
      .catch(() => setProcess(null));
    fetchFileContent(`${basePath}/data.json`)
      .then((raw) => { try { setDataContent(JSON.stringify(JSON.parse(raw), null, 2)); } catch { setDataContent(raw); } })
      .catch(() => setDataContent(null));
    fetchFileContent(`stones/${objectName}/memory.md`)
      .then(setMemoryContent)
      .catch(() => setMemoryContent(""));
  }, [basePath, refreshKey]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 sm:px-8 py-3 gap-4 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <h2 className="text-lg sm:text-xl font-bold leading-none" style={{ fontFamily: "var(--heading-font)" }}>
            {objectName}
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">reflect</span>
        </div>
        <div className="flex items-center bg-[var(--accent)] rounded-lg p-0.5">
          {(["Process", "Data", "Memory"] as const).map((t) => (
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
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-4">
        {tab === "Process" && (
          process ? <ProcessView process={process} /> : <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
        )}
        {tab === "Data" && (
          dataContent ? <CodeMirrorViewer content={dataContent} ext="json" /> : <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
        )}
        {tab === "Memory" && (
          memoryContent
            ? <div className="prose prose-sm max-w-none"><MarkdownContent content={memoryContent} /></div>
            : <p className="text-sm text-[var(--muted-foreground)]">暂无记忆</p>
        )}
      </div>
    </div>
  );
}

/** ProcessJson 适配器 */
function ProcessJsonAdapter({ path }: ViewProps) {
  const [process, setProcess] = useState<Process | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => {
    setProcess(null);
    setError(null);
    fetchFileContent(path)
      .then((content) => setProcess(JSON.parse(content) as Process))
      .catch((e) => setError(e.message));
  }, [path, refreshKey]);

  if (error) return <div className="flex items-center justify-center h-full"><p className="text-sm text-red-500">{error}</p></div>;
  if (!process) return <div className="flex items-center justify-center h-full"><p className="text-sm text-[var(--muted-foreground)]">加载中...</p></div>;
  return <div className="h-full overflow-auto p-4"><ProcessView process={process} /></div>;
}

/** 通用文件查看器 */
function FileViewerAdapter({ path }: ViewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshKey = useAtomValue(refreshKeyAtom);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  useEffect(() => {
    setContent(null);
    setError(null);
    fetchFileContent(path)
      .then(setContent)
      .catch((e) => setError(e.message));
  }, [path, refreshKey]);

  if (error) return <div className="flex items-center justify-center h-full"><p className="text-sm text-red-500">{error}</p></div>;
  if (content === null) return <div className="flex items-center justify-center h-full"><p className="text-sm text-[var(--muted-foreground)]">加载中...</p></div>;

  if (ext === "json") {
    let formatted = content;
    try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep */ }
    return <div className="h-full overflow-auto"><CodeMirrorViewer content={formatted} ext="json" /></div>;
  }
  if (ext === "md") {
    return <div className="p-4 sm:p-8 overflow-auto h-full prose prose-sm max-w-none"><MarkdownContent content={content} /></div>;
  }
  return <div className="h-full overflow-auto"><CodeMirrorViewer content={content} ext={ext} /></div>;
}

/* ── 注册所有视图 ── */

export function registerAllViews(): void {
  /* FlowView — flows/{sid}/flows/{obj} 及其子路径（排除 files/ 下的具体文件） */
  viewRegistry.register({
    name: "FlowView",
    component: FlowViewAdapter,
    match: (p) => /^flows\/[^/]+\/flows\/[^/]+/.test(p) && !/\/files\/[^/]+\.[^/]+$/.test(p),
    priority: 100,
    tabKey: (p) => p.match(/^(flows\/[^/]+\/flows\/[^/]+)/)?.[1] ?? p,
    tabLabel: (p) => p.match(/flows\/[^/]+\/flows\/([^/]+)/)?.[1] ?? "Flow",
  });

  /* SessionGantt — flows/{sid}（精确匹配） */
  viewRegistry.register({
    name: "SessionGantt",
    component: SessionGanttAdapter,
    match: (p) => /^flows\/[^/]+$/.test(p),
    priority: 100,
    tabKey: (p) => p,
    tabLabel: () => "Session",
  });

  /* ReflectFlow — stones/{name}/reflect/ 及其子路径 */
  viewRegistry.register({
    name: "ReflectFlow",
    component: ReflectFlowAdapter,
    match: (p) => /^stones\/[^/]+\/reflect(\/|$)/.test(p),
    priority: 80,
    tabKey: (p) => p.match(/^(stones\/[^/]+\/reflect)/)?.[1] ?? p,
    tabLabel: (p) => {
      const name = p.match(/stones\/([^/]+)/)?.[1] ?? "Reflect";
      return `${name} (reflect)`;
    },
  });

  /* ObjectDetail — stones/{name} 精确匹配 + readme.md/data.json/traits 子路径 */
  viewRegistry.register({
    name: "ObjectDetail",
    component: StoneViewAdapter,
    match: (p) => /^stones\/[^/]+$/.test(p) || /^stones\/[^/]+\/(readme\.md|data\.json|traits)/.test(p),
    priority: 50,
    tabKey: (p) => p.match(/^(stones\/[^/]+)/)?.[1] ?? p,
    tabLabel: (p) => p.match(/stones\/([^/]+)/)?.[1] ?? "Stone",
  });

  /* ProcessJson — 任何路径下的 process.json（不在 flows/x/flows/x/ 和 stones/x/reflect/ 下的） */
  viewRegistry.register({
    name: "ProcessJson",
    component: ProcessJsonAdapter,
    match: (p) => p.endsWith("/process.json") && !/^flows\/[^/]+\/flows\/[^/]+/.test(p) && !/^stones\/[^/]+\/reflect/.test(p),
    priority: 40,
    tabKey: (p) => p,
    tabLabel: () => "Process",
  });

  /* FileViewer — fallback，匹配所有文件 */
  viewRegistry.register({
    name: "FileViewer",
    component: FileViewerAdapter,
    match: () => true,
    priority: 0,
    tabKey: (p) => p,
    tabLabel: (p) => p.split("/").pop() ?? p,
  });
}
