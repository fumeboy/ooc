import { Elysia } from "elysia";
import type { RuntimeService } from "./service";

/**
 * 可观测：列出所有 PR-Issue（补体验官实证 404 的缺口）。
 *
 * GET /api/runtime/pr-issues → { items: PrIssueSummaryView[] }
 *
 * 每条带 reviewers/approvals/verdict 摘要，供前端 / harness 观测审批进度。
 * response schema 不强校验（approvals 是动态 record）。
 */
export function listPrIssuesApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.list-pr-issues" }).get(
    "/runtime/pr-issues",
    () => service.listPrIssues(),
  );
}
