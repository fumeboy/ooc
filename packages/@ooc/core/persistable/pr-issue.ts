/**
 * PR-Issue 持久化 —— stone-versioning 决议链路专用。
 *
 * 与已移除的 "issue 看板" 是**不同概念**：
 * - issue 看板（已 2026-05-26 移除）：session 级共享议题，含订阅 / @mention / comment 流
 * - PR-Issue（本模块）：stone-versioning 中跨自治区改动的评审 token，仅 supervisor 决议
 *
 * 文件布局（沿用历史路径以便老 world 兼容）：
 *   flows/super/issues/
 *     issue-{id}.json   ← 单条 PR-Issue 记录（含 prPayload）
 *     index.json        ← super session 内所有 PR-Issue 的摘要 + nextId
 *
 * 设计要点：
 * - 不依赖 issue 看板的 comments[] / mentions / subscribers 等运行时概念
 * - createPrIssue / createRecoveryIssue 都走 enqueueSessionWrite("super") 串行化
 * - readPrIssue / readPrIssueIndex 不存在时返回 undefined / 空索引（idempotent）
 */

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stoneDir, STONES_MAIN_BRANCH } from "./common";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";
import { toJson } from "./common";

/** super session id（PR-Issue 落盘约定，不可改）。 */
export const PR_ISSUE_SESSION_ID = "super";

/** 标题前缀长度上限，便于 list view 不被超长 title 撑爆。 */
const MAX_TITLE_LENGTH = 200;

/** PR diff / intent / paths 上限（防 super session 被超大 patch 撑爆）。 */
const MAX_PR_DIFF_LENGTH = 65536; // 64KB
const MAX_PR_INTENT_LENGTH = 4096;
const MAX_PR_PATHS = 200;

/**
 * PR-Issue 载荷：Object 在 worktree 内 commit 后请求 cross-scope merge 时填。
 * Supervisor 在自己的 super flow 中读到该 Issue 即可看到 diff、修改意图、来源 worktree。
 */
export interface PrIssuePayload {
  /** 修改意图说明（LLM 自由文本，长度由 service 层校验）。 */
  intent: string;
  /** 待评审的 worktree branch 名（如 `session-<sid>`）。 */
  branch: string;
  /** branch 相对 main merge-base 的累积 patch（unified diff 文本）。 */
  diff: string;
  /** 涉及的文件路径列表（diff 解析后的相对 stones/ 根的路径）。 */
  paths: string[];
  /** 触发 PR 时的 main HEAD sha（Supervisor 决议时验证 base 未飘）。 */
  baseSha: string;
}

/**
 * 单条 PR-Issue 的磁盘形态（recovery-needed 也复用该 schema，prPayload 为空）。
 */
export interface PrIssueRecord {
  /** PR-Issue 在 super session 内的全局 id。 */
  id: number;
  /** 简短标题（PR-Issue 自动加 `[PR]` 前缀；recovery-needed 用 `[recovery-needed] ...`）。 */
  title: string;
  /** 详情描述（可选；通常含决策背景）。 */
  description?: string;
  /** 状态：open → closed；一旦 closed 不再处理。 */
  status: "open" | "closed";
  /** 创建者 objectId。 */
  createdByObjectId: string;
  /** 创建时间戳（ms）。 */
  createdAt: number;
  /** 最后一次写入时间戳（ms）。 */
  lastUpdatedAt: number;
  /** PR-Issue 才有的 payload；recovery-needed 类 issue 留空。 */
  prPayload?: PrIssuePayload;
}

/** index.json 内对单条 PR-Issue 的摘要条目。 */
export interface PrIssueIndexEntry {
  id: number;
  title: string;
  status: "open" | "closed";
  createdByObjectId: string;
  createdAt: number;
  lastUpdatedAt: number;
}

/** index.json 整体形态。 */
export interface PrIssueIndex {
  nextId: number;
  issues: PrIssueIndexEntry[];
}

/* ---------------------------------------------------------------- *
 * 路径与 IO（不暴露给外部 caller，统一通过 service 函数访问）
 * ---------------------------------------------------------------- */

function issuesDir(baseDir: string): string {
  return join(baseDir, "flows", PR_ISSUE_SESSION_ID, "issues");
}

function issueFile(baseDir: string, issueId: number): string {
  if (!Number.isInteger(issueId) || issueId < 1) {
    throw new Error(`[pr-issue] invalid issueId: ${issueId}`);
  }
  return join(issuesDir(baseDir), `issue-${issueId}.json`);
}

