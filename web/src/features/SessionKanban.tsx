// kernel/web/src/features/SessionKanban.tsx
import { useEffect, useState, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { lastFlowEventAtom, editorTabsAtom, activeFilePathAtom } from "../store/session";
import { fetchIssues, fetchTasks, fetchSessionReadme, createIssue, createTask } from "../api/kanban";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { StatusGroup } from "./kanban/StatusGroup";
import { IssueCard } from "./kanban/IssueCard";
import { TaskCard } from "./kanban/TaskCard";
import type { KanbanIssue, KanbanTask, IssueStatus, TaskStatus } from "../api/types";

const ISSUE_GROUPS: { status: IssueStatus; label: string; color: string }[] = [
  { status: "discussing", label: "讨论中", color: "#3b82f6" },
  { status: "designing", label: "方案设计中", color: "#a855f7" },
  { status: "reviewing", label: "方案评审中", color: "#f97316" },
  { status: "executing", label: "方案执行中", color: "#f59e0b" },
  { status: "confirming", label: "执行结果确认中", color: "#06b6d4" },
  { status: "done", label: "已完成", color: "#22c55e" },
  { status: "closed", label: "已关闭", color: "#6b7280" },
];

const TASK_GROUPS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "running", label: "执行中", color: "#f59e0b" },
  { status: "done", label: "已完成", color: "#22c55e" },
  { status: "closed", label: "已关闭", color: "#6b7280" },
];

export function SessionKanban({ sessionId }: { sessionId: string }) {
  const [readme, setReadme] = useState("");
  const [issues, setIssues] = useState<KanbanIssue[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [dialog, setDialog] = useState<{ type: "issue" | "task" } | null>(null);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const setTabs = useSetAtom(editorTabsAtom);
  const setActivePath = useSetAtom(activeFilePathAtom);

  /* readme 只在挂载时加载一次，避免反复 404 */
  useEffect(() => {
    fetchSessionReadme(sessionId).then(setReadme).catch(() => setReadme(""));
  }, [sessionId]);

  /* issues/tasks 在挂载和 SSE 事件时刷新 */
  const loadKanban = useCallback(async () => {
    const [i, t] = await Promise.all([
      fetchIssues(sessionId),
      fetchTasks(sessionId),
    ]);
    setIssues(i);
    setTasks(t);
  }, [sessionId]);

  useEffect(() => { loadKanban(); }, [loadKanban]);

  useEffect(() => {
    if (lastEvent && "sessionId" in lastEvent && lastEvent.sessionId === sessionId) {
      loadKanban();
    }
  }, [lastEvent, sessionId, loadKanban]);

  const openTab = (path: string, label: string) => {
    setActivePath(path);
    setTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev;
      return [...prev, { path, label }];
    });
  };

  const sortedIssues = [...issues].sort((a, b) => {
    if (a.hasNewInfo && !b.hasNewInfo) return -1;
    if (!a.hasNewInfo && b.hasNewInfo) return 1;
    return 0;
  });

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-1/2 border-r border-border overflow-auto p-6">
        {readme ? (
          <MarkdownContent content={readme} />
        ) : (
          <p className="text-muted-foreground text-sm">等待 Supervisor 更新工作状态...</p>
        )}
      </div>

      <div className="w-1/2 overflow-auto p-4 space-y-6">
        {/* Issues */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Issues</h3>
            <button
              onClick={() => setDialog({ type: "issue" })}
              className="text-muted-foreground hover:text-foreground text-sm leading-none px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
              title="创建 Issue"
            >
              +
            </button>
          </div>
          {ISSUE_GROUPS.map(({ status, label, color }) => {
            const items = sortedIssues.filter((i) => i.status === status);
            if (items.length === 0) return null;
            return (
              <StatusGroup key={status} label={label} color={color} count={items.length}>
                {items.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    onClick={() => openTab(`flows/${sessionId}/issues/${issue.id}`, issue.id)}
                  />
                ))}
              </StatusGroup>
            );
          })}
          {issues.length === 0 && <p className="text-muted-foreground text-sm">暂无 Issue</p>}
        </div>

        {/* Tasks */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tasks</h3>
            <button
              onClick={() => setDialog({ type: "task" })}
              className="text-muted-foreground hover:text-foreground text-sm leading-none px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
              title="创建 Task"
            >
              +
            </button>
          </div>
          {TASK_GROUPS.map(({ status, label, color }) => {
            const items = tasks.filter((t) => t.status === status);
            if (items.length === 0) return null;
            return (
              <StatusGroup key={status} label={label} color={color} count={items.length}>
                {items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => openTab(`flows/${sessionId}/tasks/${task.id}`, task.id)}
                  />
                ))}
              </StatusGroup>
            );
          })}
          {tasks.length === 0 && <p className="text-muted-foreground text-sm">暂无 Task</p>}
        </div>
      </div>

      {/* 创建弹窗 */}
      {dialog && (
        <CreateItemDialog
          type={dialog.type}
          onClose={() => setDialog(null)}
          onSubmit={async (title, description) => {
            if (dialog.type === "issue") {
              await createIssue(sessionId, title, description);
            } else {
              await createTask(sessionId, title, description);
            }
            setDialog(null);
            await loadKanban();
          }}
        />
      )}
    </div>
  );
}

/** 创建 Issue/Task 的弹窗 */
function CreateItemDialog({
  type,
  onClose,
  onSubmit,
}: {
  type: "issue" | "task";
  onClose: () => void;
  onSubmit: (title: string, description: string | undefined) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(title.trim(), description.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const label = type === "issue" ? "Issue" : "Task";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-lg w-80 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="text-sm font-semibold mb-3">创建 {label}</h4>

        <input
          type="text"
          placeholder={`${label} 标题`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          className="w-full rounded border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-primary mb-2"
          autoFocus
        />

        <textarea
          placeholder="描述（可选）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-primary mb-3 resize-none"
          rows={3}
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
