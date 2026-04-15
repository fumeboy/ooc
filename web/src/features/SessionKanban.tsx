// kernel/web/src/features/SessionKanban.tsx
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { lastFlowEventAtom, editorTabsAtom, activeFilePathAtom } from "../store/session";
import { fetchIssues, fetchTasks, createIssue, createTask } from "../api/kanban";
import { fetchSessionObjects, fetchObjectProcess } from "../api/client";
import { StatusGroup } from "./kanban/StatusGroup";
import { IssueCard } from "./kanban/IssueCard";
import { TaskCard } from "./kanban/TaskCard";
import { ThreadsTreeView } from "./ThreadsTreeView";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import type { KanbanIssue, KanbanTask, IssueStatus, TaskStatus, Process } from "../api/types";
import { cn } from "../lib/utils";

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
  const [objectNames, setObjectNames] = useState<string[]>([]);
  const [processData, setProcessData] = useState<Map<string, Process>>(new Map());
  const [loadingObjects, setLoadingObjects] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<KanbanIssue[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [dialog, setDialog] = useState<{ type: "issue" | "task" } | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const setTabs = useSetAtom(editorTabsAtom);
  const setActivePath = useSetAtom(activeFilePathAtom);

  /* 加载对象列表和 process 数据 */
  useEffect(() => {
    let mounted = true;

    const loadObjects = async () => {
      try {
        const objects = await fetchSessionObjects(sessionId);
        if (!mounted) return;

        setObjectNames(objects);
        setLoadingObjects(new Set(objects));

        // 先加载 supervisor
        if (objects.includes("supervisor")) {
          try {
            const process = await fetchObjectProcess(sessionId, "supervisor");
            if (!mounted) return;
            setProcessData(prev => new Map(prev).set("supervisor", process));
            setLoadingObjects(prev => {
              const next = new Set(prev);
              next.delete("supervisor");
              return next;
            });
          } catch (err) {
            console.error("Failed to load supervisor process:", err);
            setLoadingObjects(prev => {
              const next = new Set(prev);
              next.delete("supervisor");
              return next;
            });
          }
        }

        // 并发加载其他对象
        const others = objects.filter(name => name !== "supervisor");
        await Promise.all(
          others.map(async (name) => {
            try {
              const process = await fetchObjectProcess(sessionId, name);
              if (!mounted) return;
              setProcessData(prev => new Map(prev).set(name, process));
            } catch (err) {
              console.error(`Failed to load ${name} process:`, err);
            } finally {
              if (mounted) {
                setLoadingObjects(prev => {
                  const next = new Set(prev);
                  next.delete(name);
                  return next;
                });
              }
            }
          })
        );
      } catch (err) {
        console.error("Failed to load session objects:", err);
        if (mounted) {
          setObjectNames([]);
          setLoadingObjects(new Set());
        }
      }
    };

    loadObjects();

    return () => {
      mounted = false;
    };
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

  /* SSE 实时刷新（防抖批量处理） */
  const pendingRefreshes = useRef<Set<string>>(new Set());

  const debouncedRefresh = useMemo(
    () => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(async () => {
          const objectsToRefresh = Array.from(pendingRefreshes.current);
          pendingRefreshes.current.clear();

          const processes = await Promise.all(
            objectsToRefresh.map(name =>
              fetchObjectProcess(sessionId, name).catch(err => {
                console.error(`Failed to refresh ${name}:`, err);
                return null;
              })
            )
          );

          setProcessData(prev => {
            const next = new Map(prev);
            objectsToRefresh.forEach((name, i) => {
              if (processes[i]) next.set(name, processes[i]);
            });
            return next;
          });
        }, 500);
      };
    },
    [sessionId]
  );

  useEffect(() => {
    if (!lastEvent || !("objectName" in lastEvent)) return;
    const objectName = (lastEvent as any).objectName;

    if (objectNames.includes(objectName)) {
      pendingRefreshes.current.add(objectName);
      debouncedRefresh();
    }
  }, [lastEvent, objectNames, debouncedRefresh]);

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
    <div className="relative flex flex-col h-full overflow-hidden">
      {/* 主体：Threads Tree 列表 */}
      <div className="flex-1 overflow-auto p-6 pb-[200px]">
        {objectNames.length === 0 && loadingObjects.size === 0 ? (
          <p className="text-muted-foreground text-sm">暂无对象参与此 session</p>
        ) : (
          <div className="space-y-8">
            {objectNames.map(name => (
              <div key={name} className="space-y-2">
                {/* 对象名分隔标题 */}
                <div className="flex items-center gap-2 sticky top-0 bg-background py-2 z-10">
                  <ObjectAvatar name={name} size="sm" />
                  <h3 className="text-sm font-medium">{name}</h3>
                </div>

                {/* ThreadsTreeView 或加载状态 */}
                {processData.has(name) ? (
                  <ThreadsTreeView
                    process={processData.get(name)!}
                    sessionId={sessionId}
                    objectName={name}
                  />
                ) : loadingObjects.has(name) ? (
                  <div className="text-sm text-muted-foreground">加载中...</div>
                ) : (
                  <div className="text-sm text-muted-foreground">对象数据不可用</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部抽屉：Issues & Tasks */}
      <div
        className={cn(
          "absolute mx-2 bottom-0 left-0 right-0 bg-[var(--panel-bg)]  border border-border rounded-t-xl shadow-xl transition-all duration-300 ease-out",
          drawerExpanded ? "h-[90%]" : "h-[160px]"
        )}
      >
        {/* iOS 风格装饰条 */}
        <div
          className="flex items-center justify-center py-2 cursor-pointer"
          onClick={() => setDrawerExpanded(!drawerExpanded)}
        >
          <div className="w-16 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* 抽屉内容 */}
        <div className="h-[calc(100%-32px)] overflow-auto px-4 pb-4">
          <div className="flex gap-4 h-full">
            {/* Issues 左栏 */}
            <div className="flex-1 overflow-auto">
              <div className="flex items-center justify-between mb-3 sticky top-0 bg-background py-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Issues</h3>
                <button
                  onClick={() => setDialog({ type: "issue" })}
                  className="text-muted-foreground hover:text-foreground text-sm leading-none px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                  title="创建 Issue"
                >
                  +
                </button>
              </div>
              <div className="space-y-2">
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
            </div>

            {/* Tasks 右栏 */}
            <div className="flex-1 overflow-auto border-l border-border pl-4">
              <div className="flex items-center justify-between mb-3 sticky top-0 bg-background py-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tasks</h3>
                <button
                  onClick={() => setDialog({ type: "task" })}
                  className="text-muted-foreground hover:text-foreground text-sm leading-none px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                  title="创建 Task"
                >
                  +
                </button>
              </div>
              <div className="space-y-2">
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
