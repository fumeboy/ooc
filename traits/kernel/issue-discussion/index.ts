// kernel/traits/kernel/issue-discussion/index.ts
// issue-discussion kernel trait — 所有对象共享的 Issue 讨论能力

import type { MethodContext } from "../../../src/trait/registry";
import * as d from "../../../src/kanban/discussion";

function sessionDir(ctx: MethodContext): string {
  return `${ctx.rootDir}/flows/${ctx.sessionId}`;
}

/** 在 Issue 下发表评论 @param issueId - Issue ID @param content - 评论内容 @param mentions - @的对象列表 */
export async function commentOnIssue(ctx: MethodContext, issueId: string, content: string, mentions?: string[]) {
  return d.commentOnIssue(sessionDir(ctx), issueId, ctx.stoneName, content, mentions);
}

/** 读取 Issue 的评论列表 @param issueId - Issue ID */
export async function listIssueComments(ctx: MethodContext, issueId: string) {
  return d.listIssueComments(sessionDir(ctx), issueId);
}

/** 读取 Issue 详情 @param issueId - Issue ID */
export async function getIssue(ctx: MethodContext, issueId: string) {
  return d.getIssue(sessionDir(ctx), issueId);
}
