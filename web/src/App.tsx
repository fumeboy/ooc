/**
 * App — OOC 前端根组件
 *
 * 水平布局：「网站左边栏」（Logo + Tab 切换 + 文件树）+ 右侧主内容区（EditorTabs + ViewRouter/ChatPage）。
 * 三个 Tab：Flows / Stones / World，各自展示对应的文件树。
 *
 * @ref ooc://file/stones/sophia/files/哲学文档/gene.md#G11 — implements — 前端整体布局
 */
import { useEffect, useState, useCallback } from "react";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
import { objectsAtom } from "./store/objects";
import {
  activeTabAtom,
  sseConnectedAtom,
  activeSessionFlowAtom,
  activeSessionIdAtom,
  editorTabsAtom,
  activeFilePathAtom,
  sidebarTreeAtom,
  refreshKeyAtom,
} from "./store/session";
import type { AppTab } from "./store/session";
import { fetchObjects, fetchProjectTree, updateFlowTitle } from "./api/client";
import type { FileTreeNode } from "./api/types";
import { ChatPage } from "./features/ChatPage";
import { viewRegistry, registerAllViews } from "./router";
import { SessionsList } from "./features/SessionsList";
import { SessionFileTree } from "./features/SessionFileTree";
import { MessageSidebar } from "./features/MessageSidebar";
import { FileTree } from "./components/ui/FileTree";
import { EditorTabs } from "./components/ui/EditorTabs";
import { useSSE } from "./hooks/useSSE";
import { useIsMobile } from "./hooks/useIsMobile";
import { OocLinkPreview } from "./components/OocLinkPreview";
import { CommandPalette } from "./components/CommandPalette";
import { OocLogo } from "./components/OocLogo";
import { Sheet, SheetContent, SheetTrigger } from "./components/ui/sheet";
import { cn } from "./lib/utils";
import { GitBranch, Box, Globe, List, Menu, RotateCw, ChevronDown, ChevronRight } from "lucide-react";
import bgSvg from "./assets/bg.svg";

/* 初始化视图注册表（只执行一次） */
registerAllViews();

const TABS: { id: AppTab; label: string; icon: typeof GitBranch }[] = [
  { id: "flows", label: "Flows", icon: GitBranch },
  { id: "stones", label: "Stones", icon: Box },
  { id: "world", label: "World", icon: Globe },
];

