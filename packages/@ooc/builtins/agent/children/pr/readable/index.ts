/**
 * pr —— readable 维度（把 PR-Issue 投影成 reviewer 评审 context window）。
 *
 * readable：读 readPrIssue(self.issueId) 的 DetailView（intent / paths / reviewers / approvals /
 * verdict / diff〔截断〕），与 list/get 端点同一份视图来源（不冗余存业务数据）。record 缺失
 * （已 archive 删除等）→ error 占位，不崩。
 *
 * window 声明：投影成 class "pr"，展示 object method approve / reject / request_changes；
 * pr 无 window method（投影态无 viewport 等可调维度——评审是 object 动作，不是展示档位）。
 *
 * 知识激活：root knowledge `pr-review.md`（activates_on: object::pr）在 thread 出现 pr 对象时注入评审协议。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  ReadableModule,
  WindowClassDecl,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { readPrIssue, aggregatePrApproval } from "../persistable/pr-issue.js";
import type { Data } from "../types.js";

const MAX_DIFF_RENDER_BYTES = 8192;

/** 投影 pr 对象：读 PR record → intent / paths / reviewers / approvals / verdict / diff（截断）。 */
async function renderPrWindow(ctx: ReadableContext, self: Data): Promise<XmlNode[]> {
  const children: XmlNode[] = [
    xmlElement("issue_id", {}, [xmlText(String(self.issueId))]),
    xmlElement("you_are_reviewer", {}, [xmlText(self.reviewerObjectId)]),
  ];
  const baseDir = ctx.persistence?.baseDir;
  if (!baseDir) {
    children.push(
      xmlElement("error", {}, [xmlText("readable ctx 无 persistence ref，无法读 PR record")]),
    );
    return children;
  }
  const issue = await readPrIssue(baseDir, self.issueId);
  if (!issue) {
    children.push(
      xmlElement("error", {}, [xmlText(`PR-Issue #${self.issueId} 不存在（可能已合入/归档）`)]),
    );
    return children;
  }
  const reviewers = issue.reviewers ?? [];
  const approvals = issue.approvals ?? {};
  const verdict = aggregatePrApproval(reviewers, approvals);

  children.push(
    xmlElement("status", {}, [xmlText(issue.status)]),
    xmlElement("verdict", {}, [xmlText(verdict)]),
    xmlElement("author", {}, [xmlText(issue.createdByObjectId)]),
  );
  if (issue.prPayload?.intent) {
    children.push(xmlElement("intent", {}, [xmlText(issue.prPayload.intent)]));
  }
  if (issue.prPayload?.branch) {
    children.push(xmlElement("branch", {}, [xmlText(issue.prPayload.branch)]));
  }
  const paths = issue.prPayload?.paths ?? [];
  children.push(
    xmlElement(
      "paths",
      { count: String(paths.length) },
      paths.map((p) => xmlElement("path", {}, [xmlText(p)])),
    ),
  );
  children.push(
    xmlElement(
      "reviewers",
      {},
      reviewers.map((r) =>
        xmlElement("reviewer", { decision: approvals[r] ?? "pending" }, [xmlText(r)]),
      ),
    ),
  );
  if (issue.prPayload?.diff) {
    children.push(
      xmlElement("diff", {}, [xmlText(truncateBytes(issue.prPayload.diff, MAX_DIFF_RENDER_BYTES))]),
    );
  }
  return children;
}

const prWindowClass: WindowClassDecl<Data, undefined> = {
  class: "pr",
  object_methods: ["approve", "reject", "request_changes"],
  window_methods: [],
};

const readable: ReadableModule<Data, undefined> = {
  readable: async (ctx: ReadableContext, self: Data) => ({
    class: "pr",
    content: await renderPrWindow(ctx, self),
  }),
  window: [prWindowClass],
};

export default readable;
