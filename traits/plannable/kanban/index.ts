/**
 * kanban trait — Session 级 Issue/Task 管理 API（Phase 2 协议：llm_methods 对象导出）
 *
 * 提供 Issue 和 Task 的增删改能力，所有对象均可使用。
 * 底层调用 kernel/src/collaborable/kanban/methods.ts 的实现。
 */

import type { MethodContext } from "../../../src/trait/registry";
import type { TraitMethod } from "../../../src/types/index";
import * as m from "../../../src/collaborable/kanban/methods";

function sessionDir(ctx: MethodContext): string {
  return `${ctx.rootDir}/flows/${ctx.sessionId}`;
}

export const llm_methods: Record<string, TraitMethod> = {
  createIssue: {
    name: "createIssue",
    description: "创建 Issue",
    params: [
      { name: "title", type: "string", description: "标题", required: true },
      { name: "description", type: "string", description: "描述", required: false },
      { name: "participants", type: "string[]", description: "参与者列表", required: false },
    ],
    fn: ((ctx: MethodContext, { title, description, participants }: any) =>
      m.createIssue(sessionDir(ctx), title, description, participants)) as TraitMethod["fn"],
  },
  updateIssueStatus: {
    name: "updateIssueStatus",
    description: "更新 Issue 状态",
    params: [
      { name: "issueId", type: "string", description: "Issue ID", required: true },
      { name: "status", type: "string", description: "目标状态", required: true },
    ],
    fn: ((ctx: MethodContext, { issueId, status }: any) =>
      m.updateIssueStatus(sessionDir(ctx), issueId, status)) as TraitMethod["fn"],
  },
  updateIssue: {
    name: "updateIssue",
    description: "更新 Issue 字段",
    params: [
      { name: "issueId", type: "string", description: "Issue ID", required: true },
      { name: "fields", type: "object", description: "要更新的字段", required: true },
    ],
    fn: ((ctx: MethodContext, { issueId, fields }: any) =>
      m.updateIssue(sessionDir(ctx), issueId, fields)) as TraitMethod["fn"],
  },
  setIssueNewInfo: {
    name: "setIssueNewInfo",
    description: "标记 Issue 是否有需要人类确认的新信息",
    params: [
      { name: "issueId", type: "string", description: "Issue ID", required: true },
      { name: "hasNewInfo", type: "boolean", description: "是否有新信息", required: true },
    ],
    fn: ((ctx: MethodContext, { issueId, hasNewInfo }: any) =>
      m.setIssueNewInfo(sessionDir(ctx), issueId, hasNewInfo)) as TraitMethod["fn"],
  },
  closeIssue: {
    name: "closeIssue",
    description: "关闭 Issue",
    params: [{ name: "issueId", type: "string", description: "Issue ID", required: true }],
    fn: ((ctx: MethodContext, { issueId }: any) =>
      m.closeIssue(sessionDir(ctx), issueId)) as TraitMethod["fn"],
  },
  createTask: {
    name: "createTask",
    description: "创建 Task",
    params: [
      { name: "title", type: "string", description: "标题", required: true },
      { name: "description", type: "string", description: "描述", required: false },
      { name: "issueRefs", type: "string[]", description: "关联 Issue ID 列表", required: false },
    ],
    fn: ((ctx: MethodContext, { title, description, issueRefs }: any) =>
      m.createTask(sessionDir(ctx), title, description, issueRefs)) as TraitMethod["fn"],
  },
  updateTaskStatus: {
    name: "updateTaskStatus",
    description: "更新 Task 状态",
    params: [
      { name: "taskId", type: "string", description: "Task ID", required: true },
      { name: "status", type: "string", description: "目标状态", required: true },
    ],
    fn: ((ctx: MethodContext, { taskId, status }: any) =>
      m.updateTaskStatus(sessionDir(ctx), taskId, status)) as TraitMethod["fn"],
  },
  updateTask: {
    name: "updateTask",
    description: "更新 Task 字段",
    params: [
      { name: "taskId", type: "string", description: "Task ID", required: true },
      { name: "fields", type: "object", description: "要更新的字段", required: true },
    ],
    fn: ((ctx: MethodContext, { taskId, fields }: any) =>
      m.updateTask(sessionDir(ctx), taskId, fields)) as TraitMethod["fn"],
  },
  createSubTask: {
    name: "createSubTask",
    description: "创建子任务",
    params: [
      { name: "taskId", type: "string", description: "Task ID", required: true },
      { name: "title", type: "string", description: "标题", required: true },
      { name: "assignee", type: "string", description: "分配对象", required: false },
    ],
    fn: ((ctx: MethodContext, { taskId, title, assignee }: any) =>
      m.createSubTask(sessionDir(ctx), taskId, title, assignee)) as TraitMethod["fn"],
  },
  updateSubTask: {
    name: "updateSubTask",
    description: "更新子任务",
    params: [
      { name: "taskId", type: "string", description: "Task ID", required: true },
      { name: "subTaskId", type: "string", description: "子任务 ID", required: true },
      { name: "fields", type: "object", description: "要更新的字段", required: true },
    ],
    fn: ((ctx: MethodContext, { taskId, subTaskId, fields }: any) =>
      m.updateSubTask(sessionDir(ctx), taskId, subTaskId, fields)) as TraitMethod["fn"],
  },
  setTaskNewInfo: {
    name: "setTaskNewInfo",
    description: "标记 Task 是否有需要人类确认的新信息",
    params: [
      { name: "taskId", type: "string", description: "Task ID", required: true },
      { name: "hasNewInfo", type: "boolean", description: "是否有新信息", required: true },
    ],
    fn: ((ctx: MethodContext, { taskId, hasNewInfo }: any) =>
      m.setTaskNewInfo(sessionDir(ctx), taskId, hasNewInfo)) as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
