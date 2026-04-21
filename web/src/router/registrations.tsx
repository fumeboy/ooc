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
import { fetchFileContent, saveFileContent } from "../api/client";
import { viewRegistry, type ViewProps } from "./registry";
import { cn } from "../lib/utils";
import { ObjectDetail } from "../features/ObjectDetail";
import { FlowView } from "../features/FlowView";
import { SessionKanban } from "../features/SessionKanban";
import { DynamicUI } from "../features/DynamicUI";
import { IssueDetailView } from "../features/IssueDetailView";
import { TaskDetailView } from "../features/TaskDetailView";
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
    /* 默认加载 views/main；Phase 4 后将注入 callMethod */
    return (
      <DynamicUI
        importPath={`@stones/${name}/views/main/frontend.tsx`}
        componentProps={{ ...stoneUIProps, objectName: name, sessionId: "" }}
        fallback={<ObjectDetail objectName={name} initialTab={initialTab} />}
      />
    );
  }
  return <ObjectDetail objectName={name} initialTab={initialTab} />;
}

/** FlowView 适配器 — 从 path 提取 sessionId, objectName, initialTab */
function FlowViewAdapter({ path }: ViewProps) {
  const match = path.match(/^flows\/([^/]+)\/objects\/([^/]+)/);
  if (!match) return null;
  const sessionId = match[1]!;
  const objectName = match[2]!;

  /* 子路径 → initialTab */
  let initialTab: string | undefined;
  if (path.endsWith("/data.json")) initialTab = "Data";
  else if (path.endsWith("/process.json")) initialTab = "Process";
  else if (path.endsWith("/memory.md")) initialTab = "Memory";
  else if (/\/views(\/|$)/.test(path)) initialTab = "View";

  return <FlowView sessionId={sessionId} objectName={objectName} initialTab={initialTab} />;
}

/** SessionKanban 适配器 */
function SessionKanbanAdapter({ path }: ViewProps) {
  const sessionId = path.match(/^flows\/([^/]+)$/)?.[1] ?? "";
  return <SessionKanban sessionId={sessionId} />;
}

/** Issue 详情页适配器 */
function IssueDetailAdapter({ path }: ViewProps) {
  const m = path.match(/^flows\/([^/]+)\/issues\/([^/]+)$/);
  return <IssueDetailView sessionId={m?.[1] ?? ""} issueId={m?.[2] ?? ""} />;
}

/** Task 详情页适配器 */
function TaskDetailAdapter({ path }: ViewProps) {
  const m = path.match(/^flows\/([^/]+)\/tasks\/([^/]+)$/);
  return <TaskDetailView sessionId={m?.[1] ?? ""} taskId={m?.[2] ?? ""} />;
}

/** 反思线程的 inbox 消息（读自 threads/{rootId}/thread.json） */
interface ReflectInboxMessage {
  id: string;
  from: string;
  content: string;
  timestamp: number;
  status: string;
  source?: string;
}

/** 反思线程树节点元数据（threads.json） */
interface ReflectThreadsTreeFile {
  rootId: string;
  nodes: Record<string, {
    id: string;
    title: string;
    description?: string;
    status: string;
    childrenIds: string[];
    createdAt: number;
    updatedAt: number;
  }>;
}

/**
 * ReflectFlow 适配器 — stones/{name}/reflect/ 下的 Inbox + Memory 视图
 *
 * 方案 B Phase 4：适配线程树结构（threads.json + threads/{rootId}/thread.json），
 * 废弃旧 Process/Data tab（它们假设 data.json + process.json 结构，线程树化后不存在）。
 *
 * - **Inbox tab**：列出反思线程 root 节点 inbox 的所有消息（未读 / 已读 / 已处理）
 * - **Memory tab**：渲染对象 memory.md（反思沉淀产出）
 *
 * 底层数据：`stones/{name}/reflect/threads.json` + `threads/{rootId}/thread.json`
 */
