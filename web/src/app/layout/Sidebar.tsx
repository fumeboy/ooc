import { MainLogo } from "../../shared/brand/MainLogo";
import { Box, Database, Globe2, List, Plus, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { FileTreeNode, TreeScope } from "../../domains/files";
import { FileTree } from "../../domains/files/components/FileTree";
import type { FlowSession } from "../../domains/flows";
import { useDisplayNames } from "../../domains/objects";
import { SessionList } from "../../domains/sessions/components/SessionList";

/**
 * Round 15 L1: user home calendar 月份 chip 加 "(N 隐藏)" 微标签——sidebar 列表默认隐藏
 * `_test_` 前缀的 session 时，"X sessions" 总数与可见列表不直观联动，初看有困惑。
 * 这里读取 `ooc.showTestSessions` localStorage（与 SessionList 同源）并在 hidden > 0
 * 时显示一个紧凑的隐藏计数。
 */
const TEST_SESSION_STORAGE_KEY = "ooc.showTestSessions";
const TEST_SESSION_PREFIX = "_test_";

function readShowTestSessions(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TEST_SESSION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** 订阅 localStorage 与 SessionList 内 toggle 引发的隐藏计数变化，保持 chip 与列表联动。 */
function useShowTestSessions(): boolean {
  const [value, setValue] = useState<boolean>(() => readShowTestSessions());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setValue(readShowTestSessions());
    // 跨标签页 / 同标签页 SessionList toggle 同步：
    // - storage 事件: 其他标签页改 localStorage
    // - 自定义事件 ooc:show-test-sessions-changed: SessionList toggle 时 dispatch
    window.addEventListener("storage", sync);
    window.addEventListener("ooc:show-test-sessions-changed", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("ooc:show-test-sessions-changed", sync as EventListener);
    };
  }, []);
  return value;
}

function getFlowTree(root: FileTreeNode | undefined, sessionId: string | undefined) {
  if (!root || !sessionId) return root;
  if (root.path === `flows/${sessionId}`) return root;
  return root.children?.find((node) => node.path === `flows/${sessionId}` || node.name === sessionId) ?? root;
}

/**
 * displayName 派生(spec: visible.display_name_from_self_md):把 FileTree 中"代表 Object"的
 * 目录节点的 `name` 字段(=objectId)替换成 self.md 第一行派生的 displayName,
 * `path` 不变(后端 / 路由仍用原 objectId)。
 *
 * 覆盖范围:
 *   - `stones/<objectId>`: stones 视图的 stone 根目录
 *   - `flows/<sid>/objects/<objectId>`: flows 视图的 flow object 根目录
 *
 * 未命中 displayName 时保持原 name(=objectId),不破坏现有体验。原 objectId 暂未通过
 * FileTree 的 button title attr 透出(FileTree 组件未挂 title) — polish 级 follow-up。
 */
function applyDisplayNameToTree(
  node: FileTreeNode | undefined,
  names: Record<string, string>,
): FileTreeNode | undefined {
  if (!node) return node;
  const map = (n: FileTreeNode): FileTreeNode => {
    let next = n;
    const stoneMatch = n.path.match(/^stones\/([^/]+)$/);
    const flowObjMatch = n.path.match(/^flows\/[^/]+\/objects\/([^/]+)$/);
    const objectId = stoneMatch?.[1] ?? flowObjMatch?.[1];
    if (objectId && names[objectId] && names[objectId] !== objectId) {
      next = { ...n, name: names[objectId]! };
    }
    if (next.children) {
      next = { ...next, children: next.children.map(map) };
    }
    return next;
  };
  return map(node);
}

/**
 * 从 stones tree / flow tree 顶层收集所有 "代表 Object 的目录" 的 objectId,
 * 让 Sidebar 一次性 batch 预热它们的 displayName(避免 N 次串行请求)。
 */
function collectObjectIds(stonesTree: FileTreeNode | undefined, flowTree: FileTreeNode | undefined): string[] {
  const set = new Set<string>();
  const walk = (n: FileTreeNode | undefined) => {
    if (!n) return;
    const stoneMatch = n.path.match(/^stones\/([^/]+)$/);
    const flowObjMatch = n.path.match(/^flows\/[^/]+\/objects\/([^/]+)$/);
    if (stoneMatch) set.add(stoneMatch[1]!);
    if (flowObjMatch) set.add(flowObjMatch[1]!);
    n.children?.forEach(walk);
  };
  walk(stonesTree);
  walk(flowTree);
  return Array.from(set);
}