function issueIndexFile(baseDir: string): string {
  return join(issuesDir(baseDir), "index.json");
}

/** 读取 PR-Issue；不存在返回 undefined（ENOENT 静默）。 */
export async function readPrIssue(
  baseDir: string,
  issueId: number,
): Promise<PrIssueRecord | undefined> {
  try {
    const text = await readFile(issueFile(baseDir, issueId), "utf8");
    return JSON.parse(text) as PrIssueRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 读取 PR-Issue index；不存在返回空索引。 */
export async function readPrIssueIndex(baseDir: string): Promise<PrIssueIndex> {
  try {
    const text = await readFile(issueIndexFile(baseDir), "utf8");
    return JSON.parse(text) as PrIssueIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { nextId: 1, issues: [] };
    }
    throw error;
  }
}

async function writePrIssue(baseDir: string, issue: PrIssueRecord): Promise<void> {
  const path = issueFile(baseDir, issue.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toJson(issue), "utf8");
}

async function writePrIssueIndex(baseDir: string, index: PrIssueIndex): Promise<void> {
  const path = issueIndexFile(baseDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toJson(index), "utf8");
}

function summarize(issue: PrIssueRecord): PrIssueIndexEntry {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    createdByObjectId: issue.createdByObjectId,
    createdAt: issue.createdAt,
    lastUpdatedAt: issue.lastUpdatedAt,
  };
}

/* ---------------------------------------------------------------- *
 * 校验
 * ---------------------------------------------------------------- */

async function ensureAuthorExists(baseDir: string, authorObjectId: string): Promise<void> {
  if (!authorObjectId || typeof authorObjectId !== "string") {
    throw new Error(`[pr-issue] invalid authorObjectId: ${JSON.stringify(authorObjectId)}`);
  }
  try {
    const stats = await stat(stoneDir({ baseDir, objectId: authorObjectId, _stonesBranch: STONES_MAIN_BRANCH }));
    if (!stats.isDirectory()) {
      throw new Error(`[pr-issue] authorObjectId "${authorObjectId}" not a stone object`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`[pr-issue] authorObjectId "${authorObjectId}" does not exist in stones/`);
    }
    throw error;
  }
}

function validatePrPayload(payload: PrIssuePayload): void {
  if (!payload.intent || !payload.intent.trim()) throw new Error("[pr-issue] prPayload.intent required");
  if (payload.intent.length > MAX_PR_INTENT_LENGTH) {
    throw new Error(`[pr-issue] prPayload.intent too long: ${payload.intent.length} > ${MAX_PR_INTENT_LENGTH}`);
  }
  if (!payload.branch || !payload.branch.trim()) throw new Error("[pr-issue] prPayload.branch required");
  if (payload.branch.includes("..") || payload.branch.includes("\0")) {
    throw new Error(`[pr-issue] prPayload.branch unsafe: ${JSON.stringify(payload.branch)}`);
  }
  if (typeof payload.diff !== "string") throw new Error("[pr-issue] prPayload.diff required");
  if (payload.diff.length > MAX_PR_DIFF_LENGTH) {
    throw new Error(`[pr-issue] prPayload.diff too long: ${payload.diff.length} > ${MAX_PR_DIFF_LENGTH}`);
  }
  if (!Array.isArray(payload.paths)) throw new Error("[pr-issue] prPayload.paths must be array");
  if (payload.paths.length > MAX_PR_PATHS) {
    throw new Error(`[pr-issue] prPayload.paths too many: ${payload.paths.length} > ${MAX_PR_PATHS}`);
  }
  for (const p of payload.paths) {
    if (typeof p !== "string" || p.includes("\0")) {
      throw new Error(`[pr-issue] prPayload.paths contains invalid entry: ${JSON.stringify(p)}`);
    }
  }
  if (!payload.baseSha || typeof payload.baseSha !== "string") {
    throw new Error("[pr-issue] prPayload.baseSha required");
  }
}

/* ---------------------------------------------------------------- *
 * service 入口（被 stone-versioning + recovery-check 调用）
 * ---------------------------------------------------------------- */

