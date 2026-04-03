// kernel/web/src/features/TaskDetailView.tsx
import { useEffect, useState, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { lastFlowEventAtom, editorTabsAtom, activeFilePathAtom } from "../store/session";
import { fetchTasks, ackTask } from "../api/kanban";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { DynamicUI } from "./DynamicUI";
import type { KanbanTask, TaskStatus } from "../api/types";

const STATUS_LABELS: Record<TaskStatus, string> = { running: "执行中", done: "已完成", closed: "已关闭" };
const STATUS_COLORS: Record<TaskStatus, string> = { running: "bg-amber-500", done: "bg-emerald-500", closed: "bg-gray-500" };
const SUB_STATUS_COLORS: Record<string, string> = { pending: "bg-gray-400", running: "bg-amber-500", done: "bg-emerald-500" };

type Tab = "description" | "subtasks" | "issues" | "reports";

export function TaskDetailView({ sessionId, taskId }: { sessionId: string; taskId: string }) {
  const [task, setTask] = useState<KanbanTask | null>(null);
  const [tab, setTab] = useState<Tab>("subtasks");
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const setTabs = useSetAtom(editorTabsAtom);
  const setActivePath = useSetAtom(activeFilePathAtom);

  const load = useCallback(async () => {
    const tasks = await fetchTasks(sessionId);
    setTask(tasks.find((t) => t.id === taskId) ?? null);
  }, [sessionId, taskId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (lastEvent && "sessionId" in lastEvent && lastEvent.sessionId === sessionId) load();
  }, [lastEvent, sessionId, load]);

  useEffect(() => {
    if (task?.hasNewInfo) ackTask(sessionId, taskId);
  }, [task?.hasNewInfo, sessionId, taskId]);

  const openTab = (path: string, label: string) => {
    setActivePath(path);
    setTabs((prev) => prev.some((t) => t.path === path) ? prev : [...prev, { path, label }]);
  };

  if (!task) return <div className="p-6 text-muted-foreground">Task 未找到</div>;

  const done = task.subtasks.filter((s) => s.status === "done").length;
  const total = task.subtasks.length;

  const tabs: { key: Tab; label: string }[] = [
    { key: "description", label: "描述" },
    { key: "subtasks", label: `子任务 (${total})` },
    { key: "issues", label: `关联 Issues (${task.issueRefs.length})` },
    ...(task.reportPages.length > 0 ? [{ key: "reports" as Tab, label: `Reports (${task.reportPages.length})` }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{task.title}</h2>
          <span className={`px-2 py-0.5 rounded-full text-xs text-white ${STATUS_COLORS[task.status]}`}>
            {STATUS_LABELS[task.status]}
          </span>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(done / total) * 100}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">{done}/{total} subtasks</span>
          </div>
        )}
      </div>

      <div className="border-b border-border px-6 flex gap-4">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`py-2 text-sm border-b-2 transition-colors ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "description" && (
          <div className="p-6">
            {task.description ? <MarkdownContent content={task.description} /> : <p className="text-muted-foreground text-sm">暂无描述</p>}
          </div>
        )}
        {tab === "subtasks" && (
          <div className="p-6 space-y-2">
            {task.subtasks.length === 0 && <p className="text-muted-foreground text-sm">暂无子任务</p>}
            {task.subtasks.map((sub) => (
              <div key={sub.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <span className={`w-2 h-2 rounded-full ${SUB_STATUS_COLORS[sub.status]}`} />
                <span className="text-sm flex-1">{sub.title}</span>
                {sub.assignee && <span className="text-xs text-muted-foreground">{sub.assignee}</span>}
                <span className="text-xs text-muted-foreground">{sub.status}</span>
              </div>
            ))}
          </div>
        )}
        {tab === "issues" && (
          <div className="p-6 space-y-2">
            {task.issueRefs.length === 0 && <p className="text-muted-foreground text-sm">暂无关联 Issue</p>}
            {task.issueRefs.map((iid) => (
              <button key={iid} onClick={() => openTab(`flows/${sessionId}/issues/${iid}`, iid)}
                className="block w-full text-left rounded-lg border border-border p-3 hover:bg-accent/50 text-sm">{iid}</button>
            ))}
          </div>
        )}
        {tab === "reports" && (
          <div className="p-6 space-y-4">
            {task.reportPages.map((page) => (
              <div key={page} className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-muted text-xs font-medium">{page}</div>
                <DynamicUI importPath={`@flows/${sessionId}/flows/supervisor/files/ui/pages/${page}`} componentProps={{ sessionId }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
