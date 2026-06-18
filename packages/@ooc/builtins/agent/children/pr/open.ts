/**
 * commitAndOpenPr —— 开 PR（PR 下沉 P2b：从 core/persistable/stone-feat-branch 收编进 pr builtin）。
 *
 * = core 纯 git 部分 `commitFeatAndDiff`（commit feat worktree + diff vs main + 冒泡 reviewer + 组 PR 载荷）
 *   + 本层 `createPrIssue` 落账（PR-Issue 是 pr 评审 Object 的 lifecycle 数据，归 pr）。
 * createPrIssue 失败则解除 worktree（分支保留供排查），保 commit-但无-PR-record 不残留。
 *
 * 消费方：thread builtin 的 create_pr_and_invite_reviewers（沉淀 finalizer）+ 测试。
 */

import {
  commitFeatAndDiff,
  unregisterFeatWorktree,
  type CommitAndOpenPrInput,
} from "@ooc/core/persistable/index.js";
import { createPrIssue } from "./persistable/pr-issue.js";

export type { CommitAndOpenPrInput } from "@ooc/core/persistable/index.js";

export type CommitAndOpenPrResult =
  | { ok: true; issueId: number; branch: string; reviewers: string[]; paths: string[] }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "GIT"; message: string }
  | { ok: false; code: "NO_CHANGES"; message: string }
  | { ok: false; code: "ISSUE_SERVICE"; message: string };

export async function commitAndOpenPr(
  input: CommitAndOpenPrInput,
): Promise<CommitAndOpenPrResult> {
  const r = await commitFeatAndDiff(input);
  if (!r.ok) return r;
  try {
    const issue = await createPrIssue({
      baseDir: input.baseDir,
      title: r.title,
      description: input.description,
      createdByObjectId: input.authorObjectId,
      reviewers: r.reviewers,
      prPayload: r.prPayload,
    });
    return { ok: true, issueId: issue.id, branch: r.branch, reviewers: r.reviewers, paths: r.paths };
  } catch (e) {
    // PR 创建失败：feat 分支已 commit，但无 PR record 追踪 → 解除并清理 worktree（分支本身保留供排查）。
    await unregisterFeatWorktree(input.baseDir, r.branch);
    return { ok: false, code: "ISSUE_SERVICE", message: e instanceof Error ? e.message : String(e) };
  }
}
