import type { ReactNode } from "react";
import { Link } from "react-router";
import { Home } from "lucide-react";
import type { FileContent } from "../../domains/files";
import { FileViewer } from "../../domains/files/components/FileViewer";
import type { Stone } from "../../domains/stones";
import type { ThreadContext } from "../../domains/chat";
import { useDisplayName } from "../../domains/objects";
import { EmptyState } from "../../shared/ui/EmptyState";
import { UserThreadHome } from "../../domains/sessions/components/UserThreadHome";
import { ThreadDetailTabs } from "../../domains/sessions/components/ThreadDetailTabs";
import { Welcome } from "./Welcome";
import {
  ClientWithSourceToggle,
  matchClientTarget,
} from "../../domains/clients/ClientWithSourceToggle";
import { toPath, type RouteState } from "../routing";
import { LayoutModeToggle, type LayoutMode } from "./LayoutModeToggle";
import { humanizeThreadId } from "./threadDisplay";

export function MainPanel({
  route,
  isWelcome = false,
  stones = [],
  onCreateSession,
  file,
  path,
  error,
  loading,
  editableFile,
  savingFile,
  onFileChange,
  onFileSave,
  thread,
  selfObjectId,
  onUserReply,
  onRefresh,
  threadHeader,
  knownSessionIds,
  flowsReady,
  layoutMode,
  onToggleLayoutMode,
}: {
  route: RouteState;
  isWelcome?: boolean;
  stones?: Stone[];
  onCreateSession?: (input: { sessionId: string; targetObjectId: string; initialMessage: string }) => Promise<void>;
  file?: FileContent;
  path?: string;
  error?: string;
  loading: boolean;
  editableFile?: boolean;
  savingFile?: boolean;
  onFileChange?: (content: string) => void;
  onFileSave?: () => void;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
  onRefresh?: () => void | Promise<void>;
  threadHeader?: ReactNode;
  /** 已知存在的 sessionId 集合 — 用于在 flowsView/flowPage 路由下做 not-found 判定 */
  knownSessionIds?: ReadonlySet<string>;
  /** flows 列表是否已经被首次加载完 (避免首屏数据未到时误报 not-found) */
  flowsReady?: boolean;
  /** 当前布局模式（三栏 / 两栏）；用于 breadcrumb-bar 最左的切换按钮。 */
  layoutMode?: LayoutMode;
  /** 切换布局模式回调；shell 持有状态。 */
  onToggleLayoutMode?: () => void;
}) {
  const showBlockingError = Boolean(error && file);
  const clientTarget = path ? matchClientTarget(path) : undefined;
  const breadcrumbObjectId = objectIdFromRoute(route);
  const { displayName: routeObjectDisplay } = useDisplayName(breadcrumbObjectId);
  const breadcrumbSegments = deriveBreadcrumbSegments(route, isWelcome, path, routeObjectDisplay);
  const breadcrumbText = breadcrumbSegments.map((s) => s.label).join(" › ");
  const headerTitle = deriveHeaderTitle(route, isWelcome, path, routeObjectDisplay);
  const scopeEmpty = route.kind === "scope" ? scopeEmptyState(route.scope) : undefined;

  // 2026-05-27 路由重构：path = view，sessionId 进 query。
  // user-home（SessionThreadsIndex）= /flows/index 路径；要求 sessionId 已设置才渲染主体，
  // 否则展示 "Pick a session" empty state（与 /flows scope 空态对齐）。
  const isUserHomeView =
    route.kind === "flowsView" && route.view === "index" && !clientTarget && !file;
  const userHomeReady = isUserHomeView && route.kind === "flowsView" && Boolean(route.sessionId);

  // thread_context view = /flows/thread_context；要求 sessionId+objectId+threadId 全 set
  const isThreadContextView =
    route.kind === "flowsView" && route.view === "thread_context" && !clientTarget && !file;
  const threadContextReady =
    isThreadContextView &&
    route.kind === "flowsView" &&
    Boolean(route.sessionId && route.objectId && route.threadId);

  const sessionIdFromRoute = sessionIdFromRouteHelper(route);
  const sessionMissing =
    Boolean(sessionIdFromRoute) &&
    flowsReady === true &&
    knownSessionIds !== undefined &&
    !knownSessionIds.has(sessionIdFromRoute!);

  // Home 按钮 target：/flows/index，保留当前 query（sessionId/objectId/threadId）。
  // sessionId 缺失时不渲染（没意义，Home 已经在 index 视图里）。
  const homeTarget =
    route.kind === "flowsView" && route.sessionId
      ? toPath({
          kind: "flowsView",
          view: "index",
          sessionId: route.sessionId,
          objectId: route.objectId,
          threadId: route.threadId,
        })
      : undefined;

  return (
    <main className="main-panel gap-1">
      <div className="breadcrumb-bar panel">
        {layoutMode && onToggleLayoutMode && (
          <LayoutModeToggle
            mode={layoutMode}
            onToggle={onToggleLayoutMode}
            className="breadcrumb-layout-toggle"
          />
        )}
        <span className="breadcrumb-segments" title={breadcrumbText}>
          {breadcrumbSegments.map((seg, i) => (
            <span key={i} className="breadcrumb-segment-wrap">
              {i > 0 && <span className="breadcrumb-sep" aria-hidden="true"> › </span>}
              {seg.href ? (
                <Link to={seg.href} className="breadcrumb-segment is-link" title={seg.fullText ?? seg.label}>
                  {seg.label}
                </Link>
              ) : (
                <span className="breadcrumb-segment" title={seg.fullText ?? seg.label}>
                  {seg.label}
                </span>
              )}
            </span>
          ))}
        </span>
        <div className="flex items-center gap-3">
          <strong title={typeof headerTitle === "string" ? headerTitle : undefined}>{headerTitle}</strong>
          {loading && <span className="pill">loading</span>}
          {!isWelcome && editableFile && !clientTarget && <span className="pill">codemirror</span>}
          {clientTarget && <span className="pill">object client</span>}
          {isUserHomeView && <span className="pill">user home</span>}
          {isThreadContextView && <span className="pill">thread context</span>}
          {error && !file && !isWelcome && (
            <span className="muted small" title={error}>
              error: {error.length > 60 ? error.slice(0, 59) + "…" : error}
            </span>
          )}
          {threadHeader}
          <button type="button" className="refresh" onClick={onRefresh} disabled={loading || !onRefresh} aria-label="Refresh" title="Refresh">↻</button>
          {homeTarget && (
            <Link
              to={homeTarget}
              className="refresh"
              aria-label="User home"
              title="User home (talk)"
            >
              <Home size={14} strokeWidth={1.8} />
            </Link>
          )}
        </div>
      </div>
      <div className="panel flex flex-col flex-grow">
        <div className="main-body">
          {showBlockingError && <div className="section compact"><div className="error">{error}</div></div>}
          {isWelcome ? (
            <Welcome stones={stones} onCreateSession={onCreateSession} />
          ) : sessionMissing ? (
            <SessionNotFound sessionId={sessionIdFromRoute!} />
          ) : scopeEmpty ? (
            <EmptyState title={scopeEmpty.title} detail={scopeEmpty.detail} />
          ) : clientTarget && path ? (
            <ClientWithSourceToggle target={clientTarget} sourcePath={path} />
          ) : isUserHomeView && !userHomeReady ? (
            <EmptyState
              title="Pick a session"
              detail="从左侧 sidebar 选一个 session，或在 welcome 页新建。"
            />
          ) : userHomeReady && route.kind === "flowsView" ? (
            <UserThreadHome
              sessionId={route.sessionId!}
              thread={thread}
              selfObjectId={selfObjectId}
              onUserReply={onUserReply}
            />
          ) : isThreadContextView && !threadContextReady ? (
            <EmptyState
              title="No thread selected"
              detail="URL 里需要带 ?sessionId=&objectId=&threadId= 才能展示 thread context。"
            />
          ) : threadContextReady && route.kind === "flowsView" ? (
            <ThreadDetailTabs
              sessionId={route.sessionId!}
              objectId={route.objectId!}
              threadId={route.threadId!}
              thread={thread}
              selfObjectId={selfObjectId}
              onUserReply={onUserReply}
            />
          ) : (
            <FileViewer
              file={file}
              path={route.kind === "file" ? route.path : undefined}
              error={route.kind === "file" ? error : undefined}
              editable={editableFile}
              saving={savingFile}
              onChange={onFileChange}
              onSave={onFileSave}
              thread={thread}
              selfObjectId={selfObjectId}
              onUserReply={onUserReply}
              sessionId={sessionIdFromRoute}
            />
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Issue #5 Bad #2 fix: session 不存在时的 first-class 错误卡, 替换原来
 * FileViewer "Select a file" 的歧义提示。
 */
function SessionNotFound({ sessionId }: { sessionId: string }) {
  return (
    <div className="p-6" data-testid="session-not-found" style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Session not found</h2>
      <p className="muted small">
        没有找到 sessionId 为 <code title={sessionId}>{sessionId}</code> 的 flow session — 它可能已被删除,或 URL 拼写有误。
      </p>
      <p>
        <Link to="/flows" className="btn">← Browse all sessions / 查看全部 sessions</Link>
      </p>
    </div>
  );
}

function sessionIdFromRouteHelper(route: RouteState): string | undefined {
  switch (route.kind) {
    case "flowsView":
    case "flowPage":
      return route.sessionId;
    default:
      return undefined;
  }
}

/**
 * 由当前路由派生 breadcrumb 段(结构化数组)。
 *
 * 2026-05-27 路由重构：flowsView 替代旧 session；sessionId 段链向 /flows/index?sessionId=...
 * 而非旧 /flows/<sid>。
 */
interface BreadcrumbSeg { label: string; href?: string; fullText?: string }
function deriveBreadcrumbSegments(route: RouteState, isWelcome: boolean, path: string | undefined, objectDisplay: string): BreadcrumbSeg[] {
  if (isWelcome || route.kind === "welcome") {
    return [{ label: "flows", href: "/flows" }, { label: "welcome" }];
  }
  switch (route.kind) {
    case "scope":
      return [{ label: route.scope, href: `/${route.scope}` }];
    case "stoneClient":
      return [
        { label: "stones", href: "/stones" },
        { label: objectDisplay || route.objectId, fullText: route.objectId },
      ];
    case "flowsView": {
      // sessionId 缺失：仅 flows + view label
      const segs: BreadcrumbSeg[] = [{ label: "flows", href: "/flows" }];
      if (!route.sessionId) {
        segs.push({ label: route.view });
        return segs;
      }
      const sessionHref = toPath({ kind: "flowsView", view: "index", sessionId: route.sessionId });
      segs.push({ label: route.sessionId, href: sessionHref, fullText: route.sessionId });
      // 带 thread 上下文：展开 objects/threads 段
      if (route.objectId && route.threadId) {
        segs.push({ label: "objects" });
        segs.push({ label: objectDisplay || route.objectId, fullText: route.objectId });
        segs.push({ label: "threads" });
        segs.push({ label: humanizeThreadId(route.threadId), fullText: route.threadId });
      }
      return segs;
    }
    case "flowPage":
      return [
        { label: "flows", href: "/flows" },
        {
          label: route.sessionId,
          href: toPath({ kind: "flowsView", view: "index", sessionId: route.sessionId }),
          fullText: route.sessionId,
        },
        { label: "objects" },
        { label: objectDisplay || route.objectId, fullText: route.objectId },
        { label: "pages" },
        { label: route.page },
      ];
    case "file": {
      const full = path ?? route.path;
      return full.split("/").map((label) => ({ label, fullText: label }));
    }
  }
}

/**
 * 取当前路由中"被用作 objectId"的那一段(用来 useDisplayName 派生标题)。
 */
function objectIdFromRoute(route: RouteState): string | undefined {
  switch (route.kind) {
    case "stoneClient":
    case "flowPage":
      return route.objectId;
    case "flowsView":
      return route.objectId;
    case "file":
      return route.thread?.objectId;
    default:
      return undefined;
  }
}

/**
 * headerTitle: 主标题（breadcrumb-bar 中 `<strong>`）。带 thread 上下文时由 ThreadHeader
 * 显示 oid+tid，避免与之重复 → 留空。
 */
function deriveHeaderTitle(route: RouteState, isWelcome: boolean, path: string | undefined, objectDisplay: string): string {
  if (isWelcome || route.kind === "welcome") return "Welcome";
  switch (route.kind) {
    case "scope":
      return route.scope === "flows" ? "Flows" : route.scope === "stones" ? "Stones" : "World";
    case "stoneClient":
      return objectDisplay || route.objectId;
    case "flowsView":
      // 带 thread 上下文 → ThreadHeader 接管 → 留空
      if (route.objectId && route.threadId) return "";
      return route.sessionId ?? (route.view === "index" ? "User home" : "Thread context");
    case "flowPage":
      return route.page;
    case "file":
      return (path ?? route.path).split("/").at(-1) ?? "OOC World";
  }
}

function scopeEmptyState(scope: "stones" | "flows" | "world" | "pools"): { title: string; detail: string } {
  if (scope === "flows") {
    return {
      title: "Select a session",
      detail: "Pick a session from the left sidebar, or create a new one from the welcome page (top of sidebar).",
    };
  }
  if (scope === "stones") {
    return {
      title: "Select a stone",
      detail: "Pick a stone from the left sidebar to view its self.md / readme.md / client.tsx and knowledge tree.",
    };
  }
  if (scope === "pools") {
    return {
      title: "Browse pools",
      detail: "Pick a pool object from the left sidebar to view its data / knowledge / files (sediment & shared repos).",
    };
  }
  return {
    title: "Browse world files",
    detail: "Pick a file from the world tree on the left to preview its content.",
  };
}
