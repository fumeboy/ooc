/**
 * 路由 ↔ 应用导航状态 双向映射。
 *
 * 设计见 plan-003 §3.3、§3.4；2026-05 重构：thread 上下文从路径段
 * `/threads/<oid>/<tid>` 改为 query string `?objectId=...&threadId=...`，并允许
 * 任意路由（含 file）携带 thread 上下文，让 chat panel 跨文件查看保持显示。
 *
 * 单向真相：URL 是导航维度的源。AppShell 不再 setState 改 activePath /
 * activeSessionId 等；只调 toPath(...) + navigate(...)；URL 变化经 useRouteState
 * 回流为下一帧 state。
 */

import { useMemo } from "react";
import { useLocation, useParams } from "react-router";

/**
 * Thread 上下文：可选地附在任何路由上，让 chat panel 跨页面（含 file viewer）
 * 持续显示。在 query string 里编码为 `?sessionId=&objectId=&threadId=`（session
 * 路由因为 sessionId 已在 path 内，省略 sessionId）。
 */
export interface ThreadContext {
  sessionId: string;
  objectId: string;
  threadId: string;
}

export type RouteState =
  | { kind: "welcome" }
  | { kind: "scope"; scope: "stones" | "flows" | "world" | "pools" }
  | { kind: "file"; path: string; thread?: ThreadContext }
  | { kind: "stoneClient"; objectId: string }
  | { kind: "flowPage"; sessionId: string; objectId: string; page: string }
  | {
      kind: "session";
      sessionId: string;
      objectId?: string;
      threadId?: string;
      /**
       * 2026-05-26 user-home：左栏选中 chat 时写进 URL `?selected=chat:<wid>`；
       * undefined 表示空选中（右栏渲染 empty state）。
       *
       * 2026-05-26 Round 7 A3：issue 看板已移除，selected 仅剩 chat 一种。
       */
      selected?: { kind: "chat"; windowId: string };
    };

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
      const base = norm ?? `/files/${state.path}`;
      const qs = state.thread
        ? `?sessionId=${encodeURIComponent(state.thread.sessionId)}&objectId=${encodeURIComponent(state.thread.objectId)}&threadId=${encodeURIComponent(state.thread.threadId)}`
        : "";
      return `${base}${qs}`;
    }
    case "stoneClient":
      return `/stones/${encodeURIComponent(state.objectId)}`;
    case "flowPage":
      return `/flows/${encodeURIComponent(state.sessionId)}/objects/${encodeURIComponent(state.objectId)}/pages/${encodeURIComponent(state.page)}`;
    case "session": {
      const base = `/flows/${encodeURIComponent(state.sessionId)}`;
      // 手拼 query 而非 URLSearchParams：后者把空格编成 `+`（form-urlencoded），
      // 既有 routing.test 锁定的是 `%20`（encodeURIComponent 风格），保持一致。
      const parts: string[] = [];
      if (state.objectId && state.threadId) {
        parts.push(`objectId=${encodeURIComponent(state.objectId)}`);
        parts.push(`threadId=${encodeURIComponent(state.threadId)}`);
      }
      if (state.selected) {
        const v = `chat:${state.selected.windowId}`;
        parts.push(`selected=${encodeURIComponent(v)}`);
      }
      return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
    }
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
 * 路径段 splat（如 /files/*）从 location.pathname 重新切片；thread 上下文从
 * location.search 读 query string。
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
    () => parseRoute(location.pathname, location.search, params),
    [location.pathname, location.search, params.objectId, params.sessionId, params.threadId, params.page, params.id],
  );
}

/**
 * 纯函数版本——给单测 / 不在 react-router 上下文里用。
 *
 * params 优先取（react-router 已经解过 encode），fallback 自己手工切。
 * search 形如 `?objectId=&threadId=`，缺省即无 thread 上下文。
 */
