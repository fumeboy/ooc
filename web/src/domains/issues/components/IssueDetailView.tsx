import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { useDisplayName } from "../../objects";
import { useIssue } from "../query";
import type { Issue, IssueComment } from "../model";

/**
 * IssueDetailView (issue-4 B1+B2) — first-class Issue 详情视图。
 *
 * 取代上一轮"sidebar 子项 → file viewer 渲染 raw JSON"的体验:
 * - markdown 渲染 description 与 comments.text (复用 `MarkdownContent`)
 * - status badge (open=绿 / closed=灰), author chip, 相对时间
 * - comments 用独立卡片视觉分隔, padding/gap 取自 GitHub Issue 节奏
 *
 * 路由由 shell.tsx 在 `route.kind === "issueDetail"` 时挂载。MainPanel 的
 * breadcrumb 已在 `deriveBreadcrumb` 加分支显示 `flows › <sid> › issues › #N`,
 * 因此本组件不再自渲染 breadcrumb,避免双 breadcrumb 视觉重叠。
 */
export function IssueDetailView({
  sessionId,
  issueId,
}: {
  sessionId: string;
  issueId: number;
}) {
  const { issue, loading, error } = useIssue(sessionId, issueId);

  if (error && !issue) {
    return (
      <div className="p-6">
        <div className="error">Failed to load issue #{issueId}: {error}</div>
      </div>
    );
  }
  if (!issue) {
    return (
      <div className="p-6 text-sm" style={{ color: "var(--muted-foreground)" }}>
        {loading ? `Loading issue #${issueId}...` : `Issue #${issueId} not found`}
      </div>
    );
  }
  return <IssueDetailBody issue={issue} />;
}

function IssueDetailBody({ issue }: { issue: Issue }) {
  return (
    <article className="issue-detail">
      <header className="issue-detail-header">
        <h1 className="issue-detail-title">
          <span className="issue-detail-id">#{issue.id}</span>{" "}
          <span>{issue.title}</span>
        </h1>
        <div className="issue-detail-meta">
          <StatusBadge status={issue.status} />
          <AuthorChip objectId={issue.createdByObjectId} />
          <TimeChip
            createdAt={issue.createdAt}
            lastUpdatedAt={issue.lastUpdatedAt}
          />
        </div>
      </header>

      <section className="issue-detail-description">
        <MarkdownContent content={issue.description} />
      </section>

      <CommentsSection comments={issue.comments} />
    </article>
  );
}

function CommentsSection({ comments }: { comments: IssueComment[] }) {
  if (comments.length === 0) {
    return (
      <div className="issue-detail-comments-empty">No comments yet.</div>
    );
  }
  return (
    <section>
      <div className="issue-detail-comments-divider">
        <span>Comments ({comments.length})</span>
      </div>
      <ul className="issue-detail-comments">
        {comments.map((c) => (
          <li key={c.id} className="issue-comment-card">
            <div className="issue-comment-head">
              <span className="issue-comment-index">#{c.id}</span>
              <AuthorChip objectId={c.authorObjectId} />
              <span
                className="issue-comment-time"
                title={new Date(c.createdAt).toISOString()}
              >
                {timeAgo(c.createdAt)}
              </span>
            </div>
            <div className="issue-comment-body">
              <MarkdownContent content={c.text} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusBadge({ status }: { status: "open" | "closed" }) {
  return (
    <span className={`issue-status-badge issue-status-${status}`}>
      {status === "open" ? "open" : "closed"}
    </span>
  );
}

function AuthorChip({ objectId }: { objectId: string }) {
  // displayName 派生(spec: visible.display_name_from_self_md):未加载 / 失败时回退 objectId。
  // 原 objectId 永远在 title attr 中保留供 hover 查看。
  const { displayName } = useDisplayName(objectId);
  return (
    <span className="issue-author-chip" title={objectId}>
      <span className="issue-author-dot" aria-hidden>●</span>
      {displayName}
    </span>
  );
}

function TimeChip({
  createdAt,
  lastUpdatedAt,
}: {
  createdAt: number;
  lastUpdatedAt: number;
}) {
  const updated = lastUpdatedAt && lastUpdatedAt !== createdAt;
  return (
    <span className="issue-time-chip" title={new Date(createdAt).toISOString()}>
      created {timeAgo(createdAt)}
      {updated && (
        <>
          {" · updated "}
          <span title={new Date(lastUpdatedAt).toISOString()}>
            {timeAgo(lastUpdatedAt)}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * 极简相对时间(< 30 行,不引依赖)。
 * 跨度: 秒 / 分 / 小时 / 天 / 月 / 年; 月按 30 天, 年按 365 天近似。
 */
export function timeAgo(ts: number, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec} seconds ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ${hr === 1 ? "hour" : "hours"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} ${day === 1 ? "day" : "days"} ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} ${mon === 1 ? "month" : "months"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} ${yr === 1 ? "year" : "years"} ago`;
}