/**
 * 派生 sidebar 日历的标题（"YYYY年M月" 中文）与对应的 year/month（用于 heatmap）。
 *
 * - 有 flows: 取最近 createdAt 所在年月（让标题对应用户最常浏览的 session 时间段）
 * - 无 flows: fallback 当前 new Date() 所在年月
 */
function calendarMonth(flows: FlowSession[]): { year: number; month: number; label: string } {
  const latest = flows.reduce<number | undefined>((acc, flow) => {
    if (!Number.isFinite(flow.createdAt)) return acc;
    return acc === undefined || flow.createdAt > acc ? flow.createdAt : acc;
  }, undefined);
  const date = latest !== undefined ? new Date(latest) : new Date();
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    label: `${date.getFullYear()}年${date.getMonth() + 1}月`,
  };
}

/**
 * 按当前显示月份内 sessions 的 createdAt 分布给 heatmap 35 格上色。
 *
 * - 月内每一天对应一格（1..daysInMonth），其余补到 35 格用空色块占位
 * - 颜色等级: 0=灰 / 1=浅绿 / 2-3=中绿 / 4+=深绿（复用 status pill 系绿色）
 * - 当天（today）用 ring 高亮（.today className）
 * - 每格挂 title attr: "YYYY-MM-DD: N sessions"
 */
function buildHeatmapCells(
  flows: FlowSession[],
  year: number,
  month: number,
): Array<{ className: string; title?: string }> {
  const counts = new Map<number, number>();
  for (const flow of flows) {
    if (!Number.isFinite(flow.createdAt)) continue;
    const d = new Date(flow.createdAt);
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
    if (day > daysInMonth) {
      cells.push({ className: "empty" });
      continue;
    }
    const n = counts.get(day) ?? 0;
    let level: string;
    if (n === 0) level = "";
    else if (n === 1) level = "lvl1";
    else if (n <= 3) level = "lvl2";
    else level = "lvl3";
    const classes = [level, day === todayDay ? "today" : ""].filter(Boolean).join(" ");
    const title = `${year}-${pad2(month + 1)}-${pad2(day)}: ${n} session${n === 1 ? "" : "s"}`;
    cells.push({ className: classes, title });
  }
  return cells;
}

