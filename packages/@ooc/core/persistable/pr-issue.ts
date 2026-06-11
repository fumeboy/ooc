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
  /**
   * 发起沉淀的 super(foo) threadId（P6 回修，2026-06-11）：reject / request-changes /
   * 合入失败时把反馈 inbox 回投到这条 thread，让 super(foo) resume 修复。缺省（旧 record /
   * 测试直造）则 P6 路由不可达，由 caller fail-loud。
   */
  authorThreadId?: string;
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
  /**
   * 该 PR 的 reviewer 集（objectId 列表，P2 决策A 冒泡算出 + supervisor 恒含）。
   * **应批集合**：P3 审批聚合判定 ready-to-merge 时要求每个 reviewer 都已 approve。
   * feat-branch PR 必带；旧 record / recovery-needed 留空。
   */
  reviewers?: string[];
  /**
   * 每个 reviewer 的审批决议（P3，2026-06-11）。**已批状态**（与 reviewers 应批集合对应）。
   *   - "approved"          — 该 reviewer 同意合入
   *   - "rejected"          — 该 reviewer 拒绝（任一拒绝即整 PR 可 reject）
   *   - "changes-requested" — 要求 super(foo) 修改（留 open 等回修）
   * key ∈ reviewers；approvePrIssue 写入前校验。缺省（未批）= 该 reviewer 不在此 map。
   */
  approvals?: Record<string, PrApprovalDecision>;
}

/** 单个 reviewer 的审批决议（approvals map 的 value，P3）。 */
export type PrApprovalDecision = "approved" | "rejected" | "changes-requested";

/**
 * 审批聚合结论（P3，纯逻辑）：
 *   - "ready-to-merge"     — 所有 reviewer 都 approved → 可合入（合入闸由 P5 .world.json 决定）
 *   - "rejected"           — 任一 reviewer rejected → 可 archive 拒绝
 *   - "changes-requested"  — 无 reject、但有 reviewer 要求修改 → 留 open 等 super(foo) 回修
 *   - "pending"            — 仍有 reviewer 未批 → 等待
 *
 * reject 优先级最高（一票否决），其次 changes-requested，其次 pending，全 approve 才 ready。
 */
export type PrApprovalVerdict =
  | "ready-to-merge"
  | "rejected"
  | "changes-requested"
  | "pending";

/**
 * 纯函数：根据应批集合 reviewers + 已批状态 approvals 聚合出结论。
 *
 * reviewers 为空（无 reviewer，理论上不该发生——supervisor 恒含）→ "pending"（fail-safe，
 * 不自动放行）。仅统计 reviewers 内的决议；approvals 里的越界 key 不影响判定（防御）。
 */
export function aggregatePrApproval(
  reviewers: string[] | undefined,
  approvals: Record<string, PrApprovalDecision> | undefined,
): PrApprovalVerdict {
  const set = reviewers ?? [];
  if (set.length === 0) return "pending";
  const map = approvals ?? {};
  let hasReject = false;
  let hasChangesRequested = false;
  let allApproved = true;
  for (const r of set) {
    const d = map[r];
    if (d === "rejected") hasReject = true;
    else if (d === "changes-requested") hasChangesRequested = true;
    if (d !== "approved") allApproved = false;
  }
  if (hasReject) return "rejected";
  if (hasChangesRequested) return "changes-requested";
  if (allApproved) return "ready-to-merge";
  return "pending";
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
  /**
   * reviewer 集（objectId 列表，P2 冒泡结果）。feat-branch PR 传入；缺省视为 []。
   * 仅存储——P1+P2 不据此强制审批（interim 合入走 resolvePrIssue）。
   */
  reviewers?: string[];
}

/**
 * U5: 创建 PR-Issue —— 落在 super session（`flows/super/issues/`），由 Supervisor
 * 在自己的 super flow 中读到并评审。
 *
 * - 标题自动加 `[PR]` 前缀（若未带）
 * - 必带 prPayload；recovery-needed 类 issue 走 createRecoveryIssue
 */
