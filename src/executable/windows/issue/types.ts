import type { BaseContextWindow } from "../_shared/types.js";

/**
 * Issue window — 把 session 级 Issue(`flows/{sid}/issues/issue-{id}.json`)挂进
 * thread 作为可订阅资源。Issue 协作模型见 origin §3 与 plan U1-U9。
 *
 * 设计要点(plan §4 决策 7 / 10 / 11):
 * - **不引入 status 字段**:close 即移除 window(WindowManager.close 默认语义)。
 *   Issue 自身 status(open/closed)通过每轮 deriveIssueWindowKnowledge 渲染给
 *   LLM,window 本身只表示 "本 thread 是否订阅该 Issue"
 * - `lastSeenCommentId` / `lastNotifiedAt` 是 **in-process 内存语义**,
 *   writeThread 时会被 strip(防止重启后游标过期 / Issue 文件回滚导致 hang);
 *   worker 重启后首次 sync 视为 undefined → 初值=当前最新 commentId
 */
export interface IssueWindow extends BaseContextWindow {
  type: "issue";
  /** 所属 session 内的 Issue id(全局唯一)。 */
  issueId: number;
  /**
   * 已读评论游标 — 仅供 worker syncIssueWindowComments 判定 newComments;
   * **不持久化**(stripVolatileForPersist 删除该字段)。
   * undefined 表示 "刚 open 或刚重启,下次 sync 视为已读全部"。
   */
  lastSeenCommentId?: number;
  /**
   * 上次写 inbox 通知的时间戳 — 用于 10s 限频(plan §4 决策 7);
   * **不持久化**。wait-all 路径绕过限频(plan A1 修正)。
   */
  lastNotifiedAt?: number;
}
