/**
 * SessionList — ported from ooc-2 with ooc-3 Session type.
 */
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Session } from "../../api";

const TEST_SESSION_PREFIX = "_test_";
const STORAGE_KEY = "ooc.showTestSessions";

function isTestSession(sessionId: string): boolean {
  return sessionId.startsWith(TEST_SESSION_PREFIX);
}

function readShowTestSessions(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
}

function writeShowTestSessions(value: boolean): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false"); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("ooc:show-test-sessions-changed")); } catch { /* ignore */ }
}

function getDateLabel(ts: number) {
  const now = new Date();
  const date = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (target.getTime() === today.getTime()) return "今天";
  if (target.getTime() === yesterday.getTime()) return "昨天";
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);
  if (diffDays < 7) return "最近 7 天";
  if (diffDays < 30) return "最近 30 天";
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function sessionTitle(session: Session): string {
  // Use sessionId as title since ooc-3 doesn't have a title field yet
  return session.sessionId;
}

function sessionCreatedAt(session: Session): number {
  if (session.createdAt) {
    const ts = Date.parse(session.createdAt);
    return isNaN(ts) ? 0 : ts;
  }
  return 0;
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
}: {
  sessions: Session[];
  activeSessionId?: string;
  onSelect: (session: Session) => void;
}) {
  const [showTestSessions, setShowTestSessions] = useState<boolean>(() => readShowTestSessions());

  useEffect(() => { writeShowTestSessions(showTestSessions); }, [showTestSessions]);

  const testCount = sessions.reduce((n, s) => (isTestSession(s.sessionId) ? n + 1 : n), 0);
  const visibleSessions = showTestSessions ? sessions : sessions.filter((s) => !isTestSession(s.sessionId));

  const dateGrouped = new Map<string, Session[]>();
  const sorted = [...visibleSessions].sort((a, b) => sessionCreatedAt(b) - sessionCreatedAt(a));
  for (const session of sorted) {
    const ts = sessionCreatedAt(session);
    const label = ts ? getDateLabel(ts) : "Earlier";
    if (!dateGrouped.has(label)) dateGrouped.set(label, []);
    dateGrouped.get(label)?.push(session);
  }

  const toggleTitle = showTestSessions
    ? `Hide _test_ sessions (${testCount} hidden when off)`
    : testCount > 0
      ? `Show ${testCount} hidden _test_ session${testCount === 1 ? "" : "s"}`
      : "No _test_ sessions to show";

  return (
    <div className="session-list-shell">
      <div className="session-list-header">
        <span className="session-list-title">Sessions</span>
        <button
          type="button"
          className="mini-button"
          onClick={() => setShowTestSessions((prev) => !prev)}
          title={toggleTitle}
          aria-label={toggleTitle}
          aria-pressed={showTestSessions}
        >
          {showTestSessions ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
      <nav className="session-list-nav">
        {sorted.length === 0 ? (
          <p className="session-list-empty">
            {sessions.length === 0
              ? "No sessions yet"
              : testCount > 0 && !showTestSessions
                ? `No sessions (${testCount} _test_ hidden)`
                : "No sessions yet"}
          </p>
        ) : (
          Array.from(dateGrouped.entries()).map(([label, items]) => (
            <div key={label} className="session-list-group">
              <div className="session-list-group-label">{label}</div>
              <div className="session-list-group-items">
                {items.map((session) => {
                  const title = sessionTitle(session);
                  const test = isTestSession(session.sessionId);
                  const href = `/sessions/${encodeURIComponent(session.sessionId)}`;
                  return (
                    <a
                      key={session.sessionId}
                      href={href}
                      className={`list-button session-list-item ${session.sessionId === activeSessionId ? "active" : ""} ${test ? "session-list-item-test" : ""}`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        onSelect(session);
                      }}
                      title={`${title}\n${session.sessionId}${test ? "\n(test session)" : ""}`}
                    >
                      <div className="session-list-item-row">
                        <span className="session-list-item-label" title={title}>{title}</span>
                        {test && <span className="session-list-item-tag">test</span>}
                      </div>
                      <div className="session-list-item-meta" title={session.sessionId}>
                        {session.threadCount > 0 && `${session.threadCount} thread${session.threadCount !== 1 ? "s" : ""} · `}
                        {session.sessionId}
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
