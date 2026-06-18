/**
 * PR-Issue resolve 编排 —— supervisor 决议生效（merge / reject / request-changes）。
 *
 * PR 下沉 P2：从 `core/persistable/stone-versioning` 收编进 pr builtin。pr 是评审 Object，
 * 「读 PR-Issue + 调 git 合入原语 + close 账本」是它的 lifecycle 逻辑；core 只留**纯 git 原语**
 * （`mergeFeatBranch` / `archiveFeatBranch`，无 pr-issue 依赖）+ 串行化 key（`gitQueueKey`）。
 *
 * 串行化：复用 core 的 `gitQueueKey(baseDir)`（= `git:<baseDir>`）+ 进程级 `enqueueSessionWrite`
 * 单例队列，与 stone-versioning 其它 git 写**同 key 同队列**串行，不会与合入/回收竞争。
 *
 * 消费方：本 builtin 的 `approval-flow.applyPrApproval`（reviewer 批后自动合入）+ core 控制面
 * `service.resolvePrIssue`（HTTP /resolve，supervisor 人工落锤）。
 */

import { enqueueSessionWrite } from "@ooc/core/runtime/serial-queue.js";
import {
  gitQueueKey,
  mergeFeatBranch,
  archiveFeatBranch,
} from "@ooc/core/persistable/stone-versioning.js";
import { readPrIssue, closePrIssue, type PrIssueRecord } from "./persistable/pr-issue.js";
import type { GitErrorCode } from "@ooc/core/persistable/index.js";

export type PrIssueDecision = "merge" | "reject" | "request-changes";

export interface ResolvePrIssueInput {
  baseDir: string;
  issueId: number;
  decision: PrIssueDecision;
}

export type ResolvePrIssueResult =
  | { ok: true; kind: "merged"; commitSha: string }
  | { ok: true; kind: "rejected"; archivedRef: string }
  | { ok: true; kind: "changes-requested" }
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "INVALID_STATE"; message: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string }
  | { ok: false; code: "ISSUE_SERVICE"; message: string };

/**
 * Supervisor 决议生效：
 * - merge → 在 main 上 ff-merge worktree branch（mergeFeatBranch）；成功后关闭 Issue
 * - reject → archive branch 到 `refs/ooc/rejected/<branch>`（archiveFeatBranch）+ 回收 worktree；关闭 Issue
 * - request-changes → 不动 worktree，不关闭 Issue（caller 在 issue 上加 comment 通知 Object 重做）
 */
export async function resolvePrIssue(input: ResolvePrIssueInput): Promise<ResolvePrIssueResult> {
  return enqueueSessionWrite(gitQueueKey(input.baseDir), async () => {
    // 取出 PR-Issue
    let issue: PrIssueRecord | undefined;
    try {
      issue = await readPrIssue(input.baseDir, input.issueId);
    } catch (e) {
      return {
        ok: false,
        code: "ISSUE_SERVICE",
        message: e instanceof Error ? e.message : String(e),
      } as const;
    }
    if (!issue) {
      return { ok: false, code: "NOT_FOUND", message: `PR-Issue #${input.issueId} not found` } as const;
    }
    if (!issue.prPayload) {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: `Issue #${input.issueId} is not a PR-Issue (missing prPayload)`,
      } as const;
    }
    if (issue.status !== "open") {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: `PR-Issue #${input.issueId} already ${issue.status}`,
      } as const;
    }

    const branch = issue.prPayload.branch;

    if (input.decision === "request-changes") {
      // 仅记录决议；caller 应另行 appendComment 通知发起 Object
      return { ok: true, kind: "changes-requested" } as const;
    }

    if (input.decision === "merge") {
      const m = await mergeFeatBranch(input.baseDir, branch, issue.prPayload.paths, "resolvePrIssue(merge)");
      if (!m.ok) return m;
      try {
        await closePrIssue({ baseDir: input.baseDir, issueId: input.issueId });
      } catch (e) {
        return {
          ok: false,
          code: "ISSUE_SERVICE",
          message: e instanceof Error ? e.message : String(e),
        } as const;
      }
      return { ok: true, kind: "merged", commitSha: m.commitSha } as const;
    }

    // reject
    const a = await archiveFeatBranch(input.baseDir, branch, "resolvePrIssue(reject)");
    if (!a.ok) return a;
    try {
      await closePrIssue({ baseDir: input.baseDir, issueId: input.issueId });
    } catch (e) {
      return {
        ok: false,
        code: "ISSUE_SERVICE",
        message: e instanceof Error ? e.message : String(e),
      } as const;
    }
    return { ok: true, kind: "rejected", archivedRef: a.archivedRef } as const;
  });
}
