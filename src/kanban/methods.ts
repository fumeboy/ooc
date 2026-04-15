// kernel/src/kanban/methods.ts
// Session Kanban 方法实现 — Issue/Task 的增删改

import type { Issue, IssueStatus, Task, TaskStatus, SubTask, SubTaskStatus } from "./types";
import { readIssues, writeIssues, readTasks, writeTasks, nextId, now } from "./store";

/** 创建 Issue */
export async function createIssue(
  sessionDir: string, title: string, description?: string, participants?: string[],
): Promise<Issue> {
  const issues = await readIssues(sessionDir);
  const issue: Issue = {
    id: nextId("issue", issues),
    title,
    status: "discussing",
    description,
    participants: participants ?? [],
    taskRefs: [],
    reportPages: [],
    hasNewInfo: false,
    comments: [],
    createdAt: now(),
    updatedAt: now(),
  };
  issues.push(issue);
  await writeIssues(sessionDir, issues);
  return issue;
}

/** 更新 Issue 状态 */
export async function updateIssueStatus(
  sessionDir: string, issueId: string, status: IssueStatus,
): Promise<void> {
  const issues = await readIssues(sessionDir);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found`);
  issue.status = status;
  issue.updatedAt = now();
  await writeIssues(sessionDir, issues);
}

/** 更新 Issue 字段（title/description/participants/taskRefs/reportPages） */
export async function updateIssue(
  sessionDir: string, issueId: string,
  fields: Partial<Pick<Issue, "title" | "description" | "participants" | "taskRefs" | "reportPages">>,
): Promise<void> {
  const issues = await readIssues(sessionDir);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found`);
  Object.assign(issue, fields);
  issue.updatedAt = now();
  await writeIssues(sessionDir, issues);
}

/** 标记 Issue 是否有需要人类确认的新信息 */
export async function setIssueNewInfo(
  sessionDir: string, issueId: string, hasNewInfo: boolean,
): Promise<void> {
  const issues = await readIssues(sessionDir);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found`);
  issue.hasNewInfo = hasNewInfo;
  issue.updatedAt = now();
  await writeIssues(sessionDir, issues);
}

/** 关闭 Issue */
export async function closeIssue(sessionDir: string, issueId: string): Promise<void> {
  return updateIssueStatus(sessionDir, issueId, "closed");
}

/** 创建 Task */
export async function createTask(
  sessionDir: string, title: string, description?: string, issueRefs?: string[],
): Promise<Task> {
  const tasks = await readTasks(sessionDir);
  const task: Task = {
    id: nextId("task", tasks),
    title,
    status: "running",
    description,
    issueRefs: issueRefs ?? [],
    reportPages: [],
    subtasks: [],
    hasNewInfo: false,
    createdAt: now(),
    updatedAt: now(),
  };
  tasks.push(task);
  await writeTasks(sessionDir, tasks);

  /* 反向更新关联 Issue 的 taskRefs */
  if (issueRefs && issueRefs.length > 0) {
    const issues = await readIssues(sessionDir);
    for (const issueId of issueRefs) {
      const issue = issues.find((i) => i.id === issueId);
      if (issue) {
        if (!issue.taskRefs) issue.taskRefs = [];
        if (!issue.taskRefs.includes(task.id)) {
          issue.taskRefs.push(task.id);
          issue.updatedAt = now();
        }
      }
    }
    await writeIssues(sessionDir, issues);
  }

  return task;
}

/** 更新 Task 状态 */
export async function updateTaskStatus(
  sessionDir: string, taskId: string, status: TaskStatus,
): Promise<void> {
  const tasks = await readTasks(sessionDir);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  task.status = status;
  task.updatedAt = now();
  await writeTasks(sessionDir, tasks);
}

/** 更新 Task 字段 */
export async function updateTask(
  sessionDir: string, taskId: string,
  fields: Partial<Pick<Task, "title" | "description" | "issueRefs" | "reportPages">>,
): Promise<void> {
  const tasks = await readTasks(sessionDir);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  Object.assign(task, fields);
  task.updatedAt = now();
  await writeTasks(sessionDir, tasks);
}

/** 创建子任务 */
export async function createSubTask(
  sessionDir: string, taskId: string, title: string, assignee?: string,
): Promise<SubTask> {
  const tasks = await readTasks(sessionDir);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const sub: SubTask = {
    id: nextId("sub", task.subtasks),
    title,
    assignee,
    status: "pending",
  };
  task.subtasks.push(sub);
  task.updatedAt = now();
  await writeTasks(sessionDir, tasks);
  return sub;
}

/** 更新子任务 */
export async function updateSubTask(
  sessionDir: string, taskId: string, subTaskId: string,
  fields: Partial<Pick<SubTask, "title" | "assignee" | "status">>,
): Promise<void> {
  const tasks = await readTasks(sessionDir);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const sub = task.subtasks.find((s) => s.id === subTaskId);
  if (!sub) throw new Error(`SubTask ${subTaskId} not found`);
  Object.assign(sub, fields);
  task.updatedAt = now();
  await writeTasks(sessionDir, tasks);
}

/** 标记 Task 是否有需要人类确认的新信息 */
export async function setTaskNewInfo(
  sessionDir: string, taskId: string, hasNewInfo: boolean,
): Promise<void> {
  const tasks = await readTasks(sessionDir);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  task.hasNewInfo = hasNewInfo;
  task.updatedAt = now();
  await writeTasks(sessionDir, tasks);
}
