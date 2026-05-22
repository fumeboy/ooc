/**
 * root.open_issue command — 把已存在的 Issue 拉进本 thread 作为订阅 window。
 *
 * 参数:
 * - issueId: 必填,要订阅的 Issue id
 *
 * submit 副作用:
 * 1. readIssue 校验 — Issue 不存在 → return command-error
 * 2. 已挂同 issueId 的 IssueWindow → 返回已有 windowId,不重复创建
 *    (F3 close=remove 之后,挂着的 window 都是 active 状态)
 * 3. 新挂 IssueWindow,lastSeenCommentId 初值=当前最新 commentId
 *    (避免首次 open 时历史 comment 全部触发 wake;但 derive body 仍展示完整内容)
 *
 * A3 文档澄清:lastSeenCommentId 只是 inbox 唤醒游标;
 * derive(U8) 始终给 LLM 展示 Issue 当前完整内容(description + 全部 comments
 * 经 N=20 截断)。close 后重新 open_issue → 新 window 同样能看到所有历史。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import { issuesService } from "../../../persistable/index.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type IssueWindow,
} from "../_shared/types.js";

const OPEN_ISSUE_BASIC_PATH = "internal/executable/open_issue/basic";
const OPEN_ISSUE_INPUT_PATH = "internal/executable/open_issue/input";

const KNOWLEDGE = `
open_issue 把某个已存在的 Issue 拉进本 thread 作为可订阅 window。

参数:
- issueId: 必填,Issue 的数字 id

submit 后:
- 服务端读 issue-{id}.json 校验存在;不存在 → command-error
- 本 thread 若已挂同 issueId 的 issue_window,直接复用,不重复创建
- 否则挂一个新的 issue_window;LLM 立刻能在 derive body 里看到 Issue 完整内容
  (description + 最近 N=20 条 comment;若有更早 comment 显示省略提示)
- 之后 LLM 可在该 window 上 comment / wait / close

何时 open_issue:
- 系统通知 [issue:N:comment ...] 提到自己 → open_issue 进场
- 想主动追溯 / 加入已有 Issue 讨论 → open_issue
- close 后想再次订阅同一 Issue → 再 open_issue,新 window 仍能看到完整历史
`.trim();

export const openIssueCommand: CommandTableEntry = {
  paths: ["open_issue"],
  match: () => ["open_issue"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [OPEN_ISSUE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const issueId = typeof args.issueId === "number" ? args.issueId : undefined;
    if (!issueId || !Number.isInteger(issueId) || issueId < 1) {
      entries[OPEN_ISSUE_INPUT_PATH] =
        "open_issue 需要正整数 issueId;用 refine(args={ issueId: <number> }),或在 open 时一次给齐。";
    }
    return entries;
  },
  exec: (ctx) => executeOpenIssue(ctx),
};

export async function executeOpenIssue(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[open_issue] 缺少 thread context。";
  if (!thread.persistence) return "[open_issue] thread 无 persistence。";

  const issueId = typeof ctx.args.issueId === "number" ? ctx.args.issueId : undefined;
  if (!issueId || !Number.isInteger(issueId) || issueId < 1) {
    return "[open_issue] issueId 必须是正整数。";
  }

  const issue = await issuesService.getIssue({
    baseDir: thread.persistence.baseDir,
    sessionId: thread.persistence.sessionId,
    issueId,
  });
  if (!issue) return `[open_issue] Issue #${issueId} 不存在。`;

  // Dedup:本 thread 已挂同 issueId 的 IssueWindow → 复用
  const existing = thread.contextWindows.find(
    (w) => w.type === "issue" && w.issueId === issueId,
  );
  if (existing) {
    return `[open_issue] Issue #${issueId} 已订阅(window: ${existing.id})。`;
  }

  // 首次挂:lastSeenCommentId = 当前最新 commentId(下次 sync 不会被历史 comment 全唤)
  // derive(U8)仍然给 LLM 看完整 Issue 内容,所以"看不到历史"≠"看不见内容"
  const window: IssueWindow = {
    id: generateWindowId("issue"),
    type: "issue",
    parentWindowId: ROOT_WINDOW_ID,
    title: `Issue #${issueId}: ${issue.title.slice(0, 50)}`,
    status: "open",
    createdAt: Date.now(),
    issueId,
    lastSeenCommentId: issue.comments.length,
  };
  if (ctx.manager) {
    ctx.manager.insertTypedWindow(window);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), window];
  }
  return undefined;
}
