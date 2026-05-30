import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { flowTitle, type FlowSession } from "../../flows";

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

/**
 * Spec: engineering.harness.doc.ts:patches.test_session_hygiene
 *
 * sub agent 自验证产生的 session 一律用 `_test_<agent>_<ts>` 形态。前端默认隐藏,
 * 提供 toggle (eye / eye-off) 让人按需展开。toggle 状态用 localStorage 持久化
 * (key=`ooc.showTestSessions`),SSR 安全 (try/catch + window 检测)。
 */
const TEST_SESSION_PREFIX = "_test_";
const STORAGE_KEY = "ooc.showTestSessions";

function isTestSession(sessionId: string): boolean {
  return sessionId.startsWith(TEST_SESSION_PREFIX);
}

function readShowTestSessions(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeShowTestSessions(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // ignore: 隐私模式 / quota 满都不该阻断 UI
  }
  // Round 15 L1: 通知 sidebar calendar 月份 chip 联动隐藏计数显示。
  // 同标签页 localStorage 不会触发 'storage' 事件, 用自定义事件桥接。
  try {
    window.dispatchEvent(new CustomEvent("ooc:show-test-sessions-changed"));
  } catch {
    // ignore: 非浏览器环境（SSR / 测试桩）下 CustomEvent 不可用
  }
}

export function SessionList({ flows, activeSessionId, onSelect }: { flows: FlowSession[]; activeSessionId?: string; onSelect: (flow: FlowSession) => void }) {
  const [showTestSessions, setShowTestSessions] = useState<boolean>(() => readShowTestSessions());

  useEffect(() => {
    writeShowTestSessions(showTestSessions);
  }, [showTestSessions]);

  const testCount = flows.reduce((n, flow) => (isTestSession(flow.sessionId) ? n + 1 : n), 0);
  const visibleFlows = showTestSessions ? flows : flows.filter((flow) => !isTestSession(flow.sessionId));

  const dateGrouped = new Map<string, FlowSession[]>();
  const sortedFlows = [...visibleFlows].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const flow of sortedFlows) {
    const label = getDateLabel(flow.createdAt);
    if (!dateGrouped.has(label)) dateGrouped.set(label, []);
    dateGrouped.get(label)?.push(flow);
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
        {sortedFlows.length === 0 ? (
          <p className="session-list-empty">
            {flows.length === 0
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
                {items.map((flow) => {
                  const label = flowTitle(flow);
                  const test = isTestSession(flow.sessionId);
                  // R6 #47:session 列表项改 `<a href>` 让浏览器中键 / 复制链接 /
                  // 返回键生效;click 仍走 onSelect 触发 react-router SPA 导航
                  const href = `/flows/${encodeURIComponent(flow.sessionId)}`;
                  return (
                    <a
                      key={flow.sessionId}
                      href={href}
                      className={`list-button session-list-item ${flow.sessionId === activeSessionId ? "active" : ""} ${test ? "session-list-item-test" : ""}`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        onSelect(flow);
                      }}
                      title={`${label}\n${flow.sessionId}${test ? "\n(test session — hidden by default)" : ""}`}
                    >
                      <div className="session-list-item-row">
                        <span className="session-list-item-label" title={label}>{label}</span>
                        {test && <span className="session-list-item-tag">test</span>}
                      </div>
                      <div className="session-list-item-meta" title={flow.sessionId}>{flow.sessionId}</div>
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
