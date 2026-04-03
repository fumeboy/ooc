// kernel/src/kanban/store.ts
// issues.json / tasks.json 的读写操作

import type { Issue, Task } from "./types";

const ISSUES_FILE = "issues.json";
const TASKS_FILE = "tasks.json";

/** 读取 issues.json，不存在则返回空数组 */
export async function readIssues(sessionDir: string): Promise<Issue[]> {
  const path = `${sessionDir}/${ISSUES_FILE}`;
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return [];
    return JSON.parse(await file.text()) as Issue[];
  } catch {
    return [];
  }
}

/** 写入 issues.json */
export async function writeIssues(sessionDir: string, issues: Issue[]): Promise<void> {
  await Bun.write(`${sessionDir}/${ISSUES_FILE}`, JSON.stringify(issues, null, 2));
}

/** 读取 tasks.json，不存在则返回空数组 */
export async function readTasks(sessionDir: string): Promise<Task[]> {
  const path = `${sessionDir}/${TASKS_FILE}`;
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return [];
    return JSON.parse(await file.text()) as Task[];
  } catch {
    return [];
  }
}

/** 写入 tasks.json */
export async function writeTasks(sessionDir: string, tasks: Task[]): Promise<void> {
  await Bun.write(`${sessionDir}/${TASKS_FILE}`, JSON.stringify(tasks, null, 2));
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
