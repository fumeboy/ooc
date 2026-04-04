// kernel/web/src/api/kanban.ts
// Kanban 相关 API 调用

import { fetchFileContent } from "./client";
import type { KanbanIssue, KanbanTask } from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

/** 读取 session 的 issues.json */
export async function fetchIssues(sessionId: string): Promise<KanbanIssue[]> {
  try {
    const content = await fetchFileContent(`flows/${sessionId}/issues/index.json`);
    return JSON.parse(content) as KanbanIssue[];
  } catch {
    return [];
  }
}

/** 读取 session 的 tasks.json */
export async function fetchTasks(sessionId: string): Promise<KanbanTask[]> {
  try {
    const content = await fetchFileContent(`flows/${sessionId}/tasks/index.json`);
    return JSON.parse(content) as KanbanTask[];
  } catch {
    return [];
  }
}

/** 读取 session 的 readme.md */
export async function fetchSessionReadme(sessionId: string): Promise<string> {
  try {
    return await fetchFileContent(`flows/${sessionId}/readme.md`);
  } catch {
    return "";
  }
}

/** 用户发表评论 */
export async function postIssueComment(
  sessionId: string,
  issueId: string,
  content: string,
  mentions?: string[],
): Promise<void> {
  await fetch(`${API_BASE}/api/sessions/${sessionId}/issues/${issueId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, mentions }),
  });
}

/** 确认 issue 已读 */
export async function ackIssue(sessionId: string, issueId: string): Promise<void> {
  await fetch(`${API_BASE}/api/sessions/${sessionId}/issues/${issueId}/ack`, {
    method: "POST",
  });
}

/** 确认 task 已读 */
export async function ackTask(sessionId: string, taskId: string): Promise<void> {
  await fetch(`${API_BASE}/api/sessions/${sessionId}/tasks/${taskId}/ack`, {
    method: "POST",
  });
}
