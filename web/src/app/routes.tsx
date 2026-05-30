/**
 * Route table — ooc-3 adaptation.
 * All paths render AppShell; route state derived from URL via useRouteState().
 * Mirrors ooc-2 routes.tsx.
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
  { path: "/world", ...shell },
  { path: "/pools", ...shell },
  { path: "/flows", ...shell },
  { path: "/flows/index", ...shell },
  { path: "/flows/thread_context", ...shell },
  // Legacy compat
  { path: "/flows/:sessionId", ...shell },
  { path: "/flows/:sessionId/threads/:objectId/:threadId", ...shell },
  { path: "/flows/:sessionId/objects/:objectId/pages/:page", ...shell },
  { path: "*", element: <RouteErrorBoundary /> },
]);
