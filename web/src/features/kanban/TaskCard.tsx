// kernel/web/src/features/kanban/TaskCard.tsx
import type { KanbanTask, TaskStatus } from "../../api/types";

const STATUS_COLORS: Record<TaskStatus, string> = {
  running: "#f59e0b",
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

interface TaskCardProps {
  task: KanbanTask;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const done = task.subtasks.filter((s) => s.status === "done").length;
  const total = task.subtasks.length;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: STATUS_COLORS[task.status] }}
        />
        <span className="text-sm font-medium leading-tight">{task.title}</span>
      </div>
      {total > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{done}/{total}</span>
        </div>
      )}
      <div className="flex items-center justify-end mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {timeAgo(task.updatedAt)}
          {task.hasNewInfo && (
            <span className="w-2 h-2 rounded-full bg-red-500" />
          )}
        </span>
      </div>
    </button>
  );
}
