/**
 * 路由 ↔ 应用导航状态 双向映射。
 *
 * 设计见 plan-003 §3.3、§3.4。
 *
 * 单向真相：URL 是导航维度的源。AppShell 不再 setState 改 activePath /
 * activeSessionId 等；只调 toPath(...) + navigate(...)；URL 变化经 useRouteState
 * 回流为下一帧 state。
 */

import { useMemo } from "react";
import { useLocation, useParams } from "react-router";

export type RouteState =
  | { kind: "welcome" }
  | { kind: "scope"; scope: "stones" | "flows" | "world" }
  | { kind: "file"; path: string }
  | { kind: "stoneClient"; objectId: string }
  | { kind: "flowPage"; sessionId: string; objectId: string; page: string }
  | { kind: "session"; sessionId: string }
  | { kind: "issueDetail"; sessionId: string; issueId: number }
  | { kind: "thread"; sessionId: string; objectId: string; threadId: string };

/**
 * 把 RouteState 反向转成 URL；shortcut 路径优先（plan-003 §3.3）。
 *
 * 命中 §3.1 的 file path 会规范化为 /stones/{id} 或 /flows/.../pages/{name}。
 */
export function toPath(state: RouteState): string {
  switch (state.kind) {
    case "welcome":
      return "/";
    case "scope":
      return `/${state.scope}`;
    case "file": {
      const norm = normalizeClientFilePath(state.path);
      if (norm) return norm;
      return `/files/${state.path}`;
    }
    case "stoneClient":
      return `/stones/${encodeURIComponent(state.objectId)}`;
    case "flowPage":
      return `/flows/${encodeURIComponent(state.sessionId)}/objects/${encodeURIComponent(state.objectId)}/pages/${encodeURIComponent(state.page)}`;
    case "session":
      return `/flows/${encodeURIComponent(state.sessionId)}`;
    case "issueDetail":
      return `/flows/${encodeURIComponent(state.sessionId)}/issues/${state.issueId}`;
    case "thread":
      return `/flows/${encodeURIComponent(state.sessionId)}/threads/${encodeURIComponent(state.objectId)}/${encodeURIComponent(state.threadId)}`;
  }
}

/**
 * 若 file path 是某 client 入口的完整路径，返回对应 shortcut URL；否则 undefined。
 * 与 ClientWithSourceToggle.matchClientTarget 同一组 regex。
 */
export function normalizeClientFilePath(path: string): string | undefined {
  const stone = /^stones\/([^/]+)\/client\/index\.tsx$/.exec(path);
  if (stone) return `/stones/${encodeURIComponent(stone[1]!)}`;
  const flow = /^flows\/([^/]+)\/objects\/([^/]+)\/client\/pages\/([A-Za-z0-9_-]+)\.tsx$/.exec(path);
  if (flow) {
    return `/flows/${encodeURIComponent(flow[1]!)}/objects/${encodeURIComponent(flow[2]!)}/pages/${encodeURIComponent(flow[3]!)}`;
  }
  return undefined;
}

/**
 * 从当前 URL 派生 RouteState。靠 react-router 的 useParams 拿命名 params；
 * 路径段 splat（如 /files/*）从 location.pathname 重新切片。
 */
export function useRouteState(): RouteState {
  const location = useLocation();
  const params = useParams<{
    objectId?: string;
    sessionId?: string;
    threadId?: string;
    page?: string;
    id?: string;
  }>();
  // 必须 memoize：useEffect deps 比较 RouteState 对象 ref；不 memo 会触发
  // "Maximum update depth exceeded" 循环。
  return useMemo(
    () => parsePathname(location.pathname, params),
    [location.pathname, params.objectId, params.sessionId, params.threadId, params.page, params.id],
  );
}

/**
 * 纯函数版本——给单测 / 不在 react-router 上下文里用。
 *
 * params 优先取（react-router 已经解过 encode），fallback 自己手工切。
 */
