import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * PR window —— reviewer 看到的「一条待审 feat-branch PR」展示单元（collaborable 家族）。
 *
 * reflectable 沉淀（feat-branch PR 流程）：
 * super(foo) `create_pr_and_invite_reviewers` 开 PR 后，给每个 reviewer 的 super-session thread 投递一条
 * pr_window；reviewer 在 thinkloop 里通过 pr_window 注册的 method（approve / reject /
 * request_changes）亲手批，底层走 approvePrIssue 聚合 + prAutoMerge 闸。
 *
 * 设计要点（不发明新协议层，复用既有机制）：
 * - 渲染：readable hook 读 getPrIssue(issueId) 的 DetailView（intent/diff/paths/reviewers/
 *   approvals/verdict），与 list/get 端点同一份视图来源。
 * - 知识激活：root knowledge `pr-review.md` 以 `activates_on: object::pr` 触发（既有
 *   activates_on 机制），thread 里出现 pr_window 即注入评审协议。
 * - 投递：deliverPrWindow 把本 window inline 进 reviewer thread 的 contextWindows
 *   （isBuiltinFeature，随 thread-context.json 落盘）+ push inbox_message_arrived 让 LLM 看到。
 *
 * 字段最小：只持有 issueId（指向 flows/super/issues/issue-<id>.json）；diff/approvals 等
 * 全部 render 时从 PR record 读，window 自身不冗余存业务数据（避免双写漂移）。
 */
export interface PrWindow extends BaseContextWindow {
  class: "pr";
  status: "open" | "closed";
  /** 指向的 PR-Issue id（flows/super/issues/issue-<id>.json）。 */
  issueId: number;
  /** 本 window 投递给哪个 reviewer（= 所属 thread 的 objectId；审批署名用）。 */
  reviewerObjectId: string;
  /** 发起沉淀的 author（super(foo) 的 foo）；reject/request_changes 时 message 回投的目标。 */
  authorObjectId: string;
  /** author 发起沉淀时所在的业务 session（message 回投定位 super(foo) thread）。 */
  authorThreadId?: string;
}
