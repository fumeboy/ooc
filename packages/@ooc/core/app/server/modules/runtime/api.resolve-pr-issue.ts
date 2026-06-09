import { Elysia, t } from "elysia";
import type { RuntimeService } from "./service";

/**
 * Governance：标 PR-Issue 决议（去固化 metaprog method 后，2026-06-09）。
 *
 * POST /api/runtime/pr-issues/:issueId/resolve
 * Body: { decision: "merge" | "reject" | "request-changes" }
 *
 * 控制面 = supervisor 治理身份；底层走 persistable resolvePrIssue（保留不动）。
 * 失败由 service 转 AppServerError（NOT_FOUND → 404 / INVALID_STATE → 409 /
 * git·issue-service 失败 → 500）。
 */
const resolveParams = t.Object({
  issueId: t.Numeric(),
});

const resolveBody = t.Object({
  decision: t.Union([
    t.Literal("merge"),
    t.Literal("reject"),
    t.Literal("request-changes"),
  ]),
});

export function resolvePrIssueApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.resolve-pr-issue" }).post(
    "/runtime/pr-issues/:issueId/resolve",
    ({ params, body }) =>
      service.resolvePrIssue({
        issueId: params.issueId,
        decision: body.decision,
      }),
    { params: resolveParams, body: resolveBody },
  );
}
