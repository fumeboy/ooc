/**
 * Issue service —— Tier A 业务逻辑(create / appendComment / closeIssue / list / get)+
 * 订阅扫描 helper(`findIssueSubscribers`)。
 *
 * 设计要点(plan §4 决策 2/3):
 * - **不依赖 `src/app/server/runtime/jobManager`** —— enqueue 由 caller(HTTP /
 *   LLM 命令 / worker)拿 `findIssueSubscribers` 的结果自己入队,避免 persistable
 *   层反向 import 上层(F2 同心问题)
 * - 所有写入经 `enqueueSessionWrite(sessionId, ...)`,保证同 session 内的
 *   createIssue / appendComment / closeIssue 串行,index.json 不被踩坏
 * - `authorObjectId` 校验存在于 stones 目录(防身份伪造,S3 fix)
 * - `text` 上限 4KB(防超长 prompt injection,S2 fix)
 * - `mentions` 双轨:文本正则 + structured 参数取并集去重(P1 fix)
 *
 * 不在此处:
 * - HTTP schema 校验(那是 U3 的事)
 * - LLM 命令 IssueWindow 挂载(那是 U5/U6)
 * - inbox 通知与 push enqueue(那是 caller / U9)
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { stoneDir, type ThreadPersistenceRef } from "./common";
import {
  type Comment,
  type Issue,
  type IssueIndexEntry,
  type PrIssuePayload,
  readIssue,
  readIssueIndex,
  writeIssue,
  writeIssueIndex,
} from "./issue";
import { parseMentions } from "./mention";
import { enqueueSessionWrite } from "./serial-queue";
import { readThread } from "./thread-json";

/** 单 comment 最大长度(字节,UTF-16 char 计数);S2 防 prompt injection 超长输入。 */
const MAX_COMMENT_TEXT_LENGTH = 4096;

/** sessionId 校验已在 `issue.ts:issueFile` / `issueIndexFile` 入口做,此处不重复。 */

async function ensureAuthorExists(baseDir: string, authorObjectId: string): Promise<void> {
  if (!authorObjectId || typeof authorObjectId !== "string") {
    throw new Error(`[issue-service] invalid authorObjectId: ${JSON.stringify(authorObjectId)}`);
  }
  // S3:检查 stones/<authorObjectId>/ 是否存在,防 author 伪造
  try {
    const stats = await stat(stoneDir({ baseDir, objectId: authorObjectId }));
    if (!stats.isDirectory()) {
      throw new Error(`[issue-service] authorObjectId "${authorObjectId}" not a stone object`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`[issue-service] authorObjectId "${authorObjectId}" does not exist in stones/`);
    }
    throw error;
  }
}

/**
 * R3 #14: mentions[] 对称校验。createdByObjectId 已严格校验存在性（ensureAuthorExists），
 * mentions 之前不校验形成不对称——补上：每个 mention objectId 必须是 stones/ 下存在的
 * 真实 object，否则抛错。caller 可通过 allowGhostMentions=true 显式放宽（跨 session /
 * 未来 object / 测试场景）。默认严格。
 */
async function ensureMentionsExist(
  baseDir: string,
  mentions: string[],
  allowGhost: boolean,
): Promise<void> {
  if (allowGhost) return;
  for (const id of mentions) {
    if (!id || typeof id !== "string") {
      throw new Error(`[issue-service] invalid mention: ${JSON.stringify(id)}`);
    }
    try {
      const stats = await stat(stoneDir({ baseDir, objectId: id }));
      if (!stats.isDirectory()) {
        throw new Error(`[issue-service] mention "${id}" not a stone object`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `[issue-service] mention "${id}" does not exist in stones/ (use allowGhostMentions=true to bypass)`,
        );
      }
      throw error;
    }
  }
}

/** U5: PR-Issue 持久化的 super-session 约定（plan §0.7 / Q1 用户决策）。 */
export const PR_ISSUE_SESSION_ID = "super";

/** PR-Issue 载荷上限（diff 文本 + intent + paths 约束，防止 super session 被超大 patch 撑爆）。 */
const MAX_PR_DIFF_LENGTH = 65536; // 64KB
const MAX_PR_INTENT_LENGTH = 4096;
const MAX_PR_PATHS = 200;

