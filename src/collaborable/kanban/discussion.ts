// kernel/src/collaborable/kanban/discussion.ts
// Issue 讨论方法 — 评论、读取评论、读取 Issue

import type { Comment, Issue } from "./types";
import { readIssues, writeIssues, nextId, now } from "./store";

/** 在 Issue 下发表评论，返回评论和需要通知的对象列表 */
export async function commentOnIssue(
  sessionDir: string, issueId: string, author: string, content: string, mentions?: string[],
): Promise<{ comment: Comment; mentionTargets: string[] }> {
  const issues = await readIssues(sessionDir);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found`);

  const comment: Comment = {
    id: nextId("comment", issue.comments),
    author,
    content,
    mentions,
    createdAt: now(),
  };
  issue.comments.push(comment);

  // 非 user 的作者自动加入 participants
  if (author !== "user" && !issue.participants.includes(author)) {
    issue.participants.push(author);
  }

  issue.updatedAt = now();
  await writeIssues(sessionDir, issues);

  // mentionTargets 排除作者自身
  const mentionTargets = (mentions ?? []).filter((m) => m !== author);

  return { comment, mentionTargets };
}

/** 读取 Issue 的评论列表 */
export async function listIssueComments(sessionDir: string, issueId: string): Promise<Comment[]> {
  const issues = await readIssues(sessionDir);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found`);
  return issue.comments;
}

/** 读取 Issue 详情 */
export async function getIssue(sessionDir: string, issueId: string): Promise<Issue> {
  const issues = await readIssues(sessionDir);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found`);
  return issue;
}
