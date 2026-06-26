/**
 * pr/approval-flow —— PR-Issue finalizer 钩子（issue D 落地裁决 10）。
 *
 * pr builtin 的 approve / reject / comment method 内部触发 `onReviewerAction`：
 *   - 把 reviewer 操作 append 到 PR-Issue 的 reviews
 *   - 调 `aggregatePrApproval` 算出 approved / rejected / missing
 *   - approved → 按 worldConfig.prAutoMerge 决定 mergeFinalizer 或 ready-to-merge
 *   - rejected → rejectFinalizer + notifyAuthor
 *
 * 状态机草图（裁决段 11）：
 *   pending → { approved → ready-to-merge → (auto / manual via POST /pr-issues/:id/resolve) → merged
 *               rejected → (notifyAuthor) → resume-author }
 *
 * worldConfig.prAutoMerge 缺省 false（更安全：默认要求人工确认）。
 */

import {
  loadPrIssue,
  updatePrIssue,
  aggregatePrApproval,
  type PrRecord,
  type PrReview,
  type PrStatus,
} from "@ooc/core/persistable/pr-issue.js";
import { mergeFeatBranch } from "@ooc/core/persistable/stone-versioning.js";
import { readWorldConfig } from "@ooc/core/persistable/world-config.js";
import { objectDir, toJson } from "@ooc/core/persistable/common.js";
import { SUPER_SESSION_ID } from "@ooc/core/types/constants.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 给 PR author 在 super flow 的 author thread 内 append 一条 system message
 * （用 `from: "callee"` 表达 super flow 给 caller 的反馈）。
 *
 * authorThreadId 来自 PrRecord.authorThreadId（super 投影所在 thread id）。
 * 物理：写 `flows/super/objects/<authorObjectId>/threads/<authorThreadId>/thread.json`。
 */
async function notifyAuthor(record: PrRecord, content: string): Promise<void> {
  const dir = join(
    objectDir({
      baseDir: record.baseDir,
      sessionId: SUPER_SESSION_ID,
      objectId: record.authorObjectId,
    }),
    "threads",
    record.authorThreadId,
  );
  const file = join(dir, "thread.json");
  try {
    const raw = await readFile(file, "utf8");
    const thread = JSON.parse(raw) as {
      messages: Array<{ id: string; content: string; createdAt: number; from: "caller" | "callee" }>;
    };
    thread.messages.push({
      id: `msg_${Date.now().toString(36)}_pr_${record.id.slice(0, 6)}`,
      content,
      createdAt: Date.now(),
      from: "callee",
    });
    await mkdir(dir, { recursive: true });
    await writeFile(file, toJson(thread), "utf8");
  } catch {
    // best-effort——thread.json 不存在 / 不可读 → 静默（PR 状态已落账，author 经磁盘自查可知）
  }
}

/**
 * 合入 finalizer：调 mergeFeatBranch（ff-merge）+ updatePrIssue status=merged + notifyAuthor。
 */
async function mergeFinalizer(record: PrRecord): Promise<{ ok: boolean; error?: string }> {
  const result = await mergeFeatBranch(record.baseDir, record.featBranch, record.paths, `pr:${record.id}`);
  if (!result.ok) {
    await updatePrIssue(record.baseDir, record.id, { status: "rejected" } as { status: PrStatus });
    await notifyAuthor(
      record,
      `[pr:${record.id}] merge failed (gitCode=${result.gitCode}); status → rejected\n${result.stderr}`,
    );
    return { ok: false, error: result.stderr };
  }
  await updatePrIssue(record.baseDir, record.id, { status: "merged" } as { status: PrStatus });
  await notifyAuthor(
    record,
    `[pr:${record.id}] merged into stones/main at ${result.commitSha}\n  paths: ${record.paths.join(", ")}`,
  );
  return { ok: true };
}

/** reject finalizer：updatePrIssue status=rejected + notifyAuthor。 */
async function rejectFinalizer(record: PrRecord): Promise<void> {
  await updatePrIssue(record.baseDir, record.id, { status: "rejected" } as { status: PrStatus });
  await notifyAuthor(
    record,
    `[pr:${record.id}] rejected\n  reviewers: ${record.reviewers.join(", ")}\n  consider resume + revise.`,
  );
}

/** reviewer action 入口（pr builtin approve/reject/comment 调用本钩）。 */
export async function onReviewerAction(
  baseDir: string,
  prId: string,
  reviewerId: string,
  action: "approve" | "reject" | "comment",
  text?: string,
): Promise<void> {
  const cur = await loadPrIssue(baseDir, prId);
  if (!cur) throw new Error(`[onReviewerAction] PR not found: ${prId}`);
  // 终态不再接收 reviewer 操作（裁决段 11 没显式说，但语义上 merged/rejected 是 terminal）。
  if (cur.status === "merged" || cur.status === "rejected") {
    return;
  }
  const review: PrReview = {
    reviewerId,
    action,
    text,
    ts: Date.now(),
  };
  const next = await updatePrIssue(baseDir, prId, {
    reviews: [...cur.reviews, review],
  });

  // comment 不算决议——只追加流水即可
  if (action === "comment") return;

  // 聚合投票
  const agg = aggregatePrApproval(next);
  if (agg.rejected) {
    await rejectFinalizer(next);
    return;
  }
  if (agg.approved) {
    // 读 worldConfig.prAutoMerge 决定 auto / manual
    const cfg = await readWorldConfig(baseDir);
    if (cfg.prAutoMerge) {
      await updatePrIssue(baseDir, prId, { status: "approved" } as { status: PrStatus });
      await mergeFinalizer(next);
    } else {
      await updatePrIssue(baseDir, prId, { status: "ready-to-merge" } as { status: PrStatus });
      await notifyAuthor(
        next,
        `[pr:${prId}] approved by all reviewers; awaiting human merge ` +
          `(POST /api/runtime/pr-issues/${prId}/resolve {decision:"merge"}).`,
      );
    }
  }
  // 否则 missing 非空——保持 pending；不发通知
}

/**
 * HTTP `POST /api/runtime/pr-issues/:id/resolve` 入口（裁决 9）。
 * decision="merge" → 调 mergeFinalizer（用 internal symbol 跳闸）。
 * decision="reject" → rejectFinalizer。
 */
export async function resolvePrIssueByHuman(
  baseDir: string,
  prId: string,
  decision: "merge" | "reject",
  reviewerId: string,
  comment?: string,
): Promise<{ ok: boolean; error?: string }> {
  const cur = await loadPrIssue(baseDir, prId);
  if (!cur) return { ok: false, error: `PR not found: ${prId}` };
  if (cur.status === "merged" || cur.status === "rejected") {
    return { ok: false, error: `PR already terminal: ${cur.status}` };
  }
  // 落 reviewer 操作流水
  await updatePrIssue(baseDir, prId, {
    reviews: [
      ...cur.reviews,
      {
        reviewerId,
        action: decision === "merge" ? "approve" : "reject",
        text: comment,
        ts: Date.now(),
      },
    ],
  });
  const updated = await loadPrIssue(baseDir, prId);
  if (!updated) return { ok: false, error: "PR vanished mid-resolve" };
  if (decision === "merge") {
    await updatePrIssue(baseDir, prId, { status: "approved" } as { status: PrStatus });
    return await mergeFinalizer(updated);
  } else {
    await rejectFinalizer(updated);
    return { ok: true };
  }
}
