/**
 * 路由表 — react-router v7（library mode）。
 *
 * 所有 path 都渲染同一个 AppShell（plan-003 §4 step 3 实施变体）：
 * AppShell 内通过 useRouteState() 从 URL 派生 RouteState，根据 kind 决定
 * 取数据 / 渲染哪个主视图。这样不需要把 AppShell 拆成多个 Page 文件 ——
 * 既兑现"URL 是导航源"，又控制 step 3 改造范围。
 *
 * 路径设计见 plan-003 §3.3。
 */
import { createBrowserRouter } from "react-router";
import { AppShell } from "./shell";
import { RouteErrorBoundary } from "./route-error";

const shell = { element: <AppShell />, errorElement: <RouteErrorBoundary /> };

export const router = createBrowserRouter([
  { path: "/", ...shell },
  { path: "/welcome", ...shell },
  { path: "/files/*", ...shell },
  { path: "/stones", ...shell },
  { path: "/stones/:objectId", ...shell },
  // R6 #45:sidebar "World" tab 之前导航到 /world 触发 Unknown route; 这里补齐
  // (parseRoute + scopeOf 早就支持 world scope,只是 route table 缺了一行)
  { path: "/world", ...shell },
  // R7-4 (2026-05-25): pools 是 2026-05-23 三分一等公民, sidebar 加 Pools tab
  { path: "/pools", ...shell },
  { path: "/flows", ...shell },
  // 2026-05-27 路由重构：path = view，sessionId 进 query
  { path: "/flows/index", ...shell },
  { path: "/flows/thread_context", ...shell },
  // Legacy 兼容：旧形态 /flows/:sessionId 与 /flows/:sessionId/threads/...
  // 仅 parseRoute 兼容，不再产出。命中后 useRouteState 会派回 flowsView，下次 navigate 重写。
  { path: "/flows/:sessionId", ...shell },
  { path: "/flows/:sessionId/threads/:objectId/:threadId", ...shell },
  { path: "/flows/:sessionId/:objectId/pages/:page", ...shell },
  // UI-2: catch-all 复用 AppShell；未知路径由 useRouteState→parseRoute 归
  // { kind: "notFound" }，MainPanel 在导航壳内渲染 RouteNotFound（不再脱壳裸页）。
  // RouteErrorBoundary 仍作 errorElement 兜真正的 loader/render 异常。
  { path: "*", ...shell },
]);
