/**
 * AppShell — ooc-2 visual port for ooc-3.
 *
 * Layout: sidebar (280px) + main panel (flex 1) — two-column since ooc-3
 * does not yet have a dedicated right chat column (chat is in main panel).
 *
 * Sidebar tabs: Sessions | Stones | Files | World
 * Main panel: <Outlet /> — routed views fill this space.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, Outlet, useParams } from "react-router";
import { Box, Database, Globe2, List, Plus, Zap } from "lucide-react";
import { listSessions, listStones, type Session, type StoneListItem } from "./api";
import { SessionList } from "./components/sessions/SessionList";
import { SidebarLogo } from "./components/brand/SidebarLogo";

type NavTab = "sessions" | "stones" | "files" | "world";

function tabFromPath(pathname: string): NavTab {
  if (pathname.startsWith("/stones")) return "stones";
  if (pathname.startsWith("/files")) return "files";
  if (pathname.startsWith("/world")) return "world";
  return "sessions";
}

function activeSessionIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/sessions\/([^/]+)/);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

const TEST_SESSION_PREFIX = "_test_";

function buildHeatmap(
  sessions: Session[],
  year: number,
  month: number,
): Array<{ className: string; title?: string }> {
  const counts = new Map<number, number>();
  for (const s of sessions) {
    if (!s.createdAt) continue;
    const d = new Date(Date.parse(s.createdAt));
    if (isNaN(d.getTime())) continue;
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDay = isCurrentMonth ? today.getDate() : -1;
  const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const cells: Array<{ className: string; title?: string }> = [];
  for (let day = 1; day <= 35; day++) {
    if (day > daysInMonth) { cells.push({ className: "empty" }); continue; }
    const n = counts.get(day) ?? 0;
    let level = n === 0 ? "" : n === 1 ? "lvl1" : n <= 3 ? "lvl2" : "lvl3";
    const classes = [level, day === todayDay ? "today" : ""].filter(Boolean).join(" ");
    cells.push({ className: classes, title: `${year}-${pad2(month + 1)}-${pad2(day)}: ${n} session${n === 1 ? "" : "s"}` });
  }
  return cells;
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabFromPath(location.pathname);
  const activeSessionId = activeSessionIdFromPath(location.pathname);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [showSessions, setShowSessions] = useState(!activeSessionId);

  // Refresh sessions list when on sessions tab or when location changes
  useEffect(() => {
    void listSessions().then((res) => setSessions(res.sessions)).catch(() => {});
  }, [location.pathname]);

  useEffect(() => {
    if (activeTab === "sessions") setShowSessions(!activeSessionId);
  }, [activeTab, activeSessionId]);

  const activeSessionTitle = activeSessionId ?? undefined;

  const tabs: Array<{ id: NavTab; label: string; icon: React.ReactNode; href: string }> = [
    { id: "sessions", label: "Sessions", icon: <Zap size={13} />, href: "/sessions" },
    { id: "stones", label: "Stones", icon: <Box size={13} />, href: "/stones" },
    { id: "files", label: "Files", icon: <Database size={13} />, href: "/files" },
    { id: "world", label: "World", icon: <Globe2 size={13} />, href: "/world" },
  ];

  const now = new Date();
  const calYear = now.getFullYear();
  const calMonth = now.getMonth();
  const heatmap = buildHeatmap(sessions, calYear, calMonth);
  const hiddenTestCount = sessions.filter((s) => s.sessionId.startsWith(TEST_SESSION_PREFIX)).length;

  function handleSelectSession(session: Session) {
    navigate(`/sessions/${encodeURIComponent(session.sessionId)}`);
  }

  function handleShowWelcome() {
    navigate("/sessions");
    setShowSessions(true);
  }

  return (
    <div className="app-shell">
      <div className="app-layout app-layout-no-right app-layout-fixed">
        {/* Sidebar */}
        <aside className="sidebar gap-2">
          <div className="sidebar-brand panel">
            <SidebarLogo />
          </div>

          <div className="sidebar-frame panel">
            {/* Nav tabs */}
            <div className="section nav-section">
              <div className="tabs">
                {tabs.map((tab) => (
                  <a
                    key={tab.id}
                    href={tab.href}
                    className={`tab ${activeTab === tab.id ? "active" : ""}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      navigate(tab.href);
                    }}
                  >
                    {tab.icon}
                    {tab.label}
                  </a>
                ))}
              </div>
            </div>

            {/* Session bar (shown when a session is active) */}
            {activeTab === "sessions" && activeSessionId && (
              <div className="sidebar-toolbar">
                <div className="session-bar">
                  <button className="session-bar-icon" onClick={() => setShowSessions((p) => !p)} title="Show sessions">
                    <List size={14} />
                  </button>
                  <button
                    className="session-bar-title"
                    onClick={() => setShowSessions((p) => !p)}
                    title={activeSessionTitle ?? "Untitled session"}
                  >
                    {activeSessionTitle ?? "Untitled session"}
                  </button>
                  <button className="session-bar-icon" onClick={handleShowWelcome} title="Create session" aria-label="Create session">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Sidebar body */}
            <div className="sidebar-pane">
              {activeTab === "sessions" ? (
                showSessions || !activeSessionId ? (
                  <div className="section">
                    <SessionList
                      sessions={sessions}
                      activeSessionId={activeSessionId}
                      onSelect={handleSelectSession}
                    />
                  </div>
                ) : (
                  <div className="section tree-section">
                    <p className="section-title">Session</p>
                    <div className="muted small" style={{ padding: "4px 8px" }}>
                      {activeSessionId}
                    </div>
                  </div>
                )
              ) : activeTab === "stones" ? (
                <div className="section tree-section">
                  <p className="section-title">Stones</p>
                  <StonesQuickList onSelect={(name) => navigate(`/stones/${encodeURIComponent(name)}`)} />
                </div>
              ) : activeTab === "files" ? (
                <div className="section tree-section">
                  <p className="section-title">Files</p>
                  <div className="muted small" style={{ padding: "4px 8px" }}>Use the files view →</div>
                </div>
              ) : (
                <div className="section tree-section">
                  <p className="section-title">World</p>
                  <div className="muted small" style={{ padding: "4px 8px" }}>World info in main panel →</div>
                </div>
              )}
            </div>

            {/* Calendar heatmap */}
            {sessions.length === 0 ? (
              <div className="session-calendar session-calendar-empty">
                <span className="muted small">No sessions yet</span>
              </div>
            ) : (
              <div className="session-calendar">
                <div className="calendar-title">
                  <span>{calYear}年{calMonth + 1}月</span>
                  <span>
                    {sessions.length} sessions
                    {hiddenTestCount > 0 && (
                      <span className="calendar-hidden-tag" title={`${hiddenTestCount} _test_ sessions`}>
                        {" "}({hiddenTestCount} 隐藏)
                      </span>
                    )}
                  </span>
                </div>
                <div className="calendar-grid">
                  {heatmap.map((cell, i) => (
                    <span key={i} className={cell.className} title={cell.title} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main panel */}
        <main className="main-panel gap-1">
          <div className="panel flex flex-col flex-grow" style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/** Compact stone list for sidebar */
function StonesQuickList({ onSelect }: { onSelect: (name: string) => void }) {
  const [stones, setStones] = useState<StoneListItem[]>([]);

  useEffect(() => {
    void listStones().then((res) => setStones(res.stones)).catch(() => {});
  }, []);

  if (stones.length === 0) return <div className="muted small" style={{ padding: "4px 8px" }}>No stones</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {stones.map((stone) => (
        <button
          key={stone.uri}
          className="list-button"
          onClick={() => onSelect(stone.name)}
          title={stone.uri}
        >
          <span style={{ fontSize: 12 }}>{stone.title ?? stone.name}</span>
        </button>
      ))}
    </div>
  );
}