export function parsePathname(
  pathname: string,
  params: {
    objectId?: string;
    sessionId?: string;
    threadId?: string;
    page?: string;
    id?: string;
  } = {},
): RouteState {
  // 末尾 slash 去掉，方便比较
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");

  if (path === "/" || path === "/welcome") return { kind: "welcome" };

  // /flows/:sessionId/threads/:objectId/:threadId
  if (params.sessionId && params.threadId && params.objectId && path.includes("/threads/")) {
    return {
      kind: "thread",
      sessionId: params.sessionId,
      objectId: params.objectId,
      threadId: params.threadId,
    };
  }

  // /flows/:sessionId/objects/:objectId/pages/:page
  if (params.sessionId && params.objectId && params.page) {
    return {
      kind: "flowPage",
      sessionId: params.sessionId,
      objectId: params.objectId,
      page: params.page,
    };
  }

  // /flows/:sessionId/issues/:id  (first-class Issue 详情, issue-4 B3)
  if (params.sessionId && params.id !== undefined && /\/issues\//.test(path)) {
    const issueId = parseIssueIdToken(params.id);
    if (issueId !== undefined) {
      return { kind: "issueDetail", sessionId: params.sessionId, issueId };
    }
  }

  // /flows/:sessionId
  if (path.startsWith("/flows/") && params.sessionId && !params.objectId) {
    return { kind: "session", sessionId: params.sessionId };
  }

  // /flows
  if (path === "/flows") return { kind: "scope", scope: "flows" };

  // /stones/:objectId
  if (path.startsWith("/stones/") && params.objectId) {
    return { kind: "stoneClient", objectId: params.objectId };
  }

  // /stones
  if (path === "/stones") return { kind: "scope", scope: "stones" };

  // /world
  if (path === "/world") return { kind: "scope", scope: "world" };

  // /files/* —— splat
  if (path.startsWith("/files/")) {
    const rel = path.slice("/files/".length);
    if (rel) {
      // issue-4 B3 fallback: 旧链接 `/files/flows/<sid>/issues/issue-N.json` (或
      // 其它变体) 现在直达 IssueDetailView, 不再撞 file viewer raw JSON。
      const decoded = decodeURI(rel);
      const issueHit = matchIssueFilePath(decoded);
      if (issueHit) {
        return { kind: "issueDetail", sessionId: issueHit.sessionId, issueId: issueHit.issueId };
      }
      return { kind: "file", path: decoded };
    }
  }

  // issue-4 B3 fallback: 未走 /files/ 前缀的"裸 file path"形式
  // `/flows/<sid>/issues/issue-N.json` 也归一到 detail (react-router 不会有
  // 命名 param `id` 命中, 因为路由表里 `:id` 段不允许带 `.json`)。
  {
    const issueHit = matchIssueFilePath(path.startsWith("/") ? path.slice(1) : path);
    if (issueHit) {
      return { kind: "issueDetail", sessionId: issueHit.sessionId, issueId: issueHit.issueId };
    }
  }

  // 兜底
  return { kind: "welcome" };
}

/**
 * 解析 issue id token: `4` / `issue-4` / `issue-4.json` 都接受, 取数字部分。
 * 失败返回 undefined。
 */
function parseIssueIdToken(token: string): number | undefined {
  const m = /^(?:issue-)?(\d+)(?:\.json)?$/.exec(token);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 匹配 world 相对路径 `flows/<sid>/issues/issue-N.json`,
 * 返回 { sessionId, issueId }。用于把旧的 file-viewer 链接归一到 IssueDetailView。
 */
function matchIssueFilePath(rel: string): { sessionId: string; issueId: number } | undefined {
  const m = /^flows\/([^/]+)\/issues\/issue-(\d+)\.json$/.exec(rel);
  if (!m) return undefined;
  const issueId = Number(m[2]);
  if (!Number.isFinite(issueId)) return undefined;
  return { sessionId: m[1]!, issueId };
}

/** 由 RouteState 派生 scope（Sidebar 用以高亮 tab）。 */
export function scopeOf(route: RouteState): "stones" | "flows" | "world" {
  switch (route.kind) {
    case "welcome":
      return "flows";
    case "scope":
      return route.scope;
    case "file": {
      if (route.path.startsWith("stones/")) return "stones";
      if (route.path.startsWith("flows/")) return "flows";
      return "world";
    }
    case "stoneClient":
      return "stones";
    case "flowPage":
    case "session":
    case "issueDetail":
    case "thread":
      return "flows";
  }
}