export interface CreatePrIssueInput {
  baseDir: string;
  /** 标题前缀；service 自动加 `[PR]` 让列表 UI 区分。 */
  title: string;
  /**
   * 创建 Object（开 worktree 的那个 Object 的 main-side objectId）；service 校验
   * `stones/main/<objectId>/` 存在。
   */
  createdByObjectId: string;
  /** 详细说明（可选；通常 LLM 用来写决策背景）。 */
  description?: string;
  /** PR-Issue payload：diff、worktree branch、intent、baseSha、paths 列表。 */
  prPayload: PrIssuePayload;
}

function validatePrPayload(payload: PrIssuePayload): void {
  if (!payload.intent || !payload.intent.trim()) throw new Error("[issue-service] prPayload.intent required");
  if (payload.intent.length > MAX_PR_INTENT_LENGTH) {
    throw new Error(`[issue-service] prPayload.intent too long: ${payload.intent.length} > ${MAX_PR_INTENT_LENGTH}`);
  }
  if (!payload.branch || !payload.branch.trim()) throw new Error("[issue-service] prPayload.branch required");
  if (payload.branch.includes("..") || payload.branch.includes("\0")) {
    throw new Error(`[issue-service] prPayload.branch unsafe: ${JSON.stringify(payload.branch)}`);
  }
  if (typeof payload.diff !== "string") throw new Error("[issue-service] prPayload.diff required");
  if (payload.diff.length > MAX_PR_DIFF_LENGTH) {
    throw new Error(`[issue-service] prPayload.diff too long: ${payload.diff.length} > ${MAX_PR_DIFF_LENGTH}`);
  }
  if (!Array.isArray(payload.paths)) throw new Error("[issue-service] prPayload.paths must be array");
  if (payload.paths.length > MAX_PR_PATHS) {
    throw new Error(`[issue-service] prPayload.paths too many: ${payload.paths.length} > ${MAX_PR_PATHS}`);
  }
  for (const p of payload.paths) {
    if (typeof p !== "string" || p.includes("\0")) {
      throw new Error(`[issue-service] prPayload.paths contains invalid entry: ${JSON.stringify(p)}`);
    }
  }
  if (!payload.baseSha || typeof payload.baseSha !== "string") {
    throw new Error("[issue-service] prPayload.baseSha required");
  }
}

export interface CreateIssueInput {
  baseDir: string;
  sessionId: string;
  title: string;
  description?: string;
  /** 创建者 objectId;必须是 stones/ 下已存在的 object。 */
  createdByObjectId: string;
  /**
   * Structured mention 列表（R7-1 修复）：HTTP createIssue 也对称校验。
   * 默认严格——每个 mention 必须是 stones/ 下已存在的 object。
   */
  mentions?: string[];
  /** R7-1：与 appendComment 对称；显式放宽校验（跨 session / 未来 object）。 */
  allowGhostMentions?: boolean;
}

export interface AppendCommentInput {
  baseDir: string;
  sessionId: string;
  issueId: number;
  text: string;
  authorObjectId: string;
  /** 由 caller 决定:LLM 命令 → "llm",HTTP curl → "user"。 */
  authorKind: "llm" | "user";
  /**
   * Structured mention 列表(P1 双轨)。LLM 显式声明优先;与 text 中正则解析
   * 出的 mention 取并集去重作为 `Comment.mentions`。
   */
  mentions?: string[];
  /**
   * R3 #14:默认每个 mention 必须是 stones/ 下已存在的 object;
   * 跨 session / 未来 object 等场景显式置 true 放宽校验。
   */
  allowGhostMentions?: boolean;
}

export interface AppendCommentResult {
  commentId: number;
  resolved_mentions: string[];
}

export interface CloseIssueInput {
  baseDir: string;
  sessionId: string;
  issueId: number;
}

function summarize(issue: Issue): IssueIndexEntry {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    commentCount: issue.comments.length,
    createdByObjectId: issue.createdByObjectId,
    createdAt: issue.createdAt,
    lastUpdatedAt: issue.lastUpdatedAt,
  };
}

