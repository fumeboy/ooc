/**
 * IssueListView —— GitHub 风格 Issue 列表页。
 *
 * 路由：`/flows/:sessionId/issues` → `RouteState.kind === "issueList"`。
 *
 * 功能：
 * - 顶部 search input（按 title 或 #id 子串过滤）
 * - status 切换（Open / Closed / All）
 * - 行视觉：左 ● 状态图标（绿=open / 紫=closed）+ #id 单色等宽 + 标题 600 + 副标题 11px muted
 * - 默认排序：lastUpdatedAt desc
 * - 点击行 → 详情页（react-router Link）
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { useIssues } from "../query";
import { useDisplayName } from "../../objects";
import { timeAgo } from "./IssueDetailView";
import type { IssueSummary } from "../model";
import { toPath } from "../../../app/routing";

type StatusFilter = "open" | "closed" | "all";

interface IssueListViewProps {
  sessionId: string;
}

export function IssueListView({ sessionId }: IssueListViewProps) {
  const { issues, loading } = useIssues(sessionId);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byStatus = issues.filter((i) => {
      if (statusFilter === "all") return true;
      return i.status === statusFilter;
    });
    if (!q) return byStatus;
    return byStatus.filter((i) => {
      const idMatch = String(i.id).includes(q.replace(/^#/, ""));
      const titleMatch = i.title.toLowerCase().includes(q);
      return idMatch || titleMatch;
    });
  }, [issues, query, statusFilter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt),
    [filtered],
  );

  const openCount = issues.filter((i) => i.status === "open").length;
  const closedCount = issues.length - openCount;

  return (
    <div className="issue-list-view">
      <header className="issue-list-toolbar">
        <div className="issue-list-search">
          <Search size={14} className="issue-list-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="input issue-list-search-input"
            placeholder="Search issues by title or #id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="issue-list-filter" role="tablist" aria-label="Filter by status">
          <FilterTab
            label={`Open ${openCount}`}
            active={statusFilter === "open"}
            onClick={() => setStatusFilter("open")}
          />
          <FilterTab
            label={`Closed ${closedCount}`}
            active={statusFilter === "closed"}
            onClick={() => setStatusFilter("closed")}
          />
          <FilterTab
            label={`All ${issues.length}`}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
        </div>
      </header>

      <div className="issue-list-rows">
        {sorted.length === 0 ? (
          <div className="issue-list-empty">
            {loading && issues.length === 0
              ? "Loading…"
              : query
                ? `No issues match "${query}"`
                : statusFilter === "open"
                  ? "No open issues."
                  : statusFilter === "closed"
                    ? "No closed issues."
                    : "No issues yet."}
          </div>
        ) : (
          <ul className="issue-list-ul">
            {sorted.map((iss) => (
              <IssueRow key={iss.id} sessionId={sessionId} issue={iss} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`issue-list-filter-tab ${active ? "is-active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function IssueRow({
  sessionId,
  issue,
}: {
  sessionId: string;
  issue: IssueSummary;
}) {
  const { displayName } = useDisplayName(issue.createdByObjectId);
  const href = toPath({ kind: "issueDetail", sessionId, issueId: issue.id });
  return (
    <li>
      <Link to={href} className={`issue-list-row issue-list-row-${issue.status}`}>
        <span
          className={`issue-list-status issue-list-status-${issue.status}`}
          aria-label={issue.status}
        >
          ●
        </span>
        <div className="issue-list-row-body">
          <div className="issue-list-row-title-line">
            <span className="issue-list-row-title">{issue.title}</span>
            <span className="issue-list-row-id">#{issue.id}</span>
          </div>
          <div className="issue-list-row-meta">
            <span title={issue.createdByObjectId}>opened by {displayName}</span>
            <span aria-hidden> · </span>
            <span title={new Date(issue.lastUpdatedAt).toISOString()}>
              updated {timeAgo(issue.lastUpdatedAt)}
            </span>
            {issue.commentCount > 0 && (
              <>
                <span aria-hidden> · </span>
                <span>
                  {issue.commentCount} comment{issue.commentCount === 1 ? "" : "s"}
                </span>
              </>
            )}
            {issue.status === "closed" && (
              <>
                <span aria-hidden> · </span>
                <span className="issue-list-row-meta-closed">closed</span>
              </>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
