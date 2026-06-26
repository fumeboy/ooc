/**
 * feat-branch-pr —— 把 feat-branch worktree 开分支 + commit + diff + reviewer 集 + PR-Issue
 * 落账聚合成单个 helper（issue D 落地裁决 10）。
 *
 * 上游消费者：thread/executable 的 `create_pr_for_versioned` / `create_pr_for_class_edits`
 * 4-method 一步到位 method。
 *
 * 实现复用既有原语：
 * - createFeatBranchWorktree（stone-feat-branch）：派生 feat worktree
 * - paths 写入 → caller 提前在 feat worktree 编辑（本 helper 只负责 commit 后）
 * - commitFeatAndDiff（stone-feat-branch）：commit + 算 reviewer + 组 PR payload
 * - createPrIssue（pr-issue）：落账
 *
 * 一次性串行链路：开分支 → caller 写文件 → 本 helper commit + 落账。
 *
 * **注意**：本 helper 假设 feat 分支已被 caller 用文件编辑、commit 前的 dirty 状态；
 * caller 流：createFeatBranchWorktree → 在 worktreePath 内 writeFile → 调本 helper。
 */

import { join } from "node:path";
import {
  commitFeatAndDiff,
  createFeatBranchWorktree,
  featBranchName,
  featWorktreePath,
  slugFromIntent,
} from "./stone-feat-branch.js";
import { createPrIssue, type PrRecord } from "./pr-issue.js";

/** 新建 feat-branch PR 的输入。 */
export interface CreateFeatBranchPrInput {
  baseDir: string;
  /** PR title / commit message / slug 派生源。 */
  intent: string;
  /** 显式 slug；缺省由 intent 派生。 */
  slug?: string;
  /** 发起 PR 的 author objectId（commit 署名 + reviewer 集排除项）。 */
  authorObjectId: string;
  /** 发起 PR 的 thread id（notifyAuthor 反馈通道）。 */
  authorThreadId: string;
  /**
   * 写文件回调：本 helper 先建 feat worktree，再回调 caller 在 worktree 内写文件，
   * 然后 commit + 算 reviewer + 落账。
   *
   * 回调收到 `worktreePath`（feat 分支的物理 path）和 `featBranch`（分支名）；
   * caller 用 path.join 拼路径直接 writeFile / mkdir 即可。
   */
  writeFiles: (input: { worktreePath: string; featBranch: string }) => Promise<void>;
}

/** 新建 feat-branch PR 的输出。 */
export type CreateFeatBranchPrResult =
  | { ok: true; prId: string; featBranch: string; reviewers: string[]; paths: string[] }
  | { ok: false; code: "INVALID_INPUT" | "GIT" | "NO_CHANGES"; message: string };

/**
 * 一步到位起 feat-branch PR：
 *   1. createFeatBranchWorktree（派生分支）
 *   2. caller writeFiles 回调
 *   3. commitFeatAndDiff（commit + diff + reviewer + PR payload）
 *   4. createPrIssue（落账）
 *
 * 失败一律返回 `{ ok: false, ... }`，caller 决定是否清理。
 */
export async function createFeatBranchPr(
  input: CreateFeatBranchPrInput,
): Promise<CreateFeatBranchPrResult> {
  if (!input.intent?.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "intent required" };
  }
  if (!input.authorObjectId?.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "authorObjectId required" };
  }
  if (!input.authorThreadId?.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "authorThreadId required" };
  }

  // 1. 派生 feat 分支 worktree
  const slug = (input.slug && input.slug.trim()) || slugFromIntent(input.intent);
  const branchHint = featBranchName(slug);
  const wt = await createFeatBranchWorktree({
    baseDir: input.baseDir,
    intent: input.intent,
    slug,
  });
  if (!wt.ok) {
    return { ok: false, code: "GIT", message: wt.message ?? "createFeatBranchWorktree failed" };
  }

  // 2. caller 写文件
  try {
    await input.writeFiles({ worktreePath: wt.worktreePath, featBranch: wt.branch });
  } catch (e) {
    return { ok: false, code: "INVALID_INPUT", message: `writeFiles failed: ${(e as Error).message}` };
  }

  // 3. commit + diff + reviewer + PR payload
  const commit = await commitFeatAndDiff({
    baseDir: input.baseDir,
    branch: wt.branch,
    authorObjectId: input.authorObjectId,
    intent: input.intent,
    authorThreadId: input.authorThreadId,
  });
  if (!commit.ok) {
    return { ok: false, code: commit.code, message: commit.message };
  }

  // 4. 落账 PR-Issue
  const prId = `${wt.branch.replaceAll("/", "_")}_${Date.now().toString(36)}`;
  const record: Omit<PrRecord, "createdAt" | "updatedAt" | "reviews" | "status"> = {
    id: prId,
    featBranch: wt.branch,
    authorThreadId: input.authorThreadId,
    authorObjectId: input.authorObjectId,
    baseDir: input.baseDir,
    title: commit.title,
    paths: commit.paths,
    reviewers: commit.reviewers,
  };
  await createPrIssue(input.baseDir, record);

  return {
    ok: true,
    prId,
    featBranch: wt.branch,
    reviewers: commit.reviewers,
    paths: commit.paths,
  };
}

/** feat worktree 物理路径（re-export 便于 caller 使用）。 */
export { featWorktreePath } from "./stone-feat-branch.js";
