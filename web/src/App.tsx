/**
 * App — OOC 前端根组件
 *
 * 水平布局：「网站左边栏」（Logo + Tab 切换 + 文件树）+ 右侧主内容区（面包屑 + ViewRouter/ChatPage）。
 * 三个 Tab：Flows / Stones / World，各自展示对应的文件树。
 *
 * @ref ooc://file/stones/sophia/files/哲学文档/gene.md#G11 — implements — 前端整体布局
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { useAtom, useSetAtom } from "jotai";
import { objectsAtom } from "./store/objects";
import {
  activeTabAtom,
  sseConnectedAtom,
  activeSessionIdAtom,
  editorTabsAtom,
  activeFilePathAtom,
  sidebarTreeAtom,
  refreshKeyAtom,
  userSessionsAtom,
} from "./store/session";
import type { AppTab } from "./store/session";
import { fetchObjects, fetchProjectTree, fetchSessions } from "./api/client";
import type { FileTreeNode } from "./api/types";
import { ChatPage } from "./features/ChatPage";
import { viewRegistry, registerAllViews } from "./router";
import { SessionFileTree } from "./features/SessionFileTree";
import { FileTree } from "./components/ui/FileTree";
import { useSSE } from "./hooks/useSSE";
import { useIsMobile } from "./hooks/useIsMobile";
import { OocLinkPreview } from "./components/OocLinkPreview";
import { CommandPalette } from "./components/CommandPalette";
import { OocLogo } from "./components/OocLogo";
import { Sheet, SheetContent, SheetTrigger } from "./components/ui/sheet";
import { cn } from "./lib/utils";
import { GitBranch, Box, Globe, Menu, RotateCw, ChevronRight } from "lucide-react";
import bgSvg from "./assets/bg.svg";

/* 初始化视图注册表（只执行一次） */
registerAllViews();

/* 最近访问文件管理（localStorage） */
const RECENT_FILES_KEY = "ooc_recent_files";
const MAX_RECENT = 20;

interface RecentFile {
  path: string;
  label: string;
}

function getRecentFiles(): RecentFile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || "[]");
    /* 兼容旧格式（纯字符串数组） */
    if (raw.length > 0 && typeof raw[0] === "string") {
      return raw.map((p: string) => ({ path: p, label: p.split("/").pop() || p }));
    }
    return raw;
  } catch { return []; }
}

