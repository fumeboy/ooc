/**
 * pr_window —— reviewer 看到的「一条待审 feat-branch PR」（collaborable window 家族）。
 *
 * reflectable 沉淀 P4（spec 2026-06-11 §3）：
 * - 注册的 method（executable 维度）：approve / reject / request_changes —— reviewer 在
 *   thinkloop 里亲手批，底层走 applyPrApproval（P3 聚合 + P5 prAutoMerge 闸 + P6 回修）。
 * - readable：渲染 getPrIssue(issueId) 的 DetailView（intent / diff / paths / reviewers /
 *   approvals / verdict），与 list/get 端点同一份视图来源（不冗余存业务数据）。
 * - 知识激活：root knowledge `pr-review.md`（activates_on: object::pr）在 thread 出现
 *   pr_window 时注入评审协议（既有 activates_on 机制）。
 *
 * supervisor 恒在 reviewer 集，故其评审入口（pr_window method + HTTP approve 端点）天然可用。
 */

import { builtinRegistry, type OnCloseContext, type RenderContext } from "../_shared/registry.js";
import type { ObjectMethod } from "../_shared/method-types.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { readPrIssue, aggregatePrApproval } from "../../../persistable/index.js";
import { applyPrApproval } from "./approval-flow.js";
import type { PrWindow } from "./types.js";
import type { PrApproveAction } from "../../../persistable/index.js";

const MAX_DIFF_RENDER_BYTES = 8192;

/**
 * pr_window 的 readable hook：读 PR record → 渲染 intent / paths / reviewers / approvals /
 * verdict / diff（截断）。record 缺失（已 archive 删除等）→ error 占位，不崩。
 */
async function renderPrWindow(ctx: RenderContext): Promise<XmlNode[]> {
  const window = ctx.window as PrWindow;
  const children: XmlNode[] = [
    xmlElement("issue_id", {}, [xmlText(String(window.issueId))]),
    xmlElement("you_are_reviewer", {}, [xmlText(window.reviewerObjectId)]),
  ];
  if (!ctx.thread.persistence) {
    children.push(xmlElement("error", {}, [xmlText("thread 无 persistence ref，无法读 PR record")]));
    return children;
  }
  const issue = await readPrIssue(ctx.thread.persistence.baseDir, window.issueId);
  if (!issue) {
    children.push(
      xmlElement("error", {}, [xmlText(`PR-Issue #${window.issueId} 不存在（可能已合入/归档）`)]),
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

/** pr_window 是合成投递的协作窗口，reviewer 不可显式 close（合入/归档后系统回收）。 */
function onClosePrWindow(ctx: OnCloseContext): boolean | void {
  if (ctx.window.class !== "pr") return;
  ctx.thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[close 拒绝] pr_window "${ctx.window.id}" 是系统投递的待审 PR，请用 approve / reject / request_changes 行使评审，而非 close。`,
    source: "executable/windows/pr#onClosePrWindow",
    errorCode: "pr_window_close_rejected",
  });
  return false;
}

/** 把 applyPrApproval 结果规整为 LLM-facing 文本（method 返回）。 */
function describeOutcome(action: PrApproveAction, issueId: number, r: Awaited<ReturnType<typeof applyPrApproval>>): string {
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

/** 公共 exec：读 pr_window → applyPrApproval(action)。 */
async function execReview(
  ctx: { thread?: { persistence?: { baseDir: string } }; self?: unknown },
  action: PrApproveAction,
): Promise<string> {
  const window = ctx.self as PrWindow | undefined;
  if (!window || window.class !== "pr") {
    return `[pr_window.${action}] 缺少 pr_window self context。`;
  }
  const baseDir = ctx.thread?.persistence?.baseDir;
  if (!baseDir) {
    return `[pr_window.${action}] thread 无 persistence ref。`;
  }
  const r = await applyPrApproval({
    baseDir,
    issueId: window.issueId,
    reviewerObjectId: window.reviewerObjectId,
    action,
  });
  return describeOutcome(action, window.issueId, r);
}

const approveMethod: ObjectMethod = {
  description: "As this PR's reviewer, approve the diff (counts toward merge when all reviewers approve).",
  intents: ["approve"],
  exec: (ctx) => execReview(ctx, "approve"),
};

const rejectMethod: ObjectMethod = {
  description: "As this PR's reviewer, reject the diff (one reject vetoes the PR; author gets a repair message).",
  intents: ["reject"],
  exec: (ctx) => execReview(ctx, "reject"),
};

const requestChangesMethod: ObjectMethod = {
  description: "As this PR's reviewer, request changes (PR stays open; author gets a repair message to revise).",
  intents: ["request_changes"],
  exec: (ctx) => execReview(ctx, "request-changes"),
};

builtinRegistry.registerExecutable("pr", {
  methods: {
    approve: approveMethod,
    reject: rejectMethod,
    request_changes: requestChangesMethod,
  },
  // pr_window 是系统投递的协作窗口 —— inline 进所属 thread 的 thread-context.json，不写独立 dir。
  isBuiltinFeature: true,
});
builtinRegistry.registerReadable("pr", {
  onClose: onClosePrWindow,
  readable: renderPrWindow,
});