export const issuesService = {
  /** 创建新 Issue;分配 id;返回完整 Issue。 */
  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const { baseDir, sessionId, title, description, createdByObjectId, mentions, allowGhostMentions } = input;
    if (!title || !title.trim()) {
      throw new Error("[issue-service] title is required");
    }

    return enqueueSessionWrite(sessionId, async () => {
      // S3 校验放在 SerialQueue 内,保证 enqueue 顺序由 caller 同步入队即决定,
      // 不被并发的 stat IO 重排
      await ensureAuthorExists(baseDir, createdByObjectId);
      // R7-1：mentions 与 appendComment 对称校验。默认严格;allowGhostMentions 显式放宽。
      if (mentions && mentions.length > 0) {
        await ensureMentionsExist(baseDir, mentions, allowGhostMentions ?? false);
      }

      const index = await readIssueIndex(baseDir, sessionId);
      const newId = index.nextId;
      const now = Date.now();
      const issue: Issue = {
        id: newId,
        title: title.trim(),
        description,
        status: "open",
        createdByObjectId,
        createdAt: now,
        lastUpdatedAt: now,
        comments: [],
      };
      await writeIssue(baseDir, sessionId, issue);
      await writeIssueIndex(baseDir, sessionId, {
        nextId: newId + 1,
        issues: [...index.issues, summarize(issue)],
      });
      return issue;
    });
  },

  /**
   * U5: 创建 PR-Issue —— 落在 super session（`flows/super/issues/`），永久持久化，
   * 由 Supervisor 在自己的 super flow 中读到并审阅。
   *
   * 与 `createIssue` 的差别：
   * - sessionId 强制为 "super"
   * - 标题自动加 `[PR]` 前缀（UI list 视图区分）
   * - 必带 prPayload（diff / branch / intent / paths / baseSha）
   */
  async createPrIssue(input: CreatePrIssueInput): Promise<Issue> {
    const { baseDir, title, description, createdByObjectId, prPayload } = input;
    if (!title || !title.trim()) {
      throw new Error("[issue-service] PR title is required");
    }
    validatePrPayload(prPayload);
    const sessionId = PR_ISSUE_SESSION_ID;
    const decoratedTitle = title.trim().startsWith("[PR]") ? title.trim() : `[PR] ${title.trim()}`;

    return enqueueSessionWrite(sessionId, async () => {
      await ensureAuthorExists(baseDir, createdByObjectId);

      const index = await readIssueIndex(baseDir, sessionId);
      const newId = index.nextId;
      const now = Date.now();
      const issue: Issue = {
        id: newId,
        title: decoratedTitle,
        description,
        status: "open",
        createdByObjectId,
        createdAt: now,
        lastUpdatedAt: now,
        comments: [],
        prPayload,
      };
      await writeIssue(baseDir, sessionId, issue);
      await writeIssueIndex(baseDir, sessionId, {
        nextId: newId + 1,
        issues: [...index.issues, summarize(issue)],
      });
      return issue;
    });
  },

  /** 追加 comment;返回 commentId + resolved_mentions(并集去重)。Issue 已关闭 → 抛错。 */
  async appendComment(input: AppendCommentInput): Promise<AppendCommentResult> {
    const { baseDir, sessionId, issueId, text, authorObjectId, authorKind, mentions, allowGhostMentions } = input;
    if (!text || !text.trim()) {
      throw new Error("[issue-service] comment text is required");
    }
    if (text.length > MAX_COMMENT_TEXT_LENGTH) {
      throw new Error(
        `[issue-service] comment text too long: ${text.length} > ${MAX_COMMENT_TEXT_LENGTH}`,
      );
    }

    return enqueueSessionWrite(sessionId, async () => {
      // S3 校验也放进 SerialQueue 保证排队顺序由调用方同步入队决定
      await ensureAuthorExists(baseDir, authorObjectId);

      const issue = await readIssue(baseDir, sessionId, issueId);
      if (!issue) {
        throw new Error(`[issue-service] Issue #${issueId} not found in session ${sessionId}`);
      }
      if (issue.status !== "open") {
        throw new Error(`[issue-service] Issue #${issueId} is ${issue.status}; cannot append`);
      }

      // P1 双轨:正则解析 + structured 参数取并集去重(保持首次出现顺序)
      const seen = new Set<string>();
      const resolved: string[] = [];
      for (const id of [...(mentions ?? []), ...parseMentions(text)]) {
        if (!seen.has(id)) {
          seen.add(id);
          resolved.push(id);
        }
      }

      // R3 #14:mentions 对称校验(默认严格,allowGhostMentions=true 放宽)
      await ensureMentionsExist(baseDir, resolved, allowGhostMentions === true);

      const commentId = issue.comments.length + 1;
      const comment: Comment = {
        id: commentId,
        text,
        authorObjectId,
        authorKind,
        mentions: resolved,
        createdAt: Date.now(),
      };
      const updated: Issue = {
        ...issue,
        comments: [...issue.comments, comment],
        lastUpdatedAt: comment.createdAt,
      };
      await writeIssue(baseDir, sessionId, updated);

      // 同步 index 摘要(commentCount + lastUpdatedAt)
      const index = await readIssueIndex(baseDir, sessionId);
      const updatedIndex = {
        ...index,
        issues: index.issues.map((entry) =>
          entry.id === issueId
            ? { ...entry, commentCount: updated.comments.length, lastUpdatedAt: updated.lastUpdatedAt }
            : entry,
        ),
      };
      await writeIssueIndex(baseDir, sessionId, updatedIndex);

      return { commentId, resolved_mentions: resolved };
    });
  },

  /**
   * 关闭 Issue;status → "closed";后续 appendComment 抛错。
   * R3 #17:close 幂等;若调用时 issue 已 closed,返回的 result.noop === true,
   * 让 caller 区分"刚被本次关闭"vs"本就 closed"。
   */
  async closeIssue(input: CloseIssueInput): Promise<{ issue: Issue; noop: boolean }> {
    const { baseDir, sessionId, issueId } = input;
    return enqueueSessionWrite(sessionId, async () => {
      const issue = await readIssue(baseDir, sessionId, issueId);
      if (!issue) {
        throw new Error(`[issue-service] Issue #${issueId} not found in session ${sessionId}`);
      }
      if (issue.status === "closed") return { issue, noop: true }; // idempotent
      const closed: Issue = { ...issue, status: "closed", lastUpdatedAt: Date.now() };
      await writeIssue(baseDir, sessionId, closed);
      const index = await readIssueIndex(baseDir, sessionId);
      await writeIssueIndex(baseDir, sessionId, {
        ...index,
        issues: index.issues.map((entry) =>
          entry.id === issueId
            ? { ...entry, status: "closed", lastUpdatedAt: closed.lastUpdatedAt }
            : entry,
        ),
      });
      return { issue: closed, noop: false };
    });
  },

  /** 读 Issue;不存在返回 undefined。 */
  async getIssue(input: { baseDir: string; sessionId: string; issueId: number }): Promise<Issue | undefined> {
    return readIssue(input.baseDir, input.sessionId, input.issueId);
  },

  /** 列出 session 内所有 Issue 摘要;无 issue 返回空数组。 */
  async listIssues(input: { baseDir: string; sessionId: string }): Promise<IssueIndexEntry[]> {
    const index = await readIssueIndex(input.baseDir, input.sessionId);
    return index.issues;
  },
};

