// kernel/web/src/features/SessionKanban.tsx
import { useEffect, useState, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { lastFlowEventAtom, editorTabsAtom, activeFilePathAtom } from "../store/session";
import { fetchIssues, fetchTasks, fetchSessionReadme } from "../api/kanban";
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
          <p className="text-muted-foreground text-sm">Session 工作状态待更新...</p>
        )}
      </div>

      <div className="w-1/2 flex overflow-hidden">
        <div className="flex-1 border-r border-border overflow-auto p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Issues</h3>
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

        <div className="flex-1 overflow-auto p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tasks</h3>
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
    </div>
  );
}
