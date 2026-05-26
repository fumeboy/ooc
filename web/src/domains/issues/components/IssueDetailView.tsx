import { useState } from "react";
import { Link } from "react-router";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { useDisplayName } from "../../objects";
import { useIssue, appendIssueComment, closeIssue } from "../query";
import { messageFromError } from "../../../transport/errors";
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
  hideBackLink = false,
}: {
  sessionId: string;
  issueId: number;
  /**
   * 2026-05-26 user-home 双栏：inline 嵌入右栏时不需要 ← All issues 跳转，会破坏左右
   * 一体化导航。route 路径直接进 IssueDetailView 时（MainPanel.tsx）保留默认行为。
   */
  hideBackLink?: boolean;
}) {
  const { issue, loading, error, refresh } = useIssue(sessionId, issueId);

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
  return <IssueDetailBody sessionId={sessionId} issue={issue} refresh={refresh} hideBackLink={hideBackLink} />;
}

function IssueDetailBody({
  sessionId,
  issue,
  refresh,
  hideBackLink,
}: {
  sessionId: string;
  issue: Issue;
  refresh: () => void;
  hideBackLink: boolean;
}) {
  return (
    <article className="issue-detail">
      {!hideBackLink && (
        <div className="issue-detail-back">
          <Link to={`/flows/${encodeURIComponent(sessionId)}/issues`} className="issue-detail-back-link">
            ← All issues
          </Link>
        </div>
      )}
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

      <CommentComposer sessionId={sessionId} issue={issue} refresh={refresh} />
    </article>
  );
}

function CommentComposer({
  sessionId,
  issue,
  refresh,
}: {
  sessionId: string;
  issue: Issue;
  refresh: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [closing, setClosing] = useState(false);

  const canSubmit = text.trim().length > 0 && !submitting;

  async function handleComment() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await appendIssueComment(sessionId, issue.id, { text });
      setText("");
      refresh();
    } catch (e) {
      setError(messageFromError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose() {
    if (closing) return;
    setClosing(true);
    setError(undefined);
    try {
      await closeIssue(sessionId, issue.id);
      refresh();
    } catch (e) {
      setError(messageFromError(e));
    } finally {
      setClosing(false);
    }
  }

  return (
    <section className="issue-detail-composer">
      <label className="field-label">
        <span className="muted small">Add a comment</span>
        <textarea
          className="textarea code-textarea issue-detail-composer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a comment (markdown supported)…"
          rows={4}
          disabled={submitting}
        />
      </label>
      {error && <div className="error small">{error}</div>}
      <div className="issue-detail-composer-actions">
        {issue.status === "open" && (
          <button
            type="button"
            className="btn"
            onClick={handleClose}
            disabled={closing}
            title="Mark this issue as closed"
          >
            {closing ? "Closing…" : "Close issue"}
          </button>
        )}
        {issue.status === "closed" && (
          <span className="pill" style={{ marginRight: "auto" }}>
            closed
          </span>
        )}
        <button
          type="button"
          className="btn primary"
          onClick={handleComment}
          disabled={!canSubmit}
          title="Post comment"
        >
          {submitting ? "Posting…" : "Comment"}
        </button>
      </div>
    </section>
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
