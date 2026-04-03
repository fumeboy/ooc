// kernel/web/src/features/kanban/IssueCard.tsx
import type { KanbanIssue, IssueStatus } from "../../api/types";

const STATUS_COLORS: Record<IssueStatus, string> = {
  discussing: "#3b82f6",
  designing: "#a855f7",
  reviewing: "#f97316",
  executing: "#f59e0b",
  confirming: "#06b6d4",
  done: "#22c55e",
  closed: "#6b7280",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface IssueCardProps {
  issue: KanbanIssue;
  onClick: () => void;
}

export function IssueCard({ issue, onClick }: IssueCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: STATUS_COLORS[issue.status] }}
        />
        <span className="text-sm font-medium leading-tight">{issue.title}</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
        <span>
          {issue.taskRefs.length > 0 && `${issue.taskRefs.length} tasks · `}
          {issue.participants.slice(0, 3).join(", ")}
        </span>
        <span className="flex items-center gap-1">
          {timeAgo(issue.updatedAt)}
          {issue.hasNewInfo && (
            <span className="w-2 h-2 rounded-full bg-red-500" />
          )}
        </span>
      </div>
    </button>
  );
}
