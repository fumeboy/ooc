// kernel/src/kanban/store.ts
// issues/ 和 tasks/ 目录结构的读写操作

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Issue, Task } from "./types";

/** 确保目录存在 */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** 读取 issues/index.json，不存在则返回空数组 */
export async function readIssues(sessionDir: string): Promise<Issue[]> {
  const indexPath = join(sessionDir, "issues", "index.json");
  try {
    const file = Bun.file(indexPath);
    if (!(await file.exists())) return [];
    return JSON.parse(await file.text()) as Issue[];
  } catch {
    return [];
  }
}

/** 写入 issues：同时更新 index.json（完整数据）和单条文件 */
export async function writeIssues(sessionDir: string, issues: Issue[]): Promise<void> {
  const issuesDir = join(sessionDir, "issues");
  ensureDir(issuesDir);

  /* 写入 index.json（完整数据，方便前端直接读取） */
  await Bun.write(join(issuesDir, "index.json"), JSON.stringify(issues, null, 2));

  /* 写入单条文件（id 已含前缀，如 issue-001） */
  for (const issue of issues) {
    await Bun.write(
      join(issuesDir, `${issue.id}.json`),
      JSON.stringify(issue, null, 2),
    );
  }
}

/** 读取 tasks/index.json，不存在则返回空数组 */
export async function readTasks(sessionDir: string): Promise<Task[]> {
  const indexPath = join(sessionDir, "tasks", "index.json");
  try {
    const file = Bun.file(indexPath);
    if (!(await file.exists())) return [];
    return JSON.parse(await file.text()) as Task[];
  } catch {
    return [];
  }
}

/** 写入 tasks：同时更新 index.json（完整数据）和单条文件 */
export async function writeTasks(sessionDir: string, tasks: Task[]): Promise<void> {
  const tasksDir = join(sessionDir, "tasks");
  ensureDir(tasksDir);

  /* 写入 index.json（完整数据） */
  await Bun.write(join(tasksDir, "index.json"), JSON.stringify(tasks, null, 2));

  for (const task of tasks) {
    await Bun.write(
      join(tasksDir, `${task.id}.json`),
      JSON.stringify(task, null, 2),
    );
  }
}

/** 生成自增 ID */
export function nextId(prefix: string, items: { id: string }[]): string {
  let max = 0;
  for (const item of items) {
    const num = parseInt(item.id.replace(`${prefix}-`, ""), 10);
    if (num > max) max = num;
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** 当前时间 ISO 字符串 */
export function now(): string {
  return new Date().toISOString();
}

/** 读取单条 Issue 详情 */
export async function readIssueDetail(sessionDir: string, issueId: string): Promise<Issue | null> {
  try {
    const path = join(sessionDir, "issues", `${issueId}.json`);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return JSON.parse(await file.text()) as Issue;
  } catch {
    return null;
  }
}

/** 写入单条 Issue 详情 */
export async function writeIssueDetail(sessionDir: string, issue: Issue): Promise<void> {
  const issuesDir = join(sessionDir, "issues");
  ensureDir(issuesDir);
  await Bun.write(
    join(issuesDir, `${issue.id}.json`),
    JSON.stringify(issue, null, 2),
  );
}

/** 读取单条 Task 详情 */
export async function readTaskDetail(sessionDir: string, taskId: string): Promise<Task | null> {
  try {
    const path = join(sessionDir, "tasks", `${taskId}.json`);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return JSON.parse(await file.text()) as Task;
  } catch {
    return null;
  }
}

/** 写入单条 Task 详情 */
export async function writeTaskDetail(sessionDir: string, task: Task): Promise<void> {
  const tasksDir = join(sessionDir, "tasks");
  ensureDir(tasksDir);
  await Bun.write(
    join(tasksDir, `${task.id}.json`),
    JSON.stringify(task, null, 2),
  );
}
