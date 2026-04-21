/**
 * issue-discussion kernel trait — 所有对象共享的 Issue 讨论能力
 * Phase 2 协议：llm_methods 对象导出
 */

import type { MethodContext } from "../../../src/trait/registry";
import type { TraitMethod } from "../../../src/types/index";
import * as d from "../../../src/kanban/discussion";

function sessionDir(ctx: MethodContext): string {
  return `${ctx.rootDir}/flows/${ctx.sessionId}`;
}

export const llm_methods: Record<string, TraitMethod> = {
  commentOnIssue: {
    name: "commentOnIssue",
    description: "在 Issue 下发表评论",
    params: [
      { name: "issueId", type: "string", description: "Issue ID", required: true },
      { name: "content", type: "string", description: "评论内容", required: true },
      { name: "mentions", type: "string[]", description: "@的对象列表", required: false },
    ],
    fn: ((ctx: MethodContext, { issueId, content, mentions }: any) =>
      d.commentOnIssue(sessionDir(ctx), issueId, ctx.stoneName, content, mentions)) as TraitMethod["fn"],
  },
  listIssueComments: {
    name: "listIssueComments",
    description: "读取 Issue 的评论列表",
    params: [{ name: "issueId", type: "string", description: "Issue ID", required: true }],
    fn: ((ctx: MethodContext, { issueId }: any) =>
      d.listIssueComments(sessionDir(ctx), issueId)) as TraitMethod["fn"],
  },
  getIssue: {
    name: "getIssue",
    description: "读取 Issue 详情",
    params: [{ name: "issueId", type: "string", description: "Issue ID", required: true }],
    fn: ((ctx: MethodContext, { issueId }: any) =>
      d.getIssue(sessionDir(ctx), issueId)) as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
