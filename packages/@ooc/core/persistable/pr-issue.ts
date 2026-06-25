/**
 * pr-issue —— PR-Issue 持久化存储底座（issue D 落地裁决 10）。
 *
 * 物理落点：`<baseDir>/stones/.stones_repo/.pr-issues/<id>.json`
 * （贴近 bare repo、不在 main worktree tracked tree 内、**不 git tracked**）。
 *
 * 与 builtin pr 的分层：
 * - 本模块（core/persistable）= 存储底座：createPrIssue / loadPrIssue / updatePrIssue /
 *   aggregatePrApproval（纯函数）。
 * - builtin pr / approval-flow.ts = finalizer 钩子：onReviewerAction / mergeFinalizer /
 *   rejectFinalizer / notifyAuthor。
 *
 * status 状态机（裁决段 11）：
 *   pending → (人 / aggregator) → { approved → ready-to-merge → (auto / manual confirm) → merged
 *                                    rejected → (notifyAuthor) → resume-author }
 *
 * 本 issue 实施保留底座最简；GC / 去重 / 超时回收 留 followup。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { STONES_BARE_REPO_DIR } from "./common.js";
import { toJson } from "./common.js";

/** PR-Issue 物理目录：`<baseDir>/stones/.stones_repo/.pr-issues/`。 */
export function prIssuesDir(baseDir: string): string {
  return join(baseDir, "stones", STONES_BARE_REPO_DIR, ".pr-issues");
}

/** 单个 PR-Issue 的文件路径。 */
export function prIssueFile(baseDir: string, prId: string): string {
  return join(prIssuesDir(baseDir), `${prId}.json`);
}

/** 一条 reviewer 操作记录。 */
export interface PrReview {
  reviewerId: string;
  action: "approve" | "reject" | "comment";
  text?: string;
  ts: number;
}

/** PR-Issue 状态机（裁决段 11）。 */
export type PrStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "ready-to-merge"
  | "merged";

/** 持久化的 PR-Issue 记录。 */
export interface PrRecord {
  id: string;
  featBranch: string;
  /** 发起 PR 的 thread id（用于 notifyAuthor 反馈通道）。 */
  authorThreadId: string;
  /** 发起 PR 的 author objectId（commit 署名 + reviewer 集排除项）。 */
  authorObjectId: string;
  /** OOC world 根。 */
  baseDir: string;
  /** PR title / intent。 */
  title: string;
  /** 变更影响路径（feat vs main diff names）。 */
  paths: string[];
  /** reviewer objectId 列表（含 supervisor 末位）。 */
  reviewers: string[];
  /** reviewer 操作流水（comment / approve / reject）。 */
  reviews: PrReview[];
  /** 当前状态。 */
  status: PrStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * 创建 PR-Issue 记录。
 *
 * 落地路径：`stones/.stones_repo/.pr-issues/<id>.json`。
 * id 由 caller 提供（一般取 featBranch 派生 slug + timestamp）。
 */
export async function createPrIssue(
  baseDir: string,
  record: Omit<PrRecord, "createdAt" | "updatedAt" | "reviews" | "status"> & {
    status?: PrStatus;
    reviews?: PrReview[];
  },
): Promise<string> {
  const now = Date.now();
  const full: PrRecord = {
    ...record,
    reviews: record.reviews ?? [],
    status: record.status ?? "pending",
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(prIssuesDir(baseDir), { recursive: true });
  await writeFile(prIssueFile(baseDir, record.id), toJson(full), "utf8");
  return record.id;
}

/** 读 PR-Issue 记录。不存在 → undefined。 */
export async function loadPrIssue(
  baseDir: string,
  prId: string,
): Promise<PrRecord | undefined> {
  try {
    const raw = await readFile(prIssueFile(baseDir, prId), "utf8");
    return JSON.parse(raw) as PrRecord;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** merge-update PR-Issue 记录。返回更新后的完整 record；不存在 → throw。 */
export async function updatePrIssue(
  baseDir: string,
  prId: string,
  patch: Partial<Omit<PrRecord, "id" | "createdAt">>,
): Promise<PrRecord> {
  const cur = await loadPrIssue(baseDir, prId);
  if (!cur) throw new Error(`[pr-issue] not found: ${prId}`);
  const next: PrRecord = {
    ...cur,
    ...patch,
    id: cur.id,
    createdAt: cur.createdAt,
    updatedAt: Date.now(),
  };
  await writeFile(prIssueFile(baseDir, prId), toJson(next), "utf8");
  return next;
}

/** 列举所有 PR-Issue id（按字典序）。debug / 控制面用。 */
export async function listPrIssueIds(baseDir: string): Promise<string[]> {
  try {
    const entries = await readdir(prIssuesDir(baseDir));
    return entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/**
 * 纯函数：根据 reviews 与 reviewers 集合算 PR 投票聚合结果。
 *
 * 规则（裁决段 11）：
 * - 任一 reviewer 提交 reject → rejected。
 * - 所有 reviewer 提交 approve（最近一条为准） → approved。
 * - 否则 → 列出 missing reviewer 集（尚未 approve 的 reviewer）。
 *
 * 同一 reviewer 多次操作：以**最近一条非 comment**（approve / reject）为准；
 * comment 不算决议。
 */
export function aggregatePrApproval(record: PrRecord): {
  approved: boolean;
  rejected: boolean;
  missing: string[];
} {
  /** 每个 reviewer 的最近一条 decision（approve / reject）。 */
  const decision = new Map<string, "approve" | "reject">();
  // 按 ts 排序后 last-write-wins
  const sorted = [...record.reviews].sort((a, b) => a.ts - b.ts);
  for (const r of sorted) {
    if (r.action === "approve" || r.action === "reject") {
      decision.set(r.reviewerId, r.action);
    }
  }
  const rejected = [...decision.values()].includes("reject");
  if (rejected) return { approved: false, rejected: true, missing: [] };
  const missing = record.reviewers.filter((id) => decision.get(id) !== "approve");
  const approved = missing.length === 0;
  return { approved, rejected: false, missing };
}
