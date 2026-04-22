// kernel/web/src/features/IssueDetailView.tsx
import { useEffect, useState, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { lastFlowEventAtom, editorTabsAtom, activeFilePathAtom } from "../store/session";
import { fetchIssues, ackIssue, postIssueComment, setIssueStatus, ISSUE_STATUSES } from "../api/kanban";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { CommentTimeline } from "./kanban/CommentTimeline";
import { StatusBadgeMenu, type StatusOption } from "./kanban/StatusBadgeMenu";
import { DynamicUI } from "./DynamicUI";
import { ArrowLeft } from "lucide-react";
import type { KanbanIssue, IssueStatus } from "../api/types";

const STATUS_LABELS: Record<IssueStatus, string> = {
  discussing: "讨论中", designing: "方案设计中", reviewing: "方案评审中",
  executing: "方案执行中", confirming: "执行结果确认中", done: "已完成", closed: "已关闭",
};

const STATUS_COLORS: Record<IssueStatus, string> = {
  discussing: "bg-blue-500", designing: "bg-purple-500", reviewing: "bg-orange-500",
  executing: "bg-amber-500", confirming: "bg-cyan-500", done: "bg-emerald-500", closed: "bg-gray-500",
};

/** 下拉候选项（保持 ISSUE_STATUSES 定义的顺序） */
const ISSUE_STATUS_OPTIONS: StatusOption<IssueStatus>[] = ISSUE_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
  color: STATUS_COLORS[s],
}));

type Tab = "description" | "comments" | "tasks" | "reports";

export function IssueDetailView({ sessionId, issueId }: { sessionId: string; issueId: string }) {
  const [issue, setIssue] = useState<KanbanIssue | null>(null);
  const [tab, setTab] = useState<Tab>("comments");
  const [statusBusy, setStatusBusy] = useState(false);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const setTabs = useSetAtom(editorTabsAtom);
  const setActivePath = useSetAtom(activeFilePathAtom);

  const load = useCallback(async () => {
    const issues = await fetchIssues(sessionId);
    setIssue(issues.find((i) => i.id === issueId) ?? null);
  }, [sessionId, issueId]);

  /* 状态切换：乐观更新 + 调 API + 失败回滚 + SSE 刷新兜底 */
  const handleStatusChange = useCallback(async (next: IssueStatus) => {
    if (!issue || next === issue.status) return;
    const prev = issue.status;
    setStatusBusy(true);
    setIssue({ ...issue, status: next });
    const updated = await setIssueStatus(sessionId, issueId, next);
    if (!updated) {
      /* 回滚 */
      setIssue({ ...issue, status: prev });
    } else {
      setIssue(updated);
    }
    setStatusBusy(false);
  }, [issue, sessionId, issueId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (lastEvent && "sessionId" in lastEvent && lastEvent.sessionId === sessionId) load();
  }, [lastEvent, sessionId, load]);

  useEffect(() => {
    if (issue?.hasNewInfo) ackIssue(sessionId, issueId);
  }, [issue?.hasNewInfo, sessionId, issueId]);

  const openTab = (path: string, label: string) => {
    setActivePath(path);
    setTabs((prev) => prev.some((t) => t.path === path) ? prev : [...prev, { path, label }]);
  };

  if (!issue) return <div className="p-6 text-muted-foreground">Issue 未找到</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: "description", label: "描述" },
    { key: "comments", label: `评论 (${issue.comments.length})` },
    { key: "tasks", label: `关联 Tasks (${issue.taskRefs.length})` },
    ...(issue.reportPages.length > 0 ? [{ key: "reports" as Tab, label: `Reports (${issue.reportPages.length})` }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => openTab(`flows/${sessionId}`, "Session")}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="返回看板"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-semibold">{issue.title}</h2>
          <StatusBadgeMenu<IssueStatus>
            current={issue.status}
            options={ISSUE_STATUS_OPTIONS}
            onSelect={handleStatusChange}
            disabled={statusBusy}
          />
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          参与者: {issue.participants.length > 0 ? issue.participants.join(", ") : "无"}
        </div>
      </div>

      <div className="border-b border-border px-6 flex gap-4">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`py-2 text-sm border-b-2 transition-colors ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "description" && (
          <div className="p-6 overflow-auto h-full">
            {issue.description ? <MarkdownContent content={issue.description} /> : <p className="text-muted-foreground text-sm">暂无描述</p>}
          </div>
        )}
        {tab === "comments" && (
          <CommentTimeline comments={issue.comments} onSubmit={async (content) => { await postIssueComment(sessionId, issueId, content); await load(); }} />
        )}
        {tab === "tasks" && (
          <div className="p-6 overflow-auto h-full space-y-2">
            {issue.taskRefs.length === 0 && <p className="text-muted-foreground text-sm">暂无关联 Task</p>}
            {issue.taskRefs.map((tid) => (
              <button key={tid} onClick={() => openTab(`flows/${sessionId}/tasks/${tid}`, tid)}
                className="block w-full text-left rounded-lg border border-border p-3 hover:bg-accent/50 text-sm">{tid}</button>
            ))}
          </div>
        )}
        {tab === "reports" && (
          <div className="p-6 overflow-auto h-full space-y-4">
            {issue.reportPages.map((page, i) => {
              const raw = typeof page === "string" ? page : "";
              /* 兼容：旧 reportPages 存的是 "report.tsx" 或 "report"，统一剥离 .tsx 作为 viewName */
              const viewName = raw.replace(/\.tsx$/, "");
              return (
                <div key={`${i}-${raw || JSON.stringify(page)}`} className="rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-muted text-xs font-medium">{raw || JSON.stringify(page)}</div>
                  <DynamicUI importPath={`@flows/${sessionId}/objects/supervisor/views/${viewName}/frontend.tsx`} componentProps={{ sessionId, objectName: "supervisor" }} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
