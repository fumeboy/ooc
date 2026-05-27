/**
 * HTTP stone-write versioning helper —— 根因 #2（HTTP-git 语义统一）。
 *
 * 让 HTTP service.ts 的写 stone 操作复用 LLM 命令同样的 stone-versioning 流程：
 *   open metaprog worktree → exec write callback in worktree → commit → tryMergeSelf
 *
 * 2026-05-28：核心三步编排已上移到 persistable 的 `versionedStoneWrite`（单一 owner，
 * 同时被 LLM write_file 命令复用）。本文件保留为薄适配层——仅做命名对齐
 * （HttpWrite* ↔ VersionedWrite*），不再复制编排逻辑。
 */
import { versionedStoneWrite } from "@src/persistable";

/** wrapHttpWriteInWorktree 的成功返回。 */
export interface HttpWriteOk {
  ok: true;
  /** worktree merge 后 main 上的 commit sha（self-scope）；cross-scope 时退回 commit 的 sha。 */
  commitSha: string;
  /** true = 已 ff merge 到 main；false = 已落 PR-Issue 等 Supervisor 决议。 */
  merged: boolean;
  /** cross-scope 时新建的 PR-Issue id。 */
  prIssueId?: number;
}

/** wrapHttpWriteInWorktree 的失败返回（不抛错——caller 转 AppServerError）。 */
export interface HttpWriteErr {
  ok: false;
  /** 与 stone-versioning 的 GitErrorCode/INVALID_INPUT/ISSUE_SERVICE 对齐。 */
  code: string;
  message: string;
}

/** write callback 拿到的 worktree 上下文：caller 在 baseDir 下用 stonesBranch=branch 调 persistable.write*。 */
export interface WriteContext {
  /** worktree 在磁盘上的绝对路径（仅 informational；caller 一般用 baseDir + stonesBranch）。 */
  path: string;
  /** worktree 仍属于的 OOC world 根（与外层 baseDir 一致）。 */
  baseDir: string;
  /** worktree 对应的 git branch；写 stone 时把 stoneRef.stonesBranch 改为这个值。 */
  branch: string;
}

export interface WrapHttpWriteInput {
  baseDir: string;
  /** 当前 server 实例绑定的 stones-branch（一般是 "main"）。当前实现仅支持从 main 派生 metaprog 分支。 */
  authorObjectId: string;
  /** commit message。 */
  intent: string;
  /**
   * 实际写文件的 callback。调用方应当用 ctx.baseDir + stoneRef.stonesBranch=ctx.branch
   * 调原 persistable 函数（writeSelf / createStoneObject / ...），让文件落在 worktree 工作目录。
   *
   * 抛错会被 helper 捕获并转为 { ok: false, code: "WRITE_FAILED", ... }。
   */
  write: (ctx: WriteContext) => Promise<void>;
}

/**
 * 把 HTTP 写 stone 操作包成 stone-versioning 流程（薄适配 → persistable.versionedStoneWrite）。
 */
export async function wrapHttpWriteInWorktree(input: WrapHttpWriteInput): Promise<HttpWriteOk | HttpWriteErr> {
  return versionedStoneWrite({
    baseDir: input.baseDir,
    authorObjectId: input.authorObjectId,
    intent: input.intent,
    write: input.write,
  });
}