export async function createPrIssue(input: CreatePrIssueInput): Promise<PrIssueRecord> {
  const { baseDir, title, description, createdByObjectId, prPayload, reviewers } = input;
  if (!title || !title.trim()) {
    throw new Error("[pr-issue] PR title is required");
  }
  validatePrPayload(prPayload);
  if (reviewers !== undefined) {
    if (!Array.isArray(reviewers) || reviewers.some((r) => typeof r !== "string" || !r.trim())) {
      throw new Error("[pr-issue] reviewers must be a string[] of non-empty objectIds");
    }
  }
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
      ...(reviewers !== undefined ? { reviewers } : {}),
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

/* ---------------------------------------------------------------- *
 * approvePrIssue（P3 — 多 reviewer 审批写入 + 聚合）
 * ---------------------------------------------------------------- */

/** approve 端点入参的 reviewer 决议动作（HTTP body 用，映射到 PrApprovalDecision）。 */
export type PrApproveAction = "approve" | "reject" | "request-changes";

const APPROVE_ACTION_TO_DECISION: Record<PrApproveAction, PrApprovalDecision> = {
  approve: "approved",
  reject: "rejected",
  "request-changes": "changes-requested",
};

export interface ApprovePrIssueInput {
  baseDir: string;
  issueId: number;
  /** 行使审批的 reviewer objectId；必须 ∈ record.reviewers。 */
  reviewerObjectId: string;
  /** 审批动作。 */
  action: PrApproveAction;
}

export type ApprovePrIssueResult =
  | { ok: true; issue: PrIssueRecord; verdict: PrApprovalVerdict }
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "INVALID_STATE"; message: string }
  | { ok: false; code: "NOT_A_REVIEWER"; message: string };

/**
 * P3：某 reviewer 对 PR 行使审批。校验 reviewerObjectId ∈ record.reviewers（非 reviewer
 * 拒 NOT_A_REVIEWER）；写入 approvals[reviewerObjectId]；返回聚合 verdict 供 caller
 * （service 层）按 P5 闸决定是否触发合入/拒绝。
 *
 * 串行化走 enqueueSessionWrite("super")（与 createPrIssue / closePrIssue 同队列），防并发
 * 写 approvals 丢失。已 closed 的 PR 拒 INVALID_STATE（不可再批）。
 */
export async function approvePrIssue(
  input: ApprovePrIssueInput,
): Promise<ApprovePrIssueResult> {
  const { baseDir, issueId, reviewerObjectId, action } = input;
  if (!reviewerObjectId || !reviewerObjectId.trim()) {
    return { ok: false, code: "NOT_A_REVIEWER", message: "reviewerObjectId required" };
  }
  return enqueueSessionWrite(PR_ISSUE_SESSION_ID, async () => {
    const issue = await readPrIssue(baseDir, issueId);
    if (!issue) {
      return { ok: false, code: "NOT_FOUND", message: `PR-Issue #${issueId} not found` } as const;
    }
    if (!issue.prPayload) {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: `Issue #${issueId} is not a PR-Issue (missing prPayload)`,
      } as const;
    }
    if (issue.status !== "open") {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: `PR-Issue #${issueId} already ${issue.status}`,
      } as const;
    }
    const reviewers = issue.reviewers ?? [];
    if (!reviewers.includes(reviewerObjectId)) {
      return {
        ok: false,
        code: "NOT_A_REVIEWER",
        message: `'${reviewerObjectId}' is not a reviewer of PR-Issue #${issueId} (reviewers=[${reviewers.join(", ")}])`,
      } as const;
    }
    const decision = APPROVE_ACTION_TO_DECISION[action];
    const updated: PrIssueRecord = {
      ...issue,
      approvals: { ...(issue.approvals ?? {}), [reviewerObjectId]: decision },
      lastUpdatedAt: Date.now(),
    };
    await writePrIssue(baseDir, updated);
    const index = await readPrIssueIndex(baseDir);
    await writePrIssueIndex(baseDir, {
      ...index,
      issues: index.issues.map((entry) =>
        entry.id === issueId ? { ...entry, lastUpdatedAt: updated.lastUpdatedAt } : entry,
      ),
    });
    return {
      ok: true,
      issue: updated,
      verdict: aggregatePrApproval(updated.reviewers, updated.approvals),
    } as const;
  });
}