function ReflectFlowAdapter({ path }: ViewProps) {
  const objectName = path.match(/stones\/([^/]+)/)?.[1] ?? "";
  const basePath = `stones/${objectName}/reflect`;

  type ReflectTab = "Inbox" | "Memory";
  let initialTab: ReflectTab = "Inbox";
  if (path.endsWith("/memory.md")) initialTab = "Memory";

  const [tab, setTab] = useState<ReflectTab>(initialTab);
  const [treeFile, setTreeFile] = useState<ReflectThreadsTreeFile | null>(null);
  const [inbox, setInbox] = useState<ReflectInboxMessage[]>([]);
  const [memoryContent, setMemoryContent] = useState<string | null>(null);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => { setTab(initialTab); }, [path]);

  useEffect(() => {
    /* 读 threads.json */
    fetchFileContent(`${basePath}/threads.json`)
      .then((raw) => {
        try {
          const parsed = JSON.parse(raw) as ReflectThreadsTreeFile;
          setTreeFile(parsed);
          /* 同步读 root thread.json（inbox 在这里） */
          return fetchFileContent(`${basePath}/threads/${parsed.rootId}/thread.json`)
            .then((threadRaw) => {
              try {
                const threadData = JSON.parse(threadRaw) as { inbox?: ReflectInboxMessage[] };
                setInbox(threadData.inbox ?? []);
              } catch {
                setInbox([]);
              }
            })
            .catch(() => setInbox([]));
        } catch {
          setTreeFile(null);
          setInbox([]);
        }
      })
      .catch(() => {
        /* 反思线程尚未初始化（对象从未被 talkToSelf 过） */
        setTreeFile(null);
        setInbox([]);
      });
    /* Memory 独立读 */
    fetchFileContent(`stones/${objectName}/memory.md`)
      .then(setMemoryContent)
      .catch(() => setMemoryContent(""));
  }, [basePath, objectName, refreshKey]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 sm:px-8 py-3 gap-4 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <h2 className="text-lg sm:text-xl font-bold leading-none" style={{ fontFamily: "var(--heading-font)" }}>
            {objectName}
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">reflect</span>
          {treeFile && (
            <span className="text-[10px] text-[var(--muted-foreground)] font-mono">
              rootId: {treeFile.rootId.slice(0, 16)}…
            </span>
          )}
        </div>
        <div className="flex items-center bg-[var(--accent)] rounded-lg p-0.5">
          {(["Inbox", "Memory"] as const).map((t) => (
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
              {t === "Inbox" && inbox.filter((m) => m.status === "unread").length > 0 && (
                <span className="ml-1 inline-block px-1 text-[10px] rounded-full bg-red-100 text-red-600">
                  {inbox.filter((m) => m.status === "unread").length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-4">
        {tab === "Inbox" && (
          !treeFile ? (
            <p className="text-sm text-[var(--muted-foreground)]">反思线程尚未初始化（该对象从未被 talkToSelf）</p>
          ) : inbox.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">inbox 为空</p>
          ) : (
            <ul className="space-y-3">
              {inbox.map((msg) => (
                <li key={msg.id} className={cn(
                  "rounded-lg border p-3",
                  msg.status === "unread"
                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                    : "border-[var(--border)] opacity-60",
                )}>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)] mb-2">
                    <span className="font-mono">{msg.id.slice(0, 20)}…</span>
                    <span>from: {msg.from}</span>
                    <span>status: {msg.status}</span>
                    {msg.source && <span>source: {msg.source}</span>}
                    <span className="ml-auto">{new Date(msg.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                </li>
              ))}
            </ul>
          )
        )}
        {tab === "Memory" && (
          memoryContent && memoryContent.length > 0
            ? <div className="prose prose-sm max-w-none"><MarkdownContent content={memoryContent} /></div>
            : <p className="text-sm text-[var(--muted-foreground)]">暂无长期记忆（memory.md 未写入）</p>
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

/** 通用文件查看器（支持编辑和保存） */
function FileViewerAdapter({ path }: ViewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const refreshKey = useAtomValue(refreshKeyAtom);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  useEffect(() => {
    setContent(null);
    setError(null);
    setEditing(false);
    fetchFileContent(path)
      .then((c) => { setContent(c); setDraft(c); })
      .catch((e) => setError(e.message));
  }, [path, refreshKey]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveFileContent(path, draft);
      setContent(draft);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="flex items-center justify-center h-full"><p className="text-sm text-red-500">{error}</p></div>;
  if (content === null) return <div className="flex items-center justify-center h-full"><p className="text-sm text-[var(--muted-foreground)]">加载中...</p></div>;

  if (editing) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-[var(--border)] shrink-0">
          <button
            onClick={() => { setDraft(content); setEditing(false); }}
            className="px-3 py-1 text-xs rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-xs rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 w-full p-4 bg-transparent text-xs font-mono outline-none resize-none"
          spellCheck={false}
        />
      </div>
    );
  }

  /* 只读模式 — 右上角编辑按钮 */
  const editButton = (
    <button
      onClick={() => setEditing(true)}
      className="absolute top-2 right-2 px-2.5 py-1 text-[10px] rounded-md bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors z-10"
    >
      编辑
    </button>
  );

  if (ext === "json") {
    let formatted = content;
    try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep */ }
    return <div className="h-full overflow-auto relative">{editButton}<CodeMirrorViewer content={formatted} ext="json" /></div>;
  }
  if (ext === "md") {
    return <div className="p-4 sm:p-8 overflow-auto h-full prose prose-sm max-w-none relative">{editButton}<MarkdownContent content={content} /></div>;
  }
  return <div className="h-full overflow-auto relative">{editButton}<CodeMirrorViewer content={content} ext={ext} /></div>;
}

/* ── 注册所有视图 ── */

export function registerAllViews(): void {
  /* FlowView — flows/{sid}/objects/{obj} 及其特定的 tab 子路径 */
  viewRegistry.register({
    name: "FlowView",
    component: FlowViewAdapter,
    match: (p) => {
      const match = p.match(/^flows\/[^/]+\/objects\/[^/]+(.*)$/);
      if (!match) return false;
      const subPath = match[1] || "";
      if (subPath === "" || subPath === "/") return true;
      if (subPath === "/data.json") return true;
      if (subPath === "/process.json") return true;
      if (subPath === "/memory.md") return true;
      /* 新协议：views/{viewName}（含具体 view 名称） */
      if (/^\/views(\/[^/]+)?$/.test(subPath)) return true;
      return false;
    },
    priority: 100,
    tabKey: (p) => p.match(/^(flows\/[^/]+\/objects\/[^/]+)/)?.[1] ?? p,
    tabLabel: (p) => p.match(/flows\/[^/]+\/objects\/([^/]+)/)?.[1] ?? "Flow",
  });

  /* SessionKanban — flows/{sid}（替换 SessionGantt） */
  viewRegistry.register({
    name: "SessionKanban",
    component: SessionKanbanAdapter,
    match: (p) => /^flows\/[^/]+$/.test(p) && !p.includes("/."),
    priority: 120,
    tabKey: (p) => p,
    tabLabel: () => "Kanban",
  });

  /* Issue 详情页 — flows/{sid}/issues/{issueId} */
  viewRegistry.register({
    name: "IssueDetail",
    component: IssueDetailAdapter,
    match: (p) => /^flows\/[^/]+\/issues\/[^/]+$/.test(p),
    priority: 130,
    tabKey: (p) => p,
    tabLabel: (p) => p.match(/issues\/([^/]+)$/)?.[1] ?? "Issue",
  });

  /* Task 详情页 — flows/{sid}/tasks/{taskItemId} */
  viewRegistry.register({
    name: "TaskDetail",
    component: TaskDetailAdapter,
    match: (p) => /^flows\/[^/]+\/tasks\/[^/]+$/.test(p),
    priority: 130,
    tabKey: (p) => p,
    tabLabel: (p) => p.match(/tasks\/([^/]+)$/)?.[1] ?? "Task",
  });

  /* ReflectFlow — stones/{name}/reflect/ 及其特定的 tabs 子路径 */
  viewRegistry.register({
    name: "ReflectFlow",
    component: ReflectFlowAdapter,
    match: (p) => {
      const match = p.match(/^stones\/[^/]+\/reflect(.*)$/);
      if (!match) return false;
      const subPath = match[1] || "";
      if (subPath === "" || subPath === "/") return true;
      if (subPath === "/data.json") return true;
      if (subPath === "/process.json") return true;
      if (subPath === "/memory.md") return true;
      return false;
    },
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

  /* ProcessJson — 任何路径下的 process.json（不在 flows/x/objects/x/ 和 stones/x/reflect/ 下的） */
  viewRegistry.register({
    name: "ProcessJson",
    component: ProcessJsonAdapter,
    match: (p) => p.endsWith("/process.json") && !/^flows\/[^/]+\/objects\/[^/]+/.test(p) && !/^stones\/[^/]+\/reflect/.test(p),
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
