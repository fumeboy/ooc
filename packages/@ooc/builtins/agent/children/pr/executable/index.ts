/**
 * pr —— executable 维度（reviewer 评审 object method）。
 *
 * reflectable 沉淀：注册的 object method approve / reject / request_changes —— reviewer 在
 * thinkloop 里亲手批，底层走 applyPrApproval（聚合 + prAutoMerge 闸 + 回修）。
 *
 * object method 签名 `(ctx, self, args)`：self = pr 的 Data（issueId/reviewerObjectId/…），
 * ctx 携 thread（取 persistence baseDir）。与 readable 维度（投影，在 ../readable/index.ts）物理分离。
 *
 * supervisor 恒在 reviewer 集，故其评审入口（pr object method + HTTP approve 端点）天然可用。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { PrApproveAction } from "@ooc/core/persistable/index.js";
import { applyPrApproval } from "../approval-flow.js";
import type { Data } from "../types.js";

/** 把 applyPrApproval 结果规整为 LLM-facing 文本（method 返回）。 */
function describeOutcome(
  action: PrApproveAction,
  issueId: number,
  r: Awaited<ReturnType<typeof applyPrApproval>>,
): string {
  if (!r.ok) {
    return JSON.stringify({ ok: false, action, issueId, code: r.code, error: r.message });
  }
  return JSON.stringify({
    ok: true,
    action,
    issueId,
    verdict: r.verdict,
    ...(r.merged !== undefined ? { merged: r.merged } : {}),
    ...(r.rejected !== undefined ? { rejected: r.rejected } : {}),
    ...(r.repairRouted !== undefined ? { repair_routed: r.repairRouted } : {}),
    ...(r.commitSha ? { commit_sha: r.commitSha } : {}),
    note:
      r.verdict === "ready-to-merge" && r.merged
        ? "全 reviewer approve，已合入 main。"
        : r.verdict === "ready-to-merge"
          ? "全 reviewer approve；prAutoMerge=false，等人工经 /resolve {merge} 落锤。"
          : r.verdict === "rejected"
            ? "已 reject；author 收到回修 message。"
            : r.verdict === "changes-requested"
              ? "已要求修改；author 收到回修 message。"
              : "approval 已记录，等其余 reviewer。",
  });
}

/** 公共 exec：读 pr Data → applyPrApproval(action)。 */
async function execReview(
  ctx: ExecutableContext,
  self: Data,
  action: PrApproveAction,
): Promise<string> {
  const baseDir = ctx.thread?.persistence?.baseDir;
  if (!baseDir) {
    return `[pr.${action}] thread 无 persistence ref。`;
  }
  const r = await applyPrApproval({
    baseDir,
    issueId: self.issueId,
    reviewerObjectId: self.reviewerObjectId,
    action,
  });
  return describeOutcome(action, self.issueId, r);
}

const approveMethod: ObjectMethod<Data> = {
  name: "approve",
  description:
    "As this PR's reviewer, approve the diff (counts toward merge when all reviewers approve).",
  exec: (ctx, self) => execReview(ctx, self, "approve"),
};

const rejectMethod: ObjectMethod<Data> = {
  name: "reject",
  description:
    "As this PR's reviewer, reject the diff (one reject vetoes the PR; author gets a repair message).",
  exec: (ctx, self) => execReview(ctx, self, "reject"),
};

const requestChangesMethod: ObjectMethod<Data> = {
  name: "request_changes",
  description:
    "As this PR's reviewer, request changes (PR stays open; author gets a repair message to revise).",
  exec: (ctx, self) => execReview(ctx, self, "request-changes"),
};

const executable: ExecutableModule<Data> = {
  methods: [approveMethod, rejectMethod, requestChangesMethod],
};

export default executable;
