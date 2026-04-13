/**
 * kanban trait — Session 级 Issue/Task 管理 API
 *
 * 提供 Issue 和 Task 的增删改能力，所有对象均可使用。
 * 底层调用 kernel/src/kanban/methods.ts 的实现。
 */

import type { MethodContext } from "../../../src/trait/registry";
import * as m from "../../../src/kanban/methods";

function sessionDir(ctx: MethodContext): string {
  return `${ctx.rootDir}/flows/${ctx.sessionId}`;
}

/** 创建 Issue @param title - 标题 @param description - 描述 @param participants - 参与者列表 */
export async function createIssue(ctx: MethodContext, title: string, description?: string, participants?: string[]) {
  return m.createIssue(sessionDir(ctx), title, description, participants);
}

/** 更新 Issue 状态 @param issueId - Issue ID @param status - 目标状态 */
export async function updateIssueStatus(ctx: MethodContext, issueId: string, status: string) {
  return m.updateIssueStatus(sessionDir(ctx), issueId, status as any);
}

/** 更新 Issue 字段 @param issueId - Issue ID @param fields - 要更新的字段 */
export async function updateIssue(ctx: MethodContext, issueId: string, fields: Record<string, unknown>) {
  return m.updateIssue(sessionDir(ctx), issueId, fields as any);
}

/** 标记 Issue 是否有需要人类确认的新信息 @param issueId - Issue ID @param hasNewInfo - 是否有新信息 */
export async function setIssueNewInfo(ctx: MethodContext, issueId: string, hasNewInfo: boolean) {
  return m.setIssueNewInfo(sessionDir(ctx), issueId, hasNewInfo);
}

/** 关闭 Issue @param issueId - Issue ID */
export async function closeIssue(ctx: MethodContext, issueId: string) {
  return m.closeIssue(sessionDir(ctx), issueId);
}

/** 创建 Task @param title - 标题 @param description - 描述 @param issueRefs - 关联 Issue ID 列表 */
export async function createTask(ctx: MethodContext, title: string, description?: string, issueRefs?: string[]) {
  return m.createTask(sessionDir(ctx), title, description, issueRefs);
}

/** 更新 Task 状态 @param taskId - Task ID @param status - 目标状态 */
export async function updateTaskStatus(ctx: MethodContext, taskId: string, status: string) {
  return m.updateTaskStatus(sessionDir(ctx), taskId, status as any);
}

/** 更新 Task 字段 @param taskId - Task ID @param fields - 要更新的字段 */
export async function updateTask(ctx: MethodContext, taskId: string, fields: Record<string, unknown>) {
  return m.updateTask(sessionDir(ctx), taskId, fields as any);
}

/** 创建子任务 @param taskId - Task ID @param title - 标题 @param assignee - 分配对象 */
export async function createSubTask(ctx: MethodContext, taskId: string, title: string, assignee?: string) {
  return m.createSubTask(sessionDir(ctx), taskId, title, assignee);
}

/** 更新子任务 @param taskId - Task ID @param subTaskId - 子任务 ID @param fields - 要更新的字段 */
export async function updateSubTask(ctx: MethodContext, taskId: string, subTaskId: string, fields: Record<string, unknown>) {
  return m.updateSubTask(sessionDir(ctx), taskId, subTaskId, fields as any);
}

/** 标记 Task 是否有需要人类确认的新信息 @param taskId - Task ID @param hasNewInfo - 是否有新信息 */
export async function setTaskNewInfo(ctx: MethodContext, taskId: string, hasNewInfo: boolean) {
  return m.setTaskNewInfo(sessionDir(ctx), taskId, hasNewInfo);
}
