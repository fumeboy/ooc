/**
 * App — OOC 前端根组件
 *
 * 水平布局：「网站左边栏」（Logo + Tab 切换 + 文件树）+ 右侧主内容区（面包屑 + ViewRouter/WelcomePage）+ MessageSidebar。
 * 三个 Tab：Flows / Stones / World，各自展示对应的文件树。
 *
 * @ref ooc://file/stones/sophia/files/哲学文档/gene.md#G11 — implements — 前端整体布局
 */
import { useEffect, useState, useCallback, useMemo } from "react";
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
  userSessionsAtom,
  messageSidebarModeAtom,
} from "./store/session";
import type { AppTab } from "./store/session";
import { fetchObjects, fetchProjectTree, fetchSessions, updateFlowTitle, talkTo, createSession, fetchFlowGroups, fetchStoneGroups, type GroupConfig } from "./api/client";
import type { FileTreeNode } from "./api/types";
import { WelcomePage } from "./features/WelcomePage";
import { viewRegistry, registerAllViews } from "./router";
import { SessionsList } from "./features/SessionsList";
import { SessionFileTree } from "./features/SessionFileTree";
import { MessageSidebar } from "./features/MessageSidebar";
import { FileTree } from "./components/ui/FileTree";
import { useSSE } from "./hooks/useSSE";
import { useIsMobile } from "./hooks/useIsMobile";
import { useHashRouter } from "./hooks/useHashRouter";
import { ActivityHeatmap } from "./components/ui/ActivityHeatmap";
import { OocLinkPreview } from "./components/OocLinkPreview";
import { CommandPalette } from "./components/CommandPalette";
import { OocLogo } from "./components/OocLogo";
import { MainLogo } from "./components/MainLogo";
import { Sheet, SheetContent, SheetTrigger } from "./components/ui/sheet";
import { cn } from "./lib/utils";
import { GitBranch, Box, Globe, List, Menu, RotateCw, ChevronDown, ChevronRight, Settings } from "lucide-react";

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

/** 过滤 Stones 文件树 */
const STONE_HIDDEN_FILES = new Set(["readme.md", "memory.md", "data.json"]);
const STONE_HIDDEN_DIRS = new Set(["traits"]);
const FLOW_HIDDEN_FILES = new Set(["data.json", "process.json"]);

function filterStoneTree(node: FileTreeNode): FileTreeNode {
  if (!node.children) return node;
  const filtered = node.children
    .filter((c) => {
      if (c.type === "file" && node.marker === "stone" && STONE_HIDDEN_FILES.has(c.name)) return false;
      if (c.type === "directory" && node.marker === "stone" && STONE_HIDDEN_DIRS.has(c.name)) return false;
      if (c.type === "file" && node.name === "reflect" && FLOW_HIDDEN_FILES.has(c.name)) return false;
      return true;
    })
    .map((c) => c.type === "directory" ? filterStoneTree(c) : c);
  return { ...node, children: filtered };
}

