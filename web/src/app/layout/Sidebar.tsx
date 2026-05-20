import { MainLogo } from "../../shared/brand/MainLogo";
import { Box, Globe2, List, Plus, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { FileTreeNode, TreeScope } from "../../domains/files";
import { FileTree } from "../../domains/files/components/FileTree";
import type { FlowSession } from "../../domains/flows";
import { useIssues, type IssueSummary } from "../../domains/issues";
import { useDisplayNames } from "../../domains/objects";
import { SessionList } from "../../domains/sessions/components/SessionList";

function getFlowTree(root: FileTreeNode | undefined, sessionId: string | undefined) {
  if (!root || !sessionId) return root;
  if (root.path === `flows/${sessionId}`) return root;
  return root.children?.find((node) => node.path === `flows/${sessionId}` || node.name === sessionId) ?? root;
}

/**
 * issue-4 B5 fix: 把 flow tree 中 `issues/` 节点的 children 用 issues API 数据替换。
 *
 * - 原 file tree: `issue-1.json 9006B` / `index.json 645B` (持久化细节泄漏)
 * - 新呈现: `#1 标题... (closed) · 3 comments` (无字节后缀, index.json 自然消失)
 *
 * 不改 FileTree 组件本身; 通过合成 FileTreeNode 复用现有渲染路径。click 行为
 * 保留 — path 仍指向 `flows/<sid>/issues/issue-<id>.json`, 走 file viewer (B1
 * first-class detail 视图是下一轮的事, 见 issue-4 supervisor comment)。
 */
function injectIssuesIntoFlowTree(
  flowTree: FileTreeNode | undefined,
  sessionId: string | undefined,
  issues: IssueSummary[],
): FileTreeNode | undefined {
  if (!flowTree || !sessionId) return flowTree;
  const issuesPath = `flows/${sessionId}/issues`;
  let touched = false;
  const mapNode = (node: FileTreeNode): FileTreeNode => {
    if (node.path === issuesPath) {
      touched = true;
      return {
        ...node,
        children: issues
          .slice()
          .sort((a, b) => a.id - b.id)
          .map((issue) => issueToNode(sessionId, issue)),
      };
    }
    if (node.children) {
      return { ...node, children: node.children.map(mapNode) };
    }
    return node;
  };
  const next = mapNode(flowTree);
  // 没命中(后端还没创建 issues/ 目录, 或当前展开的不是该 session): 返回原值不重建对象
  return touched ? next : flowTree;
}

function issueToNode(sessionId: string, issue: IssueSummary): FileTreeNode {
  const status = issue.status === "open" ? "open" : "closed";
  const commentSuffix = issue.commentCount === 1 ? "1 comment" : `${issue.commentCount} comments`;
  // 截断 title 到 ~36 字符避免侧栏被撑爆; 完整 title 在 hover 时浏览器原生 title attr
  // 暂未透传 (FileTree button 用 .tree-label 不挂 title) — 是 polish 级 follow-up。
  const titleMax = 36;
  const trimmedTitle = issue.title.length > titleMax ? issue.title.slice(0, titleMax - 1) + "…" : issue.title;
  return {
    name: `#${issue.id} ${trimmedTitle} (${status}) · ${commentSuffix}`,
    type: "file",
    path: `flows/${sessionId}/issues/issue-${issue.id}.json`,
  };
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
    { scope: "world", label: "World", icon: <Globe2 size={13} /> },
  ];
  const flowTree = getFlowTree(tree, activeSessionId);
  // B5: issues API 数据驱动 sidebar 子项 (替换原 file tree `issue-*.json` + `index.json`)
  const { issues } = useIssues(scope === "flows" ? activeSessionId : undefined);
  const flowTreeWithIssues = injectIssuesIntoFlowTree(flowTree, activeSessionId, issues);
  // displayName 派生: 一次性 batch 拿到所有可见 Object 的语义化名,然后在渲染前替换 tree 节点 name
  const objectIds = collectObjectIds(scope === "stones" ? tree : undefined, scope === "flows" ? flowTreeWithIssues : undefined);
  const names = useDisplayNames(objectIds);
  const stonesTreeDisplay = scope === "stones" ? applyDisplayNameToTree(tree, names) : tree;
  const flowTreeDisplay = scope === "flows" ? applyDisplayNameToTree(flowTreeWithIssues, names) : flowTreeWithIssues;

  return (
    <aside className="sidebar gap-2">
      <div className="sidebar-brand panel">
        <MainLogo />
      </div>

      <div className="sidebar-frame panel">
        <div className="section nav-section">
          <div className="tabs">
            {tabs.map((item) => (
              <button key={item.scope} className={`tab ${scope === item.scope ? "active" : ""}`} onClick={() => onScope(item.scope)}>
                {item.icon}
                {item.label}
              </button>
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
          ) : (
            <div className="section tree-section">
              <p className="section-title">World tree</p>
              <FileTree root={tree} selectedPath={activePath} onSelect={onNode} onCreate={onCreateKnowledge} />
            </div>
          )}
        </div>

        <div className="session-calendar">
          <div className="calendar-title"><span>{calendarMonth(flows).label}</span><span>{flows.length} sessions</span></div>
          <div className="calendar-grid">{buildHeatmapCells(flows, calendarMonth(flows).year, calendarMonth(flows).month).map((cell, index) => <span key={index} className={cell.className} title={cell.title} />)}</div>
        </div>
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