/**
 * 扫 session 内所有 thread.json,找出持有 type=="issue" + issueId 匹配的 IssueWindow 的
 * thread 列表(F4 push 路径用)。
 *
 * 返回 ThreadPersistenceRef[],caller 拿到后自行决定调用 jobManager.createRunThreadJob
 * 入队(persistable 层不直接 enqueue,避免反向依赖)。
 *
 * 可选排除 `exceptThreadId`(通常是 author 自己 thread,无需自唤醒)。
 */
export async function findIssueSubscribers(
  baseDir: string,
  sessionId: string,
  issueId: number,
  options?: { exceptThreadId?: string; exceptObjectId?: string },
): Promise<ThreadPersistenceRef[]> {
  const objectsRoot = join(baseDir, "flows", sessionId, "objects");
  let objectDirs;
  try {
    objectDirs = await readdir(objectsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const found: ThreadPersistenceRef[] = [];
  for (const obj of objectDirs) {
    if (!obj.isDirectory()) continue;
    const threadsDir = join(objectsRoot, obj.name, "threads");
    let threadDirs;
    try {
      threadDirs = await readdir(threadsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const td of threadDirs) {
      if (!td.isDirectory()) continue;
      // 排除 self thread(author 不应被自唤醒)
      if (options?.exceptObjectId === obj.name && options.exceptThreadId === td.name) continue;
      const thread = await readThread({ baseDir, sessionId, objectId: obj.name }, td.name);
      if (!thread) continue;
      const hasWindow = thread.contextWindows.some(
        (w) => w.type === "issue" && w.issueId === issueId,
      );
      if (hasWindow) {
        found.push({ baseDir, sessionId, objectId: obj.name, threadId: td.name });
      }
    }
  }
  return found;
}
