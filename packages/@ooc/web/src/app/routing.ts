/**
 * 路由 ↔ 应用导航状态 双向映射。
 *
 * 设计：
 * - **URL path 决定视图（"我在看哪种页面"）**；不再用来记录 sessionId。
 * - **URL query 记忆会话状态（sessionId / objectId / threadId）**——切视图时
 *   query 不变，右侧 RightPanel 持续显示同一 thread chat。
 *
 * 当前覆盖的 path 形态：
 * - `/`、`/welcome` —— Welcome
 * - `/flows`、`/stones`、`/world`、`/pools` —— scope landing
 * - `/flows/index?sessionId=…&objectId=…&threadId=…[&selected=…]` —— user home / SessionThreadsIndex
 * - `/flows/thread_context?sessionId=…&objectId=…&threadId=…` —— Context Tree（ThreadDetailTabs）
 * - `/flows/:sessionId/:objectId/pages/:page` —— flowPage（object client page）
 * - `/stones/:objectId` —— stone client
 * - `/files/<world-relative path>?[sessionId=&objectId=&threadId=]` —— 文件查看
 *
 * 兼容（**只解析不产出**）：
 * - `/flows/:sessionId[?objectId=&threadId=]` —— 旧形态，objectId !== "user" → thread_context；否则 → index
 * - `/flows/:sessionId/threads/:objectId/:threadId` —— 老书签，统一归 thread_context
 *
 * 单向真相：URL 是导航源。AppShell 不再 setState 改 activePath / activeSessionId 等；
 * 只调 toPath(...) + navigate(...)；URL 变化经 useRouteState 回流为下一帧 state。
 */

import { useMemo } from "react";
import { useLocation, useParams } from "react-router";

/**
 * Thread 上下文：附在路由上，让 chat panel 跨页面持续显示。在 query string 里编码为
 * `?sessionId=&objectId=&threadId=`（所有视图共用同一组 query keys，不再因路径形态而异）。
 */
export interface ThreadContext {
  sessionId: string;
  objectId: string;
  threadId: string;
}

export type FlowsView = "index" | "thread_context";

export type RouteState =
  | { kind: "welcome" }
  | { kind: "scope"; scope: "stones" | "flows" | "world" | "pools" }
  | { kind: "file"; path: string; thread?: ThreadContext }
  | { kind: "stoneClient"; objectId: string }
  | { kind: "flowPage"; sessionId: string; objectId: string; page: string }
  | {
      kind: "flowsView";
      /** 视图类型：path 第二段（/flows/index 或 /flows/thread_context）。 */
      view: FlowsView;
      /**
       * 当前会话状态（query string）。三者要么齐全（→ RightPanel 显示），要么 sessionId 单独
       * 出现（user home 仅"挑了 session 但没选 thread"），要么全缺（"Pick a session" 空态）。
       */
      sessionId?: string;
      objectId?: string;
      threadId?: string;
      /**
       * 2026-05-26 Round 7：左栏选中 chat / thread 也写进 URL；当前 SessionThreadsIndex
       * 已改为通过 objectId+threadId 切右栏，selected 字段保留只为旧链接兼容；新代码
       * 不再产出（toPath 仍然支持写出，确保 round-trip 测试通过）。
       */
      selected?:
        | { kind: "chat"; windowId: string }
        | { kind: "thread"; objectId: string; threadId: string };
      /**
       * Round 9 E3 (2026-05-26): Loop Time Machine 当前查看的 loopIndex。
       * - 仅在 thread 详情页（Loop Timeline tab）有意义；其它视图忽略。
       * - 不传 → 显示 Latest。
       * - 切 loop 不重新 navigate 整个页面；用 navigate + replace 微调 query 即可。
       */
      loop?: number;
    };