export function Sidebar({ scope, flows, tree, activePath, activeSessionId, activeSessionTitle, showSessions, onToggleSessions, onShowWelcome, onScope, onNode, onSession, onCreateStone, onCreateKnowledge }: { scope: TreeScope; flows: FlowSession[]; tree?: FileTreeNode; activePath?: string; activeSessionId?: string; activeSessionTitle?: string; showSessions: boolean; onToggleSessions: () => void; onShowWelcome: () => void; onScope: (scope: TreeScope) => void; onNode: (node: FileTreeNode) => void; onSession: (flow: FlowSession) => void; onCreateStone?: () => void; onCreateKnowledge?: (node: FileTreeNode) => void }) {
  const tabs: Array<{ scope: TreeScope; label: string; icon: ReactNode }> = [
    { scope: "flows", label: "Flows", icon: <Zap size={13} /> },
    { scope: "stones", label: "Stones", icon: <Box size={13} /> },
    // R7-4（2026-05-25）：pools 是 2026-05-23 三分一等公民，应作为 sidebar tab 显式呈现
    { scope: "pools", label: "Pools", icon: <Database size={13} /> },
    { scope: "world", label: "World", icon: <Globe2 size={13} /> },
  ];
  const flowTree = getFlowTree(tree, activeSessionId);
  // displayName 派生: 一次性 batch 拿到所有可见 Object 的语义化名,然后在渲染前替换 tree 节点 name
  const objectIds = collectObjectIds(scope === "stones" ? tree : undefined, scope === "flows" ? flowTree : undefined);
  const names = useDisplayNames(objectIds);
  const stonesTreeDisplay = scope === "stones" ? applyDisplayNameToTree(tree, names) : tree;
  const flowTreeDisplay = scope === "flows" ? applyDisplayNameToTree(flowTree, names) : flowTree;

  // Round 15 L1: calendar 月份 chip 联动 _test_ 隐藏计数
  const showTestSessions = useShowTestSessions();
  const hiddenTestCount = showTestSessions
    ? 0
    : flows.reduce((n, flow) => (flow.sessionId.startsWith(TEST_SESSION_PREFIX) ? n + 1 : n), 0);

  return (
    <aside className="sidebar gap-2">
      <div className="sidebar-brand panel">
        <MainLogo />
      </div>

      <div className="sidebar-frame panel">
        <div className="section nav-section">
          <div className="tabs">
            {/*
              R6 #47:scope tabs 改用 `<a href>` 让浏览器右键 / 中键 / 复制链接 /
              返回键全部生效;onClick preventDefault + 调 onScope 走 react-router
              SPA 路径(不触发整页 reload)。
             */}
            {tabs.map((item) => (
              <a
                key={item.scope}
                href={`/${item.scope}`}
                className={`tab ${scope === item.scope ? "active" : ""}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 让浏览器原生处理新标签 / 新窗口
                  e.preventDefault();
                  onScope(item.scope);
                }}
              >
                {item.icon}
                {item.label}
              </a>
            ))}
          </div>
        </div>

        {scope === "flows" && activeSessionId && (
          <div className="sidebar-toolbar">
            <SessionBar title={activeSessionTitle ?? activeSessionId} onToggleSessions={onToggleSessions} onShowWelcome={onShowWelcome} />
          </div>
        )}

        <div className="sidebar-pane">
          {scope === "flows" ? (
            showSessions || !activeSessionId ? (
              <div className="section">
                <SessionList flows={flows} activeSessionId={activeSessionId} onSelect={onSession} />
              </div>
            ) : (
              <div className="section tree-section">
                <p className="section-title">Flow tree</p>
                <FileTree root={flowTreeDisplay} selectedPath={activePath} onSelect={onNode} onCreate={onCreateKnowledge} />
              </div>
            )
          ) : scope === "stones" ? (
            <div className="section tree-section">
              <div className="row space-between">
                <p className="section-title" style={{ marginBottom: 0 }}>Stones tree</p>
                <button className="mini-button" title="Create object" onClick={onCreateStone}>
                  <Plus size={12} />
                </button>
              </div>
              <FileTree root={stonesTreeDisplay} selectedPath={activePath} onSelect={onNode} onCreate={onCreateKnowledge} />
            </div>
          ) : scope === "pools" ? (
            <div className="section tree-section">
              <p className="section-title">Pools tree</p>
              <FileTree root={tree} selectedPath={activePath} onSelect={onNode} onCreate={onCreateKnowledge} />
            </div>
          ) : (
            <div className="section tree-section">
              <p className="section-title">World tree</p>
              <FileTree root={tree} selectedPath={activePath} onSelect={onNode} onCreate={onCreateKnowledge} />
            </div>
          )}
        </div>

        {/*
          R6 #48:flows 为空时不再渲染"2026年5月 / 0 sessions"+ 灰格 heatmap
          —— 空状态信号 stronger,空 list 显示明确文案而非误以为是月份分组头。
         */}
        {flows.length === 0 ? (
          <div className="session-calendar session-calendar-empty">
            <span className="muted small">No sessions yet</span>
          </div>
        ) : (
          <div className="session-calendar">
            <div className="calendar-title">
              <span>{calendarMonth(flows).label}</span>
              <span>
                {flows.length} sessions
                {hiddenTestCount > 0 && (
                  <span
                    className="calendar-hidden-tag"
                    title={`${hiddenTestCount} _test_ session${hiddenTestCount === 1 ? "" : "s"} 已隐藏；点眼睛 toggle 显示`}
                    data-testid="calendar-hidden-tag"
                  >
                    {" "}({hiddenTestCount} 隐藏)
                  </span>
                )}
              </span>
            </div>
            <div className="calendar-grid">{buildHeatmapCells(flows, calendarMonth(flows).year, calendarMonth(flows).month).map((cell, index) => <span key={index} className={cell.className} title={cell.title} />)}</div>
          </div>
        )}
      </div>
    </aside>
  );
}

function SessionBar({ title, onToggleSessions, onShowWelcome }: { title: string; onToggleSessions: () => void; onShowWelcome: () => void }) {
  return (
    <div className="session-bar">
      <button className="session-bar-icon" onClick={onToggleSessions} title="Show sessions">
        <List size={14} />
      </button>
      <button className="session-bar-title" onClick={onToggleSessions} title={title || "Untitled session"}>
        {title || "Untitled session"}
      </button>
      <button className="session-bar-icon" onClick={onShowWelcome} title="Create session" aria-label="Create session">
        <Plus size={14} />
      </button>
    </div>
  );
}
