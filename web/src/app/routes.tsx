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
  { path: "/flows/:sessionId", ...shell },
  { path: "/flows/:sessionId/threads/:objectId/:threadId", ...shell },
  { path: "/flows/:sessionId/objects/:objectId/pages/:page", ...shell },
  { path: "*", element: <RouteErrorBoundary /> },
]);
