import { Outlet, useLocation, useNavigate } from "react-router";
import { Database, Files, Layers } from "lucide-react";

type NavTab = "sessions" | "stones" | "files";

function tabFromPath(pathname: string): NavTab {
  if (pathname.startsWith("/stones")) return "stones";
  if (pathname.startsWith("/files")) return "files";
  return "sessions";
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabFromPath(location.pathname);

  return (
    <div className="app-shell">
      <div className="app-layout">
        {/* Sidebar */}
        <div className="panel sidebar">
          <div className="sidebar-header">
            <div className="sidebar-title">OOC-3</div>
            <div className="sidebar-subtitle">Object Oriented Context</div>
          </div>
          <div className="sidebar-nav">
            <div className="tabs">
              <button
                className={`tab${activeTab === "sessions" ? " active" : ""}`}
                onClick={() => navigate("/sessions")}
              >
                <Layers size={13} />
                Sessions
              </button>
              <button
                className={`tab${activeTab === "stones" ? " active" : ""}`}
                onClick={() => navigate("/stones")}
              >
                <Database size={13} />
                Stones
              </button>
              <button
                className={`tab${activeTab === "files" ? " active" : ""}`}
                onClick={() => navigate("/files")}
              >
                <Files size={13} />
                Files
              </button>
            </div>
          </div>
          <div className="sidebar-body">
            {/* Future: per-tab sidebar content (session list, stone list, file tree) */}
          </div>
        </div>

        {/* Main panel */}
        <div className="panel main-panel">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
