import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./AppShell";
import { SessionsView } from "./views/SessionsView";
import { SessionDetailView } from "./views/SessionDetailView";
import { SessionObjectView } from "./views/SessionObjectView";
import { StonesListView } from "./views/StonesListView";
import { StoneDetailView } from "./views/StoneDetailView";
import { FilesView } from "./views/FilesView";
import { WorldView } from "./views/WorldView";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <SessionsView /> },
      { path: "sessions", element: <SessionsView /> },
      { path: "sessions/:sessionId", element: <SessionDetailView /> },
      { path: "sessions/:sessionId/objects/:objectName", element: <SessionObjectView /> },
      { path: "stones", element: <StonesListView /> },
      { path: "stones/:name", element: <StoneDetailView /> },
      { path: "files/*", element: <FilesView /> },
      { path: "world", element: <WorldView /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