export function App() {
  const setObjects = useSetAtom(objectsAtom);
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  const [sseConnected] = useAtom(sseConnectedAtom);
  const [activeFlow, setActiveFlow] = useAtom(activeSessionFlowAtom);
  const activeId = useAtomValue(activeSessionIdAtom);
  const [tabs, setTabs] = useAtom(editorTabsAtom);
  const [activePath, setActivePath] = useAtom(activeFilePathAtom);
  const [sidebarTree, setSidebarTree] = useAtom(sidebarTreeAtom);
  const setRefreshKey = useSetAtom(refreshKeyAtom);
  const isMobile = useIsMobile();

  /* Flows tab: sessions 列表 vs session 文件树 */
  const [showSessions, setShowSessions] = useState(true);

  /* 移动端 Sheet 开关 */
  const [sheetOpen, setSheetOpen] = useState(false);

  /* 当选中会话时自动切到文件树，取消选中时切回 sessions */
  useEffect(() => {
    setShowSessions(!activeId);
  }, [activeId]);

  /* 加载对象列表 */
  useEffect(() => {
    fetchObjects().then(setObjects).catch(console.error);
  }, [setObjects]);

  /* SSE 连接 */
  useSSE();

  /* World tab: 加载 .ooc/ 项目文件树 */
  useEffect(() => {
    if (activeTab === "world" || activeTab === "stones") {
      fetchProjectTree().then(setSidebarTree).catch(console.error);
    }
  }, [activeTab, setSidebarTree]);

  /* Session title 编辑 */
  const sessionTitle = activeFlow?.title
    || activeFlow?.messages?.[0]?.content?.slice(0, 40)
    || "";

  const handleTitleSave = async (newTitle: string) => {
    if (!activeFlow) return;
    try {
      await updateFlowTitle(activeFlow.taskId, newTitle);
      setActiveFlow({ ...activeFlow, title: newTitle });
    } catch (e) {
      console.error(e);
    }
  };

  /* 打开文件 tab（通过 ViewRegistry 统一路由） */
  const openFileTab = useCallback((path: string, node: FileTreeNode) => {
    /* .stone 虚拟节点在 Flows 上下文中 → 重定向到 FlowView 路径 */
    let resolvedPath = path;
    if (activeTab === "flows" && activeId && node.marker === "stone") {
      const stoneMatch = path.match(/^stones\/([^/]+)$/);
      if (stoneMatch) {
        resolvedPath = `flows/${activeId}/flows/${stoneMatch[1]!}`;
      }
    }

    const result = viewRegistry.resolve(resolvedPath);
    if (!result) return;

    const { tabKey, tabLabel } = result;
    setActivePath(resolvedPath);
    setTabs((prev) => {
      const existing = prev.find((t) => {
        /* 用 tabKey 匹配：检查已有 tab 的 tabKey 是否相同 */
        const existingResult = viewRegistry.resolve(t.path);
        return existingResult && existingResult.tabKey === tabKey;
      });
      if (existing) {
        /* 复用已有 tab，更新 path（触发组件内部子路由切换） */
        return prev.map((t) => t === existing ? { ...t, path: resolvedPath } : t);
      }
      return [...prev, { path: resolvedPath, label: tabLabel }];
    });
    if (isMobile) setSheetOpen(false);
  }, [activeTab, activeId, setActivePath, setTabs, isMobile]);

  /* 侧边栏文件树内容 */
  const renderSidebarTree = () => {
    if (activeTab === "flows") {
      if (showSessions || !activeId) {
        return <SessionsList onSelect={() => isMobile && setSheetOpen(false)} />;
      }
      return (
        <SessionFileTree
          sessionId={activeId}
          onSelect={openFileTab}
          selectedPath={activePath ?? undefined}
        />
      );
    }

    if (activeTab === "stones") {
      if (!sidebarTree) return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">加载中...</p>;
      /* 只展示 stones/ 子树 */
      const stonesNode = sidebarTree.children?.find((c) => c.name === "stones");
      if (!stonesNode) return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">无 stones</p>;
      return (
        <div className="overflow-auto px-1">
          <FileTree root={stonesNode} onSelect={openFileTab} selectedPath={activePath ?? undefined} defaultExpanded />
        </div>
      );
    }

    /* world tab */
    if (!sidebarTree) return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">加载中...</p>;
    return (
      <div className="overflow-auto px-1">
        <FileTree root={sidebarTree} onSelect={openFileTab} selectedPath={activePath ?? undefined} />
      </div>
    );
  };

  /* 主内容区 */
  const renderMainContent = () => {
    /* Flows tab 且无活跃 session → Welcome 页面优先 */
    if (activeTab === "flows" && !activeId) {
      return <ChatPage />;
    }

    /* 如果有打开的 editor tab，通过 ViewRegistry 渲染 */
    if (activePath && tabs.length > 0) {
      const resolved = viewRegistry.resolve(activePath);
      const ViewComponent = resolved?.registration.component;

      return (
        <div className="flex flex-col h-full gap-2 p-2">
          <div className="flex items-center shrink-0 rounded-md bg-[var(--card)] border border-[var(--border)]">
            <div className="flex-1 overflow-hidden">
              <EditorTabs />
            </div>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="px-2 py-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]/40 transition-colors shrink-0 rounded-lg mr-1"
              title="刷新内容"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 路径面包屑 */}
          <div className="flex items-center gap-0.5 px-2 text-[10px] text-[var(--muted-foreground)] overflow-x-auto scrollbar-hide shrink-0">
            {activePath!.split("/").filter(Boolean).map((seg, i, arr) => (
              <span key={i} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && <ChevronRight className="w-2.5 h-2.5 opacity-40" />}
                <span className={i === arr.length - 1 ? "text-[var(--foreground)]" : ""}>{seg}</span>
              </span>
            ))}
          </div>

          <div className="flex-1 overflow-auto rounded-md bg-[var(--card)] border border-[var(--border)]">
            {ViewComponent ? <ViewComponent path={activePath} /> : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-[var(--muted-foreground)]">无法识别的路径: {activePath}</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    /* Flows tab 默认展示 ChatPage */
    if (activeTab === "flows") {
      return <ChatPage />;
    }

    /* 空状态 */
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">
          Select a file from the sidebar
        </p>
      </div>
    );
  };

  /* 侧边栏内容（桌面端和移动端共用） */
  const sidebarContent = (
    <div className="flex flex-col items-center h-full pl-2" style={{ width: "inherit" }}>
      <div className="flex flex-col items-center gap-1 px-4 py-4 shrink-0">
        <OocLogo px={isMobile ? 80 : 120} />
        <div className="flex items-center gap-1.5">
          <h1
            className="text-xs tracking-wide text-[var(--muted-foreground)]"
            style={{ fontFamily: "monospace" }}
          >
            Oriented Object Context
          </h1>
          <span
            className={cn(
              "text-[8px]",
              sseConnected ? "text-green-500" : "text-[var(--muted-foreground)]",
            )}
            role="status"
            title={sseConnected ? "Connected" : "Disconnected"}
          >
            ●
          </span>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="px-3 pb-2 shrink-0 w-full">
        <nav className="flex items-center bg-[var(--accent)] rounded-full p-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-full text-xs transition-all",
                  activeTab === tab.id
                    ? "bg-[var(--card)] text-[var(--foreground)] font-medium shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Session Bar — 整合 session list 切换 + title 编辑（仅 Flows 模式有活跃会话时显示） */}
      {activeTab === "flows" && activeFlow && (
        <div className="px-3 pb-2 shrink-0 w-full">
          <SessionBar
            title={sessionTitle}
            showSessions={showSessions}
            onToggleSessions={() => setShowSessions(!showSessions)}
            onSave={handleTitleSave}
          />
        </div>
      )}

      {/* 列表/文件树区域 */}
      <div className="flex-1 overflow-auto w-full">
        {renderSidebarTree()}
      </div>
    </div>
  );

  return (
    <div
      className="relative flex h-screen overflow-hidden bg-[var(--background)]"
    >
      {/* 全局 SVG 背景层 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${bgSvg})`,
          backgroundSize: "300px",
          backgroundRepeat: "repeat",
          backgroundPosition: "center",
          opacity: 0.03,
        }}
      />
      {/* ====== 移动端顶部栏 ====== */}
      {isMobile && (
        <div className="fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 h-12 bg-[var(--background)] border-b border-[var(--border)] safe-top">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button className="p-2 -ml-2 rounded-lg hover:bg-[var(--accent)] transition-colors touch-target">
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              {sidebarContent}
            </SheetContent>
          </Sheet>
          <span className="text-sm font-medium truncate flex-1">
            {activeTab === "flows"
              ? (sessionTitle || "Flows")
              : activeTab === "stones" ? "Stones" : "World"}
          </span>
          <span
            className={cn(
              "text-[8px]",
              sseConnected ? "text-green-500" : "text-[var(--muted-foreground)]",
            )}
          >
            ●
          </span>
        </div>
      )}

      {/* ====== 桌面端网站左边栏 ====== */}
      {!isMobile && (
        <aside className="relative z-10 flex flex-col items-center w-72 shrink-0">
          {sidebarContent}
        </aside>
      )}

      {/* ====== 右侧主内容区 ====== */}
      <main
        className={cn(
          "relative z-10 flex-1 overflow-hidden",
          isMobile && "mt-12 safe-bottom",
        )}
      >
        {/* 纹理背景层 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "url(/textures/groovepaper.png)",
            backgroundRepeat: "repeat",
            opacity: 0.4,
          }}
        />
        {renderMainContent()}
      </main>

      {/* 右侧消息侧边栏 */}
      {activeTab === "flows" && activeId && !isMobile && (
        <MessageSidebar />
      )}

      {/* ooc:// 链接弹窗 */}
      <OocLinkPreview />
      {/* Cmd+K 命令面板 */}
      <CommandPalette />
    </div>
  );
}

