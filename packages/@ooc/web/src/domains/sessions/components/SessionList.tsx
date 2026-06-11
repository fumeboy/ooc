import { useEffect, useState } from "react";
import { Eye, EyeOff, Pin, PinOff } from "lucide-react";
import { flowTitle, type FlowSession } from "../../flows";
import { readPinned, togglePinned, writePinned } from "../pinned-sessions";

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
  const [pinned, setPinned] = useState<string[]>(() => readPinned());

  useEffect(() => {
    writeShowTestSessions(showTestSessions);
  }, [showTestSessions]);

  const pinnedSet = new Set(pinned);
  function handleTogglePin(sessionId: string) {
    setPinned((prev) => {
      const next = togglePinned(prev, sessionId);
      writePinned(next);
      return next;
    });
  }

  const testCount = flows.reduce((n, flow) => (isTestSession(flow.sessionId) ? n + 1 : n), 0);
  const visibleFlows = showTestSessions ? flows : flows.filter((flow) => !isTestSession(flow.sessionId));
  const sortedFlows = [...visibleFlows].sort((a, b) => b.updatedAt - a.updatedAt);

  // Pinned 分组排在最上方；pinned 的 session 与日期分组互斥（不重复出现）。
  const pinnedFlows = sortedFlows.filter((flow) => pinnedSet.has(flow.sessionId));
  const unpinnedFlows = sortedFlows.filter((flow) => !pinnedSet.has(flow.sessionId));

  const dateGrouped = new Map<string, FlowSession[]>();
  for (const flow of unpinnedFlows) {
    const label = getDateLabel(flow.createdAt);
    if (!dateGrouped.has(label)) dateGrouped.set(label, []);
    dateGrouped.get(label)?.push(flow);
  }

  const toggleTitle = showTestSessions
    ? `隐藏 ${testCount} 个测试会话（_test_ 前缀）`
    : testCount > 0
      ? `显示 ${testCount} 个隐藏会话（_test_ 前缀）`
      : "没有可显示的隐藏会话";

  const renderItem = (flow: FlowSession) => {
    const label = flowTitle(flow);
    const test = isTestSession(flow.sessionId);
    const isPinned = pinnedSet.has(flow.sessionId);
    // R6 #47:session 列表项改 `<a href>` 让浏览器中键 / 复制链接 /
    // 返回键生效;click 仍走 onSelect 触发 react-router SPA 导航
    const href = `/flows/${encodeURIComponent(flow.sessionId)}`;
    return (
      <div key={flow.sessionId} className="session-list-item-wrap">
        <a
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
        <button
          type="button"
          className={`mini-button session-list-pin ${isPinned ? "is-pinned" : ""}`}
          onClick={() => handleTogglePin(flow.sessionId)}
          title={isPinned ? "Unpin session" : "Pin session"}
          aria-label={isPinned ? "Unpin session" : "Pin session"}
          aria-pressed={isPinned}
        >
          {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      </div>
    );
  };

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
          data-testid="toggle-hidden-sessions"
        >
          {showTestSessions ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
      {!showTestSessions && testCount > 0 && (
        <button
          type="button"
          className="session-list-hidden-hint"
          onClick={() => setShowTestSessions(true)}
          data-testid="reveal-hidden-sessions-hint"
        >
          <EyeOff size={11} /> {testCount} 个会话已隐藏 — 点此显示
        </button>
      )}
      <nav className="session-list-nav">
        {sortedFlows.length === 0 ? (
          flows.length > 0 && testCount > 0 && !showTestSessions ? (
            <p className="session-list-empty">
              暂无可见会话 ——{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => setShowTestSessions(true)}
                data-testid="reveal-hidden-sessions"
              >
                显示 {testCount} 个隐藏会话
              </button>
            </p>
          ) : (
            <p className="session-list-empty">No sessions yet</p>
          )
        ) : (
          <>
            {pinnedFlows.length > 0 && (
              <div className="session-list-group session-list-group-pinned">
                <div className="session-list-group-label">Pinned</div>
                <div className="session-list-group-items">{pinnedFlows.map(renderItem)}</div>
              </div>
            )}
            {Array.from(dateGrouped.entries()).map(([label, items]) => (
              <div key={label} className="session-list-group">
                <div className="session-list-group-label">{label}</div>
                <div className="session-list-group-items">{items.map(renderItem)}</div>
              </div>
            ))}
          </>
        )}
      </nav>
    </div>
  );
}
