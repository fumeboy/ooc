import type { ReactNode } from "react";
import { Link } from "react-router";
import { Home } from "lucide-react";
import type { FileContent } from "../../domains/files";
import { FileViewer } from "../../domains/files/components/FileViewer";
import type { Stone } from "../../domains/stones";
import type { ThreadContext } from "../../domains/chat";
import { useDisplayName } from "../../domains/objects";
import { EmptyState } from "../../shared/ui/EmptyState";
import { IssueDetailView } from "../../domains/issues/components/IssueDetailView";
import { IssueListView } from "../../domains/issues/components/IssueListView";
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
  /** 已知存在的 sessionId 集合 — 用于在 session/thread/flowPage/issueDetail 路由下做 not-found 判定 */
  knownSessionIds?: ReadonlySet<string>;
  /** flows 列表是否已经被首次加载完 (避免首屏数据未到时误报 not-found) */
  flowsReady?: boolean;
  /** 当前布局模式（三栏 / 两栏）；用于 breadcrumb-bar 最左的切换按钮。 */
  layoutMode?: LayoutMode;
  /** 切换布局模式回调；shell 持有状态。 */
  onToggleLayoutMode?: () => void;
}) {
  const showBlockingError = Boolean(error && file);
  // 命中 plan-003 §3.1 时优先走 ClientWithSourceToggle；不命中走原 FileViewer 分支
  const clientTarget = path ? matchClientTarget(path) : undefined;
  // 派生 breadcrumb 时,凡显示 objectId 的段都替换为 displayName(spec: visible.display_name_from_self_md)
  // 原 objectId 保留在 breadcrumb-bar 的 title attr 中,供 hover 查看
  const breadcrumbObjectId = objectIdFromRoute(route);
  const { displayName: routeObjectDisplay } = useDisplayName(breadcrumbObjectId);
  const breadcrumbSegments = deriveBreadcrumbSegments(route, isWelcome, path, routeObjectDisplay);
  const breadcrumbText = breadcrumbSegments.map((s) => s.label).join(" › ");
  const headerTitle = deriveHeaderTitle(route, isWelcome, path, routeObjectDisplay);
  // route.kind === "scope" 时不进 FileViewer / Welcome / ClientToggle，
  // 而是渲染对应 scope 的引导空态（避免 fallback 到 file viewer 残留态）。
  const scopeEmpty = route.kind === "scope" ? scopeEmptyState(route.scope) : undefined;
  const isIssueDetail = route.kind === "issueDetail";
  const isIssueList = route.kind === "issueList";
  // user thread default: route.kind === "session" + (objectId 缺省 / === "user") + 非 file/client 路径
  const isUserThreadHome =
    route.kind === "session" &&
    (route.objectId === undefined || route.objectId === "user") &&
    !clientTarget &&
    !file;
  // R0c (Agent-loop Visualizer): 当 route 是 peer thread 上下文 (objectId !== "user")
  // 且未选文件 / client 时, 把原本直接 render 的 ContextSnapshotViewer (via FileViewer)
  // 替换为 ThreadDetailTabs (Context Snapshot ↔ Loop Timeline 两 tab 切换)。
  const isPeerThreadDetail =
    route.kind === "session" &&
    route.objectId !== undefined &&
    route.objectId !== "user" &&
    route.threadId !== undefined &&
    !clientTarget &&
    !file;
  // Issue #5 Bad #2 fix: `/flows/<bogus>` 进入 session 路由后既不是 scope 也不是
  // issueDetail / stoneClient,会 fallback 到 FileViewer 显示 "Select a file" —
  // 用户无法区分 "我没选文件" vs "session 根本不存在"。在 flows 列表已 ready 时
  // 用 knownSessionIds 做 cheap 判存在,不存在 → 显示 SessionNotFound 卡片。
  const sessionIdFromRoute = sessionIdFromRouteHelper(route);
  const sessionMissing =
    Boolean(sessionIdFromRoute) &&
    flowsReady === true &&
    knownSessionIds !== undefined &&
    !knownSessionIds.has(sessionIdFromRoute!);
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
          {!isWelcome && editableFile && !clientTarget && !isIssueDetail && <span className="pill">codemirror</span>}
          {clientTarget && <span className="pill">object client</span>}
          {isIssueDetail && <span className="pill">issue</span>}
          {isIssueList && <span className="pill">issues</span>}
          {isUserThreadHome && <span className="pill">user home</span>}
          {/*
           * H-1 (Round 5 体验报告) — 此处原本写 "backend offline";
           * 但触发条件仅是"页面级 loader 出错(404 / 500)",并非 backend 整体宕机
           * (左下角 MainLogo 的 health-check pill 是 backend 健康度真相源)。
           * 改为直接显示真实 error 摘要(截短),并标 "error",避免误导。
           */}
          {error && !file && !isWelcome && (
            <span className="muted small" title={error}>
              error: {error.length > 60 ? error.slice(0, 59) + "…" : error}
            </span>
          )}
          {threadHeader}
          <button type="button" className="refresh" onClick={onRefresh} disabled={loading || !onRefresh} aria-label="Refresh" title="Refresh">↻</button>
          {sessionIdFromRoute && (
            <Link
              to={toPath({ kind: "session", sessionId: sessionIdFromRoute })}
              className="refresh"
              aria-label="User home"
              title="User home (talk + issues)"
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
          ) : sessionMissing && !isIssueDetail ? (
            <SessionNotFound sessionId={sessionIdFromRoute!} />
          ) : scopeEmpty ? (
            <EmptyState title={scopeEmpty.title} detail={scopeEmpty.detail} />
          ) : route.kind === "issueDetail" ? (
            <IssueDetailView sessionId={route.sessionId} issueId={route.issueId} />
          ) : route.kind === "issueList" ? (
            <IssueListView sessionId={route.sessionId} />
          ) : clientTarget && path ? (
            <ClientWithSourceToggle target={clientTarget} sourcePath={path} />
          ) : isUserThreadHome && route.kind === "session" ? (
            <UserThreadHome
              sessionId={route.sessionId}
              thread={thread}
              onUserReply={onUserReply}
            />
          ) : isPeerThreadDetail && route.kind === "session" && route.objectId && route.threadId ? (
            <ThreadDetailTabs
              sessionId={route.sessionId}
              objectId={route.objectId}
              threadId={route.threadId}
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
    case "session":
    case "flowPage":
    case "issueList":
    case "issueDetail":
      return route.sessionId;
    default:
      return undefined;
  }
}

/**
 * 由当前路由派生 breadcrumb 段(结构化数组)。
 *
 * 设计：URL 是导航真相源，breadcrumb 必须 100% 反映 route，**不能**残留上次浏览的 path。
 * 修复 Issue #2 Bad #b — `/flows` / `/stones` / `/world` 路径下不能继续显示上次的 thread 路径。
 *
 * Issue #3 A3 fix: thread 路由下 breadcrumb 使用 humanizeThreadId 折叠 thread id（原 token
 * 通过 ThreadHeader / option title attr 仍可探查），避免与 headerTitle / ThreadHeader 重复
 * 拼接同一长 token 把顶栏撑爆甚至触发截断。
 *
 * displayName 派生(spec: visible.display_name_from_self_md): objectId 段用 displayName 替换,
 * 原 id 在段的 title attr 中保留。
 *
 * Issue #5 Bad #3 fix: 段结构化为 `{ label, href?, fullText? }`,可路由段渲染为
 * `<Link>` (用户可点击跳转); 长段(objectId / threadId / 长 path 子段) 在 title attr
 * 中保留完整文本,避免 ellipsis 后丢上下文。
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
    case "session":
      // session 路由可附带 thread query (?objectId=&threadId=)；带 thread 时
      // 展开完整 breadcrumb（含 objects / threads 段），否则仅 sessionId
      if (route.objectId && route.threadId) {
        return [
          { label: "flows", href: "/flows" },
          { label: route.sessionId, href: `/flows/${encodeURIComponent(route.sessionId)}`, fullText: route.sessionId },
          { label: "objects" },
          { label: objectDisplay || route.objectId, fullText: route.objectId },
          { label: "threads" },
          { label: humanizeThreadId(route.threadId), fullText: route.threadId },
        ];
      }
      return [
        { label: "flows", href: "/flows" },
        { label: route.sessionId, fullText: route.sessionId },
      ];
    case "issueList":
      return [
        { label: "flows", href: "/flows" },
        { label: route.sessionId, href: `/flows/${encodeURIComponent(route.sessionId)}`, fullText: route.sessionId },
        { label: "issues" },
      ];
    case "issueDetail":
      return [
        { label: "flows", href: "/flows" },
        { label: route.sessionId, href: `/flows/${encodeURIComponent(route.sessionId)}`, fullText: route.sessionId },
        { label: "issues", href: `/flows/${encodeURIComponent(route.sessionId)}/issues` },
        { label: `#${route.issueId}` },
      ];
    case "flowPage":
      return [
        { label: "flows", href: "/flows" },
        { label: route.sessionId, href: `/flows/${encodeURIComponent(route.sessionId)}`, fullText: route.sessionId },
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
 * 没有 objectId 段的路由(scope / session / issueDetail / file / welcome)返回 undefined。
 */
function objectIdFromRoute(route: RouteState): string | undefined {
  switch (route.kind) {
    case "stoneClient":
    case "flowPage":
      return route.objectId;
    case "session":
      return route.objectId;
    case "file":
      return route.thread?.objectId;
    default:
      return undefined;
  }
}

/**
 * headerTitle: 主标题（breadcrumb-bar 中 `<strong>`）。
 *
 * Issue #3 A3 fix: thread 路由下原本直接显示 `route.threadId` 字面值,
 * 与 breadcrumb（已含 thread 段）+ 同行 ThreadHeader（含 objectId · threadId · status）
 * 一起出现, 用户看到的是同一 thread id 在 1 行里出现 2-3 次。
 * thread 路由的语义"标题"由 ThreadHeader 承担; 这里 headerTitle 改为 objectId, 既避免重复,
 * 又保留"我现在在和谁对话"的强提示。
 *
 * displayName 派生: stoneClient / flowPage 用 displayName 替换 objectId 段。
 */
function deriveHeaderTitle(route: RouteState, isWelcome: boolean, path: string | undefined, objectDisplay: string): string {
  if (isWelcome || route.kind === "welcome") return "Welcome";
  switch (route.kind) {
    case "scope":
      return route.scope === "flows" ? "Flows" : route.scope === "stones" ? "Stones" : "World";
    case "stoneClient":
      return objectDisplay || route.objectId;
    case "session":
      // 带 thread 上下文时由 ThreadHeader 显示 oid+tid，避免顶栏与之重复 → 留空
      if (route.objectId && route.threadId) return "";
      return route.sessionId;
    case "issueList":
      return "Issues";
    case "issueDetail":
      return `Issue #${route.issueId}`;
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