/**
 * 把 RouteState 反向转成 URL；shortcut 路径优先（plan-003 §3.3）。
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
      return `/flows/${encodeURIComponent(state.sessionId)}/${encodeURIComponent(state.objectId)}/pages/${encodeURIComponent(state.page)}`;
    case "flowsView": {
      const base = `/flows/${state.view}`;
      // 手拼 query 而非 URLSearchParams：后者把空格编成 `+`（form-urlencoded），
      // 既有 routing.test 锁定的是 `%20`（encodeURIComponent 风格），保持一致。
      const parts: string[] = [];
      if (state.sessionId) parts.push(`sessionId=${encodeURIComponent(state.sessionId)}`);
      if (state.objectId) parts.push(`objectId=${encodeURIComponent(state.objectId)}`);
      if (state.threadId) parts.push(`threadId=${encodeURIComponent(state.threadId)}`);
      if (state.selected) {
        const v =
          state.selected.kind === "chat"
            ? `chat:${state.selected.windowId}`
            : `thread:${state.selected.objectId}:${state.selected.threadId}`;
        parts.push(`selected=${encodeURIComponent(v)}`);
      }
      if (typeof state.loop === "number" && Number.isFinite(state.loop) && state.loop >= 0) {
        parts.push(`loop=${state.loop}`);
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
  // 2026-05-21 stones repo 重组：bare repo + linked worktrees，路径变成
  // `stones/<stonesBranch>/objects/<objectId>/client/index.tsx`。第一段是 branch（不捕获），
  // 第二段 objects/<objectId> 是 client 入口的 owner。
  const stone = /^stones\/[^/]+\/objects\/([^/]+)\/client\/index\.tsx$/.exec(path);
  if (stone) return `/stones/${encodeURIComponent(stone[1]!)}`;
  const flow = /^flows\/([^/]+)\/([^/]+)\/client\/pages\/([A-Za-z0-9_-]+)\.tsx$/.exec(path);
  if (flow) {
    return `/flows/${encodeURIComponent(flow[1]!)}/${encodeURIComponent(flow[2]!)}/pages/${encodeURIComponent(flow[3]!)}`;
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
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const qSessionId = query.get("sessionId") ?? undefined;
  const qObjectId = query.get("objectId") ?? undefined;
  const qThreadId = query.get("threadId") ?? undefined;
  const qSelected = parseSelectedQuery(query.get("selected"));
  const qLoop = parseLoopQuery(query.get("loop"));

  if (path === "/" || path === "/welcome") return { kind: "welcome" };

  // /flows/index, /flows/thread_context —— 新 path 形态（path = view）
  if (path === "/flows/index" || path === "/flows/thread_context") {
    const view: FlowsView = path === "/flows/thread_context" ? "thread_context" : "index";
    const r: RouteState = { kind: "flowsView", view };
    if (qSessionId) Object.assign(r, { sessionId: qSessionId });
    if (qObjectId) Object.assign(r, { objectId: qObjectId });
    if (qThreadId) Object.assign(r, { threadId: qThreadId });
    if (qSelected) Object.assign(r, { selected: qSelected });
    if (qLoop !== undefined) Object.assign(r, { loop: qLoop });
    return r;
  }

  // Legacy /flows/:sessionId/threads/:objectId/:threadId —— 老书签兼容；统一 thread_context
  if (params.sessionId && params.threadId && params.objectId && path.includes("/threads/")) {
    return {
      kind: "flowsView",
      view: "thread_context",
      sessionId: params.sessionId,
      objectId: params.objectId,
      threadId: params.threadId,
    };
  }

  // /flows/:sessionId/objects/:objectId/pages/:page —— flowPage 不变
  if (params.sessionId && params.objectId && params.page) {
    return {
      kind: "flowPage",
      sessionId: params.sessionId,
      objectId: params.objectId,
      page: params.page,
    };
  }

  // Legacy /flows/:sessionId[?objectId=&threadId=] —— 老形态：objectId !== "user" → thread_context；
  // 否则归 index（与旧 isUserThreadHome 行为对齐）。**不**产出，只解析。
  if (path.startsWith("/flows/") && params.sessionId && !params.objectId) {
    const isPeer = qObjectId !== undefined && qObjectId !== "user" && qThreadId !== undefined;
    const view: FlowsView = isPeer ? "thread_context" : "index";
    const r: RouteState = {
      kind: "flowsView",
      view,
      sessionId: params.sessionId,
    };
    if (qObjectId) Object.assign(r, { objectId: qObjectId });
    if (qThreadId) Object.assign(r, { threadId: qThreadId });
    if (qSelected) Object.assign(r, { selected: qSelected });
    if (qLoop !== undefined) Object.assign(r, { loop: qLoop });
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

  // /pools
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
 * 解析 `?loop=<N>` → 非负整数；非法值（负数 / NaN / 非数字）→ undefined 静默丢。
 *
 * Round 9 E3：Loop Time Machine 当前查看 loopIndex；不传 = Latest。
 */
function parseLoopQuery(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined;
  return n;
}

/**
 * 解析 `?selected=<tag>:<value>`；不识别格式 → undefined（silently 丢）。
 */
function parseSelectedQuery(
  raw: string | null,
):
  | { kind: "chat"; windowId: string }
  | { kind: "thread"; objectId: string; threadId: string }
  | undefined {
  if (!raw) return undefined;
  const colon = raw.indexOf(":");
  if (colon <= 0) return undefined;
  const tag = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  if (!value) return undefined;
  if (tag === "chat") return { kind: "chat", windowId: value };
  if (tag === "thread") {
    const sep = value.indexOf(":");
    if (sep <= 0) return undefined;
    const objectId = value.slice(0, sep);
    const threadId = value.slice(sep + 1);
    if (!objectId || !threadId) return undefined;
    return { kind: "thread", objectId, threadId };
  }
  return undefined;
}

/** 由 RouteState 派生 scope（Sidebar 用以高亮 tab）。 */
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
    case "flowsView":
      return "flows";
  }
}

/** 从一个 RouteState 抽出 thread 上下文（若有）；nav handler 保留 thread 用。 */
export function extractThreadContext(route: RouteState): ThreadContext | undefined {
  if (
    route.kind === "flowsView" &&
    route.sessionId &&
    route.objectId &&
    route.threadId
  ) {
    return {
      sessionId: route.sessionId,
      objectId: route.objectId,
      threadId: route.threadId,
    };
  }
  if (route.kind === "file" && route.thread) return route.thread;
  return undefined;
}