export function parseRoute(
  pathname: string,
  search: string = "",
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
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const qObjectId = query.get("objectId") ?? undefined;
  const qThreadId = query.get("threadId") ?? undefined;
  const qSessionId = query.get("sessionId") ?? undefined;
  const qSelected = parseSelectedQuery(query.get("selected"));

  if (path === "/" || path === "/welcome") return { kind: "welcome" };

  // Legacy: /flows/:sessionId/threads/:objectId/:threadId — 老书签兼容；统一回归
  // 到 session + thread query 的语义（toPath 不再产此形态）
  if (params.sessionId && params.threadId && params.objectId && path.includes("/threads/")) {
    return {
      kind: "session",
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

  // /flows/:sessionId  (+ optional ?objectId=&threadId=&selected=)
  if (path.startsWith("/flows/") && params.sessionId && !params.objectId) {
    const r: RouteState = { kind: "session", sessionId: params.sessionId };
    if (qObjectId && qThreadId) {
      Object.assign(r, { objectId: qObjectId, threadId: qThreadId });
    }
    if (qSelected) {
      Object.assign(r, { selected: qSelected });
    }
    return r;
  }

  // /flows
  if (path === "/flows") return { kind: "scope", scope: "flows" };

  // /stones/:objectId
  if (path.startsWith("/stones/") && params.objectId) {
    return { kind: "stoneClient", objectId: params.objectId };
  }

  // /stones
  if (path === "/stones") return { kind: "scope", scope: "stones" };

  // /pools (R7-4)
  if (path === "/pools") return { kind: "scope", scope: "pools" };

  // /world
  if (path === "/world") return { kind: "scope", scope: "world" };

  // /files/* —— splat (+ optional ?sessionId=&objectId=&threadId= 维持 chat 上下文)
  if (path.startsWith("/files/")) {
    const rel = path.slice("/files/".length);
    if (rel) {
      const decoded = decodeURI(rel);
      const r: RouteState = { kind: "file", path: decoded };
      if (qSessionId && qObjectId && qThreadId) {
        return { ...r, thread: { sessionId: qSessionId, objectId: qObjectId, threadId: qThreadId } };
      }
      return r;
    }
  }

  // 兜底
  return { kind: "welcome" };
}

/** @deprecated 用 parseRoute(pathname, search, params)；旧名留作兼容。 */
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
  return parseRoute(pathname, "", params);
}

/**
 * 解析 ?selected=chat:<wid> query 值；不识别格式时返回 undefined（不报错）。
 * windowId 允许任意非空字符串。
 *
 * 2026-05-26 Round 7 A3：issue 看板已移除，selected 仅剩 chat 一种 tag。
 */
function parseSelectedQuery(
  raw: string | null,
): { kind: "chat"; windowId: string } | undefined {
  if (!raw) return undefined;
  const colon = raw.indexOf(":");
  if (colon <= 0) return undefined;
  const tag = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  if (!value) return undefined;
  if (tag === "chat") return { kind: "chat", windowId: value };
  return undefined;
}

/** 由 RouteState 派生 scope（Sidebar 用以高亮 tab）。R7-4 加 "pools"。 */
export function scopeOf(route: RouteState): "stones" | "flows" | "world" | "pools" {
  switch (route.kind) {
    case "welcome":
      return "flows";
    case "scope":
      return route.scope;
    case "file": {
      if (route.path.startsWith("stones/")) return "stones";
      if (route.path.startsWith("pools/")) return "pools";
      if (route.path.startsWith("flows/")) return "flows";
      return "world";
    }
    case "stoneClient":
      return "stones";
    case "flowPage":
    case "session":
      return "flows";
  }
}

/** 从一个 RouteState 抽出 thread 上下文（若有）；nav handler 保留 thread 用。 */
export function extractThreadContext(route: RouteState): ThreadContext | undefined {
  if (route.kind === "session" && route.objectId && route.threadId) {
    return { sessionId: route.sessionId, objectId: route.objectId, threadId: route.threadId };
  }
  if (route.kind === "file" && route.thread) return route.thread;
  return undefined;
}
