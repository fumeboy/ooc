// kernel/web/src/api/kanban.ts
// Kanban 相关 API 调用

import { fetchFileContent } from "./client";
import type { IssueStatus, KanbanIssue, KanbanTask, TaskStatus } from "./types";

/** Issue 合法状态枚举（与后端 types.ts 保持一致） */
export const ISSUE_STATUSES: IssueStatus[] = [
  "discussing", "designing", "reviewing",
  "executing", "confirming", "done", "closed",
];

/** Task 合法状态枚举（与后端 types.ts 保持一致） */
export const TASK_STATUSES: TaskStatus[] = ["running", "done", "closed"];

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

/** 手动创建 Issue */
export async function createIssue(
  sessionId: string, title: string, description?: string,
): Promise<KanbanIssue> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description }),
  });
  const json = await res.json();
  return json.data as KanbanIssue;
}

/** 手动创建 Task */
export async function createTask(
  sessionId: string, title: string, description?: string, issueRefs?: string[],
): Promise<KanbanTask> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, issueRefs }),
  });
  const json = await res.json();
  return json.data as KanbanTask;
}

/**
 * 切换 Issue 状态
 *
 * 调用成功时返回更新后的完整 Issue；失败（400/404）返回 null 并在控制台打警告，
 * 让调用方可以做乐观更新回滚。
 */
export async function setIssueStatus(
  sessionId: string, issueId: string, status: IssueStatus,
): Promise<KanbanIssue | null> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${sessionId}/issues/${issueId}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  const json = await res.json();
  if (!res.ok || !json.success) {
    console.warn("[setIssueStatus] failed", json.error ?? res.status);
    return null;
  }
  return json.data as KanbanIssue;
}

/**
 * 切换 Task 状态
 *
 * 调用成功时返回更新后的完整 Task；失败时返回 null。
 */
export async function setTaskStatus(
  sessionId: string, taskId: string, status: TaskStatus,
): Promise<KanbanTask | null> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${sessionId}/tasks/${taskId}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  const json = await res.json();
  if (!res.ok || !json.success) {
    console.warn("[setTaskStatus] failed", json.error ?? res.status);
    return null;
  }
  return json.data as KanbanTask;
}
