import { Elysia, t } from "elysia";
import type { RuntimeService } from "./service";

/**
 * 可观测：单条 PR-Issue 全量（intent/diff/paths/branch/reviewers/approvals/status/verdict）。
 *
 * GET /api/runtime/pr-issues/:issueId → PrIssueDetailView
 *
 * 未知 issue → service 抛 AppServerError NOT_FOUND → 404。
 * response schema 不强校验（approvals 是动态 record）。
 */
const getParams = t.Object({
  issueId: t.Numeric(),
});

export function getPrIssueApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.get-pr-issue" }).get(
    "/runtime/pr-issues/:issueId",
    ({ params }) => service.getPrIssue(params.issueId),
    { params: getParams },
  );
}
