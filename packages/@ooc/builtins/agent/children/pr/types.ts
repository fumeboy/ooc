/**
 * pr —— PR review window data。
 *
 * reflectable feat-branch 通道中，super(foo) 把变更打成 feat-branch + PR，runtime 把 PR 投递为
 * 每个 reviewer 的 pr window。reviewer agent 在自己的 thread 里看到 pr 窗，可评论/批准。
 */
export interface Comment {
  authorObjectId: string;
  body: string;
  at: number;
}

export interface Data {
  /** PR 的稳定 id。 */
  prId: string;
  /** feat-branch 名（git）。 */
  branch: string;
  /** PR 描述/intent。 */
  intent: string;
  /** 改动 diff（patch 文本，可大可小，渲染时截断）。 */
  diff: string;
  /** reviewer 评论。 */
  comments: Comment[];
  /** 当前状态。 */
  status: "open" | "approved" | "rejected" | "merged";
  createdAt: number;
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
