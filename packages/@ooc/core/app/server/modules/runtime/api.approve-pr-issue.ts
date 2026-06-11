import { Elysia, t } from "elysia";
import type { RuntimeService } from "./service";

/**
 * 多 reviewer 审批端点。
 *
 * POST /api/runtime/pr-issues/:issueId/approve
 * Body: { reviewerObjectId: string, decision: "approve" | "reject" | "request-changes" }
 *
 * 校验 reviewerObjectId ∈ record.reviewers（service 层，非 reviewer → 409 CONFLICT）；
 * 写 approvals；按聚合 verdict + `.world.json` prAutoMerge 闸触发合入/拒绝。
 * 失败由 service 转 AppServerError（NOT_FOUND → 404 / INVALID_STATE·NOT_A_REVIEWER → 409 /
 * git·issue-service 失败 → 500）。
 */
const approveParams = t.Object({
  issueId: t.Numeric(),
});

const approveBody = t.Object({
  reviewerObjectId: t.String({ minLength: 1 }),
  decision: t.Union([
    t.Literal("approve"),
    t.Literal("reject"),
    t.Literal("request-changes"),
  ]),
});

export function approvePrIssueApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.approve-pr-issue" }).post(
    "/runtime/pr-issues/:issueId/approve",
    ({ params, body }) =>
      service.approvePrIssue({
        issueId: params.issueId,
        reviewerObjectId: body.reviewerObjectId,
        action: body.decision,
      }),
    { params: approveParams, body: approveBody },
  );
}
