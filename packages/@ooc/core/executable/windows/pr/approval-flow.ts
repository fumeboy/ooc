/**
 * pr-approval-flow —— reviewer 行使审批后的统一聚合 + 合入闸 + 回修编排。
 *
 * 这是聚合（approvePrIssue）+ 合入闸（.world.json prAutoMerge）+ 回修
 * （routePrRepairMessage）的**单一编排点**，HTTP service（approve 端点）与 pr_window 的
 * approve/reject/request_changes method 都委托它，避免 gating 逻辑两处漂移。
 *
 * 编排：
 *   1. approvePrIssue 写 approvals + 聚合 verdict（校验 reviewer∈reviewers）。
 *   2. verdict=rejected      → resolvePrIssue(reject) archive+close → message 回 super(foo)。
 *   3. verdict=ready-to-merge → prAutoMerge=true 立即 resolvePrIssue(merge)；false 留 open 待人工。
 *   4. verdict=changes-requested → message 回 super(foo)（留 open 等回修）。
 *   5. 合入失败（resolvePrIssue git 错）→ message 回 super(foo)（合入失败也是回修触发）。
 *
 * 失败一律 fail-loud（返回结构化 code，不静默吞）。
 */

import {
  approvePrIssue,
  readPrIssue,
  readWorldConfig,
  resolvePrIssue,
  type PrApproveAction,
  type PrApprovalVerdict,
} from "../../../persistable/index.js";
import { routePrRepairMessage } from "./delivery.js";

export interface ApplyPrApprovalInput {
  baseDir: string;
  issueId: number;
  reviewerObjectId: string;
  action: PrApproveAction;
}

export type ApplyPrApprovalResult =
  | {
      ok: true;
      verdict: PrApprovalVerdict;
      /** ready-to-merge 时由 prAutoMerge 决定：true=已合入 / false=待人工确认。 */
      merged?: boolean;
      /** verdict=rejected 时：已 archive 分支。 */
      rejected?: boolean;
      commitSha?: string;
      archivedRef?: string;
      /** 是否已把回修 message 投回 super(foo)。 */
      repairRouted?: boolean;
    }
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "INVALID_STATE"; message: string }
  | { ok: false; code: "NOT_A_REVIEWER"; message: string }
  | { ok: false; code: "GIT"; message: string };

/** resolvePrIssue 失败结果 → 人读文本（GIT 错带 gitCode+stderr；其余带 message）。 */
function resolveErrorText(
  r: Extract<Awaited<ReturnType<typeof resolvePrIssue>>, { ok: false }>,
): string {
  return r.code === "GIT" ? `git ${r.gitCode}: ${r.stderr}` : r.message;
}

/**
 * 回修 message 的「可照抄动作块」。
 *
 * 体验官实证：LLM 收到泛化的「new_feat_branch(同 intent) 重绑」提示后不照走，
 * 反而即兴 curl 自查空转。这里把真实 intent 拼进可逐字复制的 exec(...) 调用，
 * 并显式禁止 curl/program 自查——把 LLM 钉死在 method 动作序列上。
 *
 * @param intent  PR 原始 intent（prPayload.intent）；用于让 LLM 照抄重绑同一 feat 分支。
 * @param editVerb  本轮要做的编辑动词（reject→"重新编辑"；request-changes→"按反馈修改"；合入失败→"解决冲突"）。
 */
function repairActionBlock(intent: string, editVerb: string): string {
  return (
    `\n\n照此动作序列 resume（逐字照抄，不要用 curl / program 自查）：\n` +
    `1. exec(method="new_feat_branch", args={ intent: ${JSON.stringify(intent)} }) ` +
    `—— 同 intent 幂等重绑该 feat 分支续修。\n` +
    `2. 用 write_file / file_window.edit ${editVerb}（改 stone 路径 stones/<self>/...）。\n` +
    `3. exec(method="evolve_self") —— 提交并重开/更新 PR 交 review。`
  );
}

/** 回投修复 message（best-effort；author thread 缺失只记 repairRouted=false，不翻 ok）。 */
async function routeRepair(
  baseDir: string,
  issueId: number,
  verdictText: string,
  editVerb: string,
): Promise<boolean> {
  const issue = await readPrIssue(baseDir, issueId);
  const authorThreadId = issue?.prPayload?.authorThreadId;
  if (!issue || !authorThreadId) return false;
  const intent = issue.prPayload?.intent ?? "";
  const r = await routePrRepairMessage({
    baseDir,
    authorObjectId: issue.createdByObjectId,
    authorThreadId,
    reason: verdictText + repairActionBlock(intent, editVerb),
  });
  return r.ok;
}

/**
 * 统一审批编排：approve → 聚合 → gate → (merge|reject) → 回修。
 */
export async function applyPrApproval(
  input: ApplyPrApprovalInput,
): Promise<ApplyPrApprovalResult> {
  const { baseDir, issueId, reviewerObjectId, action } = input;
  const a = await approvePrIssue({ baseDir, issueId, reviewerObjectId, action });
  if (!a.ok) {
    return { ok: false, code: a.code, message: a.message };
  }

  if (a.verdict === "rejected") {
    const r = await resolvePrIssue({ baseDir, issueId, decision: "reject" });
    if (!r.ok) {
      return { ok: false, code: "GIT", message: `resolvePrIssue(reject) failed: ${resolveErrorText(r)}` };
    }
    const repairRouted = await routeRepair(
      baseDir,
      issueId,
      `[PR #${issueId} 被 reject] reviewer '${reviewerObjectId}' 拒绝了本次沉淀（分支已 archive）。请审视反馈后修复。`,
      "重新编辑",
    );
    return {
      ok: true,
      verdict: a.verdict,
      rejected: true,
      ...(r.kind === "rejected" ? { archivedRef: r.archivedRef } : {}),
      repairRouted,
    };
  }

  if (a.verdict === "ready-to-merge") {
    const config = await readWorldConfig(baseDir);
    if (config.prAutoMerge) {
      const r = await resolvePrIssue({ baseDir, issueId, decision: "merge" });
      if (!r.ok) {
        // 合入失败也是回修触发：把 git 错误回投给 super(foo) 让其修。
        const errText = resolveErrorText(r);
        const repairRouted = await routeRepair(
          baseDir,
          issueId,
          `[PR #${issueId} 合入失败] ${errText}。`,
          "解决冲突",
        );
        return {
          ok: false,
          code: "GIT",
          message: `resolvePrIssue(merge) failed: ${errText}${repairRouted ? " (repair routed)" : ""}`,
        };
      }
      return {
        ok: true,
        verdict: a.verdict,
        merged: true,
        ...(r.kind === "merged" ? { commitSha: r.commitSha } : {}),
      };
    }
    // manual 闸：留 open 标 approved，等人工经 /resolve {merge} 落锤。
    return { ok: true, verdict: a.verdict, merged: false };
  }

  if (a.verdict === "changes-requested") {
    const repairRouted = await routeRepair(
      baseDir,
      issueId,
      `[PR #${issueId} 需修改] reviewer '${reviewerObjectId}' 对本次沉淀提了修改意见（PR 仍 open）。请审视反馈后修改。`,
      "按反馈修改",
    );
    return { ok: true, verdict: a.verdict, repairRouted };
  }

  // pending：仅记录 approval，等其余 reviewer。
  return { ok: true, verdict: a.verdict };
}