function addRecentFile(path: string, label?: string) {
  const recent = getRecentFiles().filter((r) => r.path !== path);
  recent.unshift({ path, label: label || path.split("/").pop() || path });
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

/** 过滤 Stones 文件树：隐藏 stone 级冗余文件 + reflect 目录中的 data.json/process.json */
const STONE_HIDDEN_FILES = new Set(["readme.md", "memory.md", "data.json"]);
const STONE_HIDDEN_DIRS = new Set(["traits"]);
const FLOW_HIDDEN_FILES = new Set(["data.json", "process.json"]);

function filterStoneTree(node: FileTreeNode): FileTreeNode {
  if (!node.children) return node;
  const filtered = node.children
    .filter((c) => {
      /* 每个 stone 子目录下隐藏冗余文件 */
      if (c.type === "file" && node.marker === "stone" && STONE_HIDDEN_FILES.has(c.name)) return false;
      /* 每个 stone 子目录下隐藏 traits 目录 */
      if (c.type === "directory" && node.marker === "stone" && STONE_HIDDEN_DIRS.has(c.name)) return false;
      /* reflect 目录下隐藏 data.json/process.json */
      if (c.type === "file" && node.name === "reflect" && FLOW_HIDDEN_FILES.has(c.name)) return false;
      return true;
    })
    .map((c) => c.type === "directory" ? filterStoneTree(c) : c);
  return { ...node, children: filtered };
}

const TABS: { id: AppTab; label: string; icon: typeof GitBranch }[] = [
  { id: "flows", label: "Flows", icon: GitBranch },
  { id: "stones", label: "Stones", icon: Box },
  { id: "world", label: "World", icon: Globe },
];

export function App() {
  const setObjects = useSetAtom(objectsAtom);
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  const [sseConnected] = useAtom(sseConnectedAtom);
  const [activeId, setActiveId] = useAtom(activeSessionIdAtom);
  const [tabs, setTabs] = useAtom(editorTabsAtom);
  const [activePath, setActivePath] = useAtom(activeFilePathAtom);
  const [sidebarTree, setSidebarTree] = useAtom(sidebarTreeAtom);
  const setRefreshKey = useSetAtom(refreshKeyAtom);
  const isMobile = useIsMobile();
  const [sessions, setSessions] = useAtom(userSessionsAtom);

  /* taskId → session title 的 lookup（面包屑用） */
  const sessionTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      const title = s.title || s.firstMessage?.slice(0, 40) || s.taskId.slice(0, 16);
      map.set(s.taskId, title);
    }
    return map;
  }, [sessions]);

  /* 移动端 Sheet 开关 */
  const [sheetOpen, setSheetOpen] = useState(false);

  /* 加载对象列表 + sessions */
  useEffect(() => {
    fetchObjects().then(setObjects).catch(console.error);
    fetchSessions().then(setSessions).catch(console.error);
  }, [setObjects, setSessions]);

  /* SSE 连接 */
  useSSE();

  /* World tab: 加载 .ooc/ 项目文件树 */
  useEffect(() => {
    if (activeTab === "world" || activeTab === "stones") {
      fetchProjectTree().then(setSidebarTree).catch(console.error);
    }
  }, [activeTab, setSidebarTree]);

  /* Session title 编辑 */

  /* 打开文件 tab（通过 ViewRegistry 统一路由） */
  const openFileTab = useCallback((path: string, node: FileTreeNode) => {
    let resolvedPath = path;

    /* 从 flows/ 路径中提取 sessionId 并设置 activeId */
    const sessionMatch = path.match(/^flows\/([^/]+)/);
    if (sessionMatch) {
      setActiveId(sessionMatch[1]!);
    }

    /* .stone 虚拟节点在 Flows 上下文中 → 重定向到 FlowView 路径 */
    if (activeTab === "flows" && node.marker === "stone") {
      const stoneMatch = path.match(/^stones\/([^/]+)$/);
      if (stoneMatch && sessionMatch) {
        resolvedPath = `flows/${sessionMatch[1]!}/flows/${stoneMatch[1]!}`;
      }
    }

    const result = viewRegistry.resolve(resolvedPath);
    if (!result) return;

    const { tabKey, tabLabel } = result;
    setActivePath(resolvedPath);

    /* 记录到"最近访问"（仅 flows 路径） */
    if (resolvedPath.startsWith("flows/")) {
      addRecentFile(resolvedPath, node.name);
    }

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
      const recentPaths = getRecentFiles();
      const recentRoot: FileTreeNode | null = recentPaths.length > 0 ? {
        name: "__root__",
        type: "directory",
        path: "__recent_root__",
        children: [{
          name: "最近访问的",
          type: "directory",
          path: "__recent__",
          children: recentPaths.map((r) => ({
            name: r.label,
            type: "file" as const,
            path: r.path,
            size: 0,
          })),
        }],
      } : null;

      return (
        <>
          {recentRoot && (
            <div className="px-1 mb-1">
              <FileTree root={recentRoot} onSelect={openFileTab} selectedPath={activePath ?? undefined} />
            </div>
          )}
          <SessionFileTree
            onSelect={openFileTab}
            selectedPath={activePath ?? undefined}
          />
        </>
      );
    }

    if (activeTab === "stones") {
      if (!sidebarTree) return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">加载中...</p>;
      /* 只展示 stones/ 子树，过滤冗余文件 */
      const stonesNode = sidebarTree.children?.find((c) => c.name === "stones");
      if (!stonesNode) return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">无 stones</p>;
      const filtered = filterStoneTree(stonesNode);
      return (
        <div className="overflow-auto px-1">
          <FileTree root={filtered} onSelect={openFileTab} selectedPath={activePath ?? undefined} />
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
          {/* 路径面包屑 + refresh */}
          <div className="flex items-center gap-0.5 px-2 text-[10px] text-[var(--muted-foreground)] overflow-x-auto scrollbar-hide shrink-0">
            {activePath!.split("/").filter(Boolean).map((seg, i, arr) => (
              <span key={i} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && <ChevronRight className="w-2.5 h-2.5 opacity-40" />}
                <span className={i === arr.length - 1 ? "text-[var(--foreground)]" : ""}>{sessionTitleMap.get(seg) || seg}</span>
              </span>
            ))}
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="ml-auto px-1.5 py-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]/40 transition-colors shrink-0 rounded"
              title="刷新内容"
            >
              <RotateCw className="w-3 h-3" />
            </button>
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
              ? "Flows"
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

      {/* ooc:// 链接弹窗 */}
      <OocLinkPreview />
      {/* Cmd+K 命令面板 */}
      <CommandPalette />
    </div>
  );
}
