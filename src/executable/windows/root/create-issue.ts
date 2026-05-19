/**
 * root.create_issue command — 创建一个 session 内的 Issue,并挂载本 thread 的
 * IssueWindow 作为订阅入口。
 *
 * 参数:
 * - title: 必填,Issue 简短标题
 * - description: 可选,详情(常含决策背景)
 *
 * submit 副作用:
 * 1. 调 persistable.issuesService.createIssue 写 issue-{id}.json + index.json
 *    (走 per-session SerialQueue,并发安全)
 * 2. ctx.manager.insertTypedWindow 挂 IssueWindow(本 thread 订阅该 Issue)
 *
 * A2 failure recovery:Issue 文件已写但 insertTypedWindow 抛错 → 返回 error
 * 含 issueId,LLM 可用 open_issue(issueId) 接管(避免孤儿)
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../command-types.js";
import { issuesService } from "../../../persistable/index.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type IssueWindow,
} from "../types.js";

const CREATE_ISSUE_BASIC_PATH = "internal/executable/create_issue/basic";
const CREATE_ISSUE_INPUT_PATH = "internal/executable/create_issue/input";

const KNOWLEDGE = `
create_issue 用于在当前 session 内开启一个 Issue(看板议题),并自动让本 thread
订阅该 Issue 的更新。

参数:
- title: 必填,Issue 简短标题(同 session 内不强制唯一)
- description: 可选,详情(常含决策背景 / 任务描述);其它 agent open_issue 后
  会在 derive body 里看到

submit 后:
- 服务端创建 issue-{id}.json,Id 自动分配
- 本 thread 挂一个 type=issue 的 window;后续 LLM 可在该 window 上:
  - comment(text, mentions?) 写评论;mentions 显式声明唤醒目标
  - close 该 window(仅本 thread 解订阅;Issue 文件不动)
  - wait(on=<this window>) 等待新评论

何时用 create_issue 而不是 talk:
- 需要 3+ agent 一起讨论 → Issue
- 决策需要后续追溯 → Issue(有结构化 comment 流)
- 一对一短讯 → 仍用 talk
`.trim();

export const createIssueCommand: CommandTableEntry = {
  paths: ["create_issue"],
  match: () => ["create_issue"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [CREATE_ISSUE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) {
      entries[CREATE_ISSUE_INPUT_PATH] =
        "create_issue 需要 title;用 refine(args={ title: '...', description?: '...' }),或在 open 时一次给齐。";
    }
    return entries;
  },
  exec: (ctx) => executeCreateIssue(ctx),
};

export async function executeCreateIssue(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[create_issue] 缺少 thread context。";
  if (!thread.persistence) return "[create_issue] thread 无 persistence,无法创建 Issue。";

  const title = typeof ctx.args.title === "string" ? ctx.args.title.trim() : "";
  if (!title) return "[create_issue] 缺少 title 参数。";
  const description =
    typeof ctx.args.description === "string" ? ctx.args.description : undefined;

  // Step 1: create Issue 文件(成功后拿到 newId)
  let newId: number;
  try {
    const issue = await issuesService.createIssue({
      baseDir: thread.persistence.baseDir,
      sessionId: thread.persistence.sessionId,
      title,
      description,
      createdByObjectId: thread.persistence.objectId,
    });
    newId = issue.id;
  } catch (error) {
    return `[create_issue] 创建失败: ${(error as Error).message}`;
  }

  // Step 2: 挂 IssueWindow;失败时返回 issueId 让 LLM 自救
  const window: IssueWindow = {
    id: generateWindowId("issue"),
    type: "issue",
    parentWindowId: ROOT_WINDOW_ID,
    title: `Issue #${newId}: ${title.slice(0, 50)}`,
    status: "open",
    createdAt: Date.now(),
    issueId: newId,
  };
  try {
    if (ctx.manager) {
      ctx.manager.insertTypedWindow(window);
    } else {
      thread.contextWindows = [...(thread.contextWindows ?? []), window];
    }
  } catch (error) {
    // A2: Issue 文件已落盘但 window 挂载失败,告诉 LLM 用 open_issue 接管
    return `[create_issue] Issue #${newId} 已创建但 window 挂载失败 (${(error as Error).message});可用 open_issue(${newId}) 接管该 Issue 的订阅。`;
  }
  return undefined;
}