export interface CreatePrIssueInput {
  baseDir: string;
  /** PR-Issue 标题；service 自动加 `[PR]` 前缀（除非已带）。 */
  title: string;
  /** 发起 Object（main-side objectId）；service 校验 stones/main/<id>/ 存在。 */
  createdByObjectId: string;
  description?: string;
  /** PR-Issue payload：diff、worktree branch、intent、baseSha、paths 列表。 */
  prPayload: PrIssuePayload;
}

/**
 * U5: 创建 PR-Issue —— 落在 super session（`flows/super/issues/`），由 Supervisor
 * 在自己的 super flow 中读到并评审。
 *
 * - 标题自动加 `[PR]` 前缀（若未带）
 * - 必带 prPayload；recovery-needed 类 issue 走 createRecoveryIssue
 */
export async function createPrIssue(input: CreatePrIssueInput): Promise<PrIssueRecord> {
  const { baseDir, title, description, createdByObjectId, prPayload } = input;
  if (!title || !title.trim()) {
    throw new Error("[pr-issue] PR title is required");
  }
  validatePrPayload(prPayload);
  const trimmed = title.trim();
  const decoratedTitle = (trimmed.startsWith("[PR]") ? trimmed : `[PR] ${trimmed}`).slice(0, MAX_TITLE_LENGTH);

  return enqueueSessionWrite(PR_ISSUE_SESSION_ID, async () => {
    await ensureAuthorExists(baseDir, createdByObjectId);

    const index = await readPrIssueIndex(baseDir);
    const newId = index.nextId;
    const now = Date.now();
    const issue: PrIssueRecord = {
      id: newId,
      title: decoratedTitle,
      description,
      status: "open",
      createdByObjectId,
      createdAt: now,
      lastUpdatedAt: now,
      prPayload,
    };
    await writePrIssue(baseDir, issue);
    await writePrIssueIndex(baseDir, {
      nextId: newId + 1,
      issues: [...index.issues, summarize(issue)],
    });
    return issue;
  });
}

export interface CreateRecoveryIssueInput {
  baseDir: string;
  title: string;
  createdByObjectId: string;
  description?: string;
}

/**
 * 创建一条 recovery-needed 类 issue（无 prPayload；diagnostic 信号）。
 *
 * 用于启动期 recovery-check 发现 broken stone 时通知 supervisor；与 PR-Issue 共享
 * 同一 super session storage 但语义独立（无 diff / branch / paths）。
 */
export async function createRecoveryIssue(
  input: CreateRecoveryIssueInput,
): Promise<PrIssueRecord> {
  const { baseDir, title, description, createdByObjectId } = input;
  if (!title || !title.trim()) {
    throw new Error("[pr-issue] recovery title is required");
  }
  const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);

  return enqueueSessionWrite(PR_ISSUE_SESSION_ID, async () => {
    await ensureAuthorExists(baseDir, createdByObjectId);

    const index = await readPrIssueIndex(baseDir);
    const newId = index.nextId;
    const now = Date.now();
    const issue: PrIssueRecord = {
      id: newId,
      title: trimmed,
      description,
      status: "open",
      createdByObjectId,
      createdAt: now,
      lastUpdatedAt: now,
    };
    await writePrIssue(baseDir, issue);
    await writePrIssueIndex(baseDir, {
      nextId: newId + 1,
      issues: [...index.issues, summarize(issue)],
    });
    return issue;
  });
}

/**
 * 关闭 PR-Issue；status → "closed"。idempotent：已 closed 时 noop=true。
 */
export async function closePrIssue(input: {
  baseDir: string;
  issueId: number;
}): Promise<{ issue: PrIssueRecord; noop: boolean }> {
  return enqueueSessionWrite(PR_ISSUE_SESSION_ID, async () => {
    const issue = await readPrIssue(input.baseDir, input.issueId);
    if (!issue) {
      throw new Error(`[pr-issue] PR-Issue #${input.issueId} not found`);
    }
    if (issue.status === "closed") return { issue, noop: true };
    const closed: PrIssueRecord = { ...issue, status: "closed", lastUpdatedAt: Date.now() };
    await writePrIssue(input.baseDir, closed);
    const index = await readPrIssueIndex(input.baseDir);
    await writePrIssueIndex(input.baseDir, {
      ...index,
      issues: index.issues.map((entry) =>
        entry.id === input.issueId
          ? { ...entry, status: "closed", lastUpdatedAt: closed.lastUpdatedAt }
          : entry,
      ),
    });
    return { issue: closed, noop: false };
  });
}
