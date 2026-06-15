/**
 * pr —— reviewer 评审窗（reflectable 沉淀的 feat-branch PR）的 **object data**（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/title/status/createdAt）——那些由 runtime 管理。
 *
 * reflectable 沉淀（feat-branch PR 流程）：
 * super(foo) `create_pr_and_invite_reviewers` 开 PR 后，给每个 reviewer 的 super-session thread 投递一条
 * pr 对象；reviewer 在 thinkloop 里通过 pr 注册的 object method（approve / reject /
 * request_changes）亲手批，底层走 approvePrIssue 聚合 + prAutoMerge 闸。
 *
 * 设计要点（不发明新协议层，复用既有机制）：
 * - 渲染：readable 读 readPrIssue(issueId) 的 DetailView（intent/diff/paths/reviewers/
 *   approvals/verdict），与 list/get 端点同一份视图来源。
 * - 投递：deliverPrWindowToReviewers 把本 pr 对象 inline 进 reviewer thread 的 contextWindows
 *   + push inbox_message_arrived 让 LLM 看到。
 *
 * 字段最小：只持有 issueId（指向 flows/super/issues/issue-<id>.json）；diff/approvals 等
 * 全部 render 时从 PR record 读，对象自身不冗余存业务数据（避免双写漂移）。
 */
export interface Data {
  /** 指向的 PR-Issue id（flows/super/issues/issue-<id>.json）。 */
  issueId: number;
  /** 本对象投递给哪个 reviewer（= 所属 thread 的 objectId；审批署名用）。 */
  reviewerObjectId: string;
  /** 发起沉淀的 author（super(foo) 的 foo）；reject/request_changes 时 message 回投的目标。 */
  authorObjectId: string;
  /** author 发起沉淀时所在的业务 session（message 回投定位 super(foo) thread）。 */
  authorThreadId?: string;
}

/**
 * @deprecated 过渡别名 —— 旧 `PrWindow extends BaseContextWindow` 的兼容形状。
 *
 * core 的 `ContextWindow` discriminated union（`executable/windows/_shared/types.ts`）仍按 `class: "pr"`
 * 引本类型；前端 / core union 在 Wave 4 反推前继续编译需此交叉类型。新代码用 `Data`。
 * 信封字段（id/title/status/createdAt/parentWindowId）由 runtime 管理，此处标可选只为旧 union 兼容。
 */
export type PrWindow = Data & {
  class: "pr";
  id?: string;
  title?: string;
  status?: "open" | "closed";
  createdAt?: number;
  parentWindowId?: string;
  [key: string]: unknown;
};