/** 按分组配置重组文件树 children 为虚拟目录 */
function applyGroups(root: FileTreeNode, groups: GroupConfig["groups"]): FileTreeNode {
  if (!root.children || groups.length === 0) return root;

  const memberToGroup = new Map<string, string>();
  for (const g of groups) {
    for (const m of g.members) {
      memberToGroup.set(m.memberId, g.groupName);
    }
  }

  const groupedChildren = new Map<string, FileTreeNode[]>();
  const ungrouped: FileTreeNode[] = [];

  for (const child of root.children) {
    const groupName = memberToGroup.get(child.name);
    if (groupName) {
      if (!groupedChildren.has(groupName)) groupedChildren.set(groupName, []);
      groupedChildren.get(groupName)!.push(child);
    } else {
      ungrouped.push(child);
    }
  }

  const newChildren: FileTreeNode[] = [];

  /* 分组虚拟目录 */
  for (const g of groups) {
    const items = groupedChildren.get(g.groupName);
    if (!items || items.length === 0) continue;
    newChildren.push({
      name: g.groupName,
      type: "directory",
      path: `__group__/${g.groupName}`,
      children: items,
    });
  }

  /* 未分组的放在后面 */
  newChildren.push(...ungrouped);

  return { ...root, children: newChildren };
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
  const [activeFlow, setActiveFlow] = useAtom(activeSessionFlowAtom);
  const [activeId, setActiveId] = useAtom(activeSessionIdAtom);
  const [tabs, setTabs] = useAtom(editorTabsAtom);
  const [activePath, setActivePath] = useAtom(activeFilePathAtom);
  const [sidebarTree, setSidebarTree] = useAtom(sidebarTreeAtom);
  const setRefreshKey = useSetAtom(refreshKeyAtom);
  const isMobile = useIsMobile();
  useHashRouter();
  const [sessions, setSessions] = useAtom(userSessionsAtom);
  const sidebarMode = useAtomValue(messageSidebarModeAtom);

  /* sessionId → session title 的 lookup（面包屑用） */
  const sessionTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      const title = s.title || s.firstMessage?.slice(0, 40) || s.sessionId.slice(0, 16);
      map.set(s.sessionId, title);
    }
    return map;
  }, [sessions]);

  /* Flows tab: sessions 列表 vs session 文件树 */
  const [showSessions, setShowSessions] = useState(true);

  /* 移动端 Sheet 开关 */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [welcomeSending, setWelcomeSending] = useState(false);
  const [stoneGroups, setStoneGroups] = useState<GroupConfig["groups"]>([]);

  /* 当选中会话时自动切到文件树，取消选中时切回 sessions 并清除编辑器状态 */
  useEffect(() => {
    setShowSessions(!activeId);
    if (!activeId && activeTab === "flows") {
      setActivePath(null);
      setTabs([]);
    }
  }, [activeId]);

  /* 加载对象列表 + sessions + stone groups */
  useEffect(() => {
    fetchObjects().then(setObjects).catch(console.error);
    fetchSessions().then(setSessions).catch(console.error);
    fetchStoneGroups().then((c) => setStoneGroups(c.groups ?? [])).catch(() => {});
  }, [setObjects, setSessions]);

  /* SSE 连接 */
  useSSE();

  /* World tab: 加载项目文件树 */
  useEffect(() => {
    if (activeTab === "world" || activeTab === "stones") {
      fetchProjectTree().then(setSidebarTree).catch(console.error);
    }
  }, [activeTab, setSidebarTree]);

  /* Session title */
  const sessionTitle = activeFlow?.title
    || activeFlow?.messages?.[0]?.content?.slice(0, 40)
    || "";

  const handleTitleSave = async (newTitle: string) => {
    if (!activeFlow) return;
    try {
      await updateFlowTitle(activeFlow.sessionId, newTitle);
      setActiveFlow({ ...activeFlow, title: newTitle });
    } catch (e) {
      console.error(e);
    }
  };

  /* 打开文件 tab（通过 ViewRegistry 统一路由） */
  const openFileTab = useCallback((path: string, node: FileTreeNode) => {
    let resolvedPath = path;

    /* .stone 虚拟节点在 Flows 上下文中 → 重定向到 FlowView 路径 */
    if (activeTab === "flows" && activeId && node.marker === "stone") {
      const stoneMatch = path.match(/^stones\/([^/]+)$/);
      if (stoneMatch) {
        resolvedPath = `flows/${activeId}/objects/${stoneMatch[1]!}`;
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
        const existingResult = viewRegistry.resolve(t.path);
        return existingResult && existingResult.tabKey === tabKey;
      });
      if (existing) {
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
        return <SessionsList
          onSelect={() => isMobile && setSheetOpen(false)}
          onEditGroups={() => {
            /* 确保文件存在（groups API 会自动创建） */
            fetchFlowGroups().then(() => {
              setActivePath("flows/.flows.json");
              setTabs((prev) => {
                if (prev.some((t) => t.path === "flows/.flows.json")) return prev;
                return [...prev, { path: "flows/.flows.json", label: ".flows.json" }];
              });
            }).catch(console.error);
          }}
        />;
      }

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
            sessionId={activeId}
            onSelect={openFileTab}
            selectedPath={activePath ?? undefined}
          />
        </>
      );
    }

    if (activeTab === "stones") {
      if (!sidebarTree) return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">加载中...</p>;
      const stonesNode = sidebarTree.children?.find((c) => c.name === "stones");
      if (!stonesNode) return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">无 stones</p>;
      const filtered = filterStoneTree(stonesNode);

      /* 按分组重组 */
      const regrouped = applyGroups(filtered, stoneGroups);

      return (
        <>
          <div className="px-3 pb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
              Stones
            </span>
            <button
              onClick={() => {
                fetchStoneGroups().then(() => {
                  setActivePath("stones/.stones.json");
                  setTabs((prev) => {
                    if (prev.some((t) => t.path === "stones/.stones.json")) return prev;
                    return [...prev, { path: "stones/.stones.json", label: ".stones.json" }];
                  });
                }).catch(console.error);
              }}
              className="p-0.5 rounded hover:bg-[var(--accent)] transition-colors text-[var(--muted-foreground)]"
              title="编辑分组配置"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-auto px-1">
            <FileTree root={regrouped} onSelect={openFileTab} selectedPath={activePath ?? undefined} />
          </div>
        </>
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
    /* main 模式：消息面板占据主内容区 */
    if (sidebarMode === "main" && activeTab === "flows" && activeId && !isMobile) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex-1 min-h-0 rounded-md bg-[var(--card)] border border-[var(--border)] overflow-hidden">
            <MessageSidebar />
          </div>
        </div>
      );
    }

    /* 确定要渲染的内容和面包屑 */
    let breadcrumbSegments: string[] = [];
    let content: React.ReactNode = null;

    if (activePath && tabs.length > 0) {
      /* ViewRegistry 渲染（优先级最高） */
      breadcrumbSegments = activePath.split("/").filter(Boolean);
      const resolved = viewRegistry.resolve(activePath);
      const ViewComponent = resolved?.registration.component;
      content = ViewComponent ? <ViewComponent path={activePath} /> : (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-[var(--muted-foreground)]">无法识别的路径: {activePath}</p>
        </div>
      );
    } else if (activeTab === "flows" && !activeId) {
      /* Welcome 页面 */
      breadcrumbSegments = ["welcome"];
      content = (
        <WelcomePage
          onSend={async (t, msg) => {
            setWelcomeSending(true);
            try {
              /* 先创建 session 拿到 sessionId，再异步 talk */
              const { sessionId } = await createSession(t);
              const path = `flows/${sessionId}`;
              /* 乐观设置 flow 数据，让 MessageSidebar 立即显示用户消息 */
              setActiveFlow({
                sessionId,
                stoneName: t,
                status: "running",
                messages: [{ direction: "in", from: "human", to: t, content: msg, timestamp: Date.now() }],
                process: { root: { id: "root", title: "task", status: "doing", children: [], actions: [] }, focusId: "root" },
                data: {},
                createdAt: Date.now(),
                updatedAt: Date.now(),
              } as any);
              setActiveId(sessionId);
              setActivePath(path);
              setTabs([{ path, label: "Kanban" }]);
              /* fire-and-forget：不等 LLM 执行完成 */
              talkTo(t, msg, sessionId).catch(console.error);
            } catch (e) {
              console.error(e);
            } finally {
              setWelcomeSending(false);
            }
          }}
          sending={welcomeSending}
        />
      );
    } else if (activeTab === "flows" && activeId) {
      /* Session index → supervisor UI tab */
      const indexPath = `flows/${activeId}/objects/supervisor/ui/pages`;
      breadcrumbSegments = indexPath.split("/").filter(Boolean);
      const resolved = viewRegistry.resolve(indexPath);
      const ViewComponent = resolved?.registration.component;
      content = ViewComponent ? <ViewComponent path={indexPath} /> : null;
    } else {
      /* 空状态 */
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-[var(--muted-foreground)]">
            从侧边栏选择一个对象查看详情
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full gap-1.5">
        {/* Header：路径面包屑 + refresh */}
        <div className="flex items-center gap-0.5 px-3 py-2 text-[10px] text-[var(--muted-foreground)] overflow-x-auto scrollbar-hide shrink-0 bg-[var(--panel-bg)] rounded-[var(--panel-radius)]">
          {breadcrumbSegments.map((seg, i, arr) => (
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

        {/* Body：主内容 */}
        <div className="flex-1 overflow-auto bg-[var(--panel-bg)] rounded-[var(--panel-radius)]">
          {content}
        </div>
      </div>
    );
  };

  /* 侧边栏内容（桌面端和移动端共用） */
  const sidebarContent = (
    <div className="flex flex-col items-center h-full" style={{ width: "inherit" }}>
      <div className="flex flex-col items-center gap-1 px-4 py-4 shrink-0">
        <MainLogo isMobile={isMobile} />
      </div>

      {/* Tab 切换 */}
      <div className="px-3 pb-2 shrink-0 w-full">
        <nav className="flex items-center bg-[var(--accent)] rounded-full p-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setActivePath(null);
                  setTabs([]);
                }}
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

      {/* Session Bar（仅 Flows 模式有活跃会话时显示） */}
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

      {/* 当月使用热力图 */}
      <ActivityHeatmap />
    </div>
  );

  return (
    <div
      className="relative flex h-screen overflow-hidden bg-[var(--background)] gap-1.5 p-2"
    >
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
        <aside className="relative z-10 flex flex-col items-center w-72 shrink-0 bg-[var(--panel-bg)] rounded-[var(--panel-radius)] overflow-hidden">
          {sidebarContent}
        </aside>
      )}

      {/* ====== 右侧主内容区 ====== */}
      <main
        className={cn(
          "relative z-10 flex-1 overflow-hidden flex flex-col gap-1.5",
          isMobile && "mt-12 safe-bottom",
        )}
      >
        {renderMainContent()}
      </main>

      {/* 右侧消息侧边栏（仅 sidebar 模式） */}
      {activeTab === "flows" && activeId && !isMobile && sidebarMode === "sidebar" && (
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

      <button
        onClick={onToggleSessions}
        className="p-1.5 pr-2.5 rounded-r-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors shrink-0"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showSessions && "rotate-180")} />
      </button>
    </div>
  );
}