/** Session Bar — 整合 session list 切换 + title 编辑 */
function SessionBar({
  title,
  showSessions,
  onToggleSessions,
  onSave,
}: {
  title: string;
  showSessions: boolean;
  onToggleSessions: () => void;
  onSave: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = { current: null as HTMLInputElement | null };

  useEffect(() => { setDraft(title); }, [title]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onSave(trimmed);
    else setDraft(title);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg transition-colors",
        "bg-[var(--accent)]/40 hover:bg-[var(--accent)]",
      )}
    >
      {/* ☰ 切换 session list */}
      <button
        onClick={onToggleSessions}
        className={cn(
          "p-1.5 pl-2.5 rounded-l-lg transition-colors shrink-0",
          showSessions
            ? "text-[var(--foreground)]"
            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
        )}
        title={showSessions ? "Show file tree" : "Show sessions"}
      >
        <List className="w-3.5 h-3.5" />
      </button>

      {/* Title — 点击编辑 */}
      {editing ? (
        <input
          ref={(el) => { inputRef.current = el; }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(title); setEditing(false); }
          }}
          className="flex-1 min-w-0 bg-transparent text-xs text-[var(--foreground)] py-1.5 outline-none"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex-1 min-w-0 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] py-1.5 truncate text-left transition-colors"
          title="Click to rename"
        >
          {title || "Untitled session"}
        </button>
      )}

      {/* ▾ 切换 session list */}
      <button
        onClick={onToggleSessions}
        className="p-1.5 pr-2.5 rounded-r-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors shrink-0"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showSessions && "rotate-180")} />
      </button>
    </div>
  );
}
