/**
 * HTTP stone-write helper —— 控制面写 → **直接 commit main**（去 metaprog，2026-06-09）。
 *
 * 人类经 HTTP 控制面的编辑（PUT self/readable/server-source、createStone）即「已决策/
 * 已评审」操作：所见即所得，不需 session worktree 隔离与 super flow 评审。本 helper 把写
 * 操作直接落 `stones/main/` 工作树并 commit（enqueueSessionWrite 串行化防 HTTP 并发竞争）。
 *
 * 编排核心在 persistable/programmable 的 `httpDirectMainWrite`（单一 owner）；本文件保留为
 * 薄适配层——仅做命名对齐（HttpWrite* ↔ HttpDirectMainWrite*）。
 */
import { httpDirectMainWrite } from "@ooc/core/programmable";

/** wrapHttpWriteInWorktree 的成功返回。 */
export interface HttpWriteOk {
  ok: true;
  /** main 上的 commit sha。 */
  commitSha: string;
  /** 控制面写恒为 true（直接 commit main，立即生效，无 PR-Issue）。 */
  merged: boolean;
  /** 兼容字段：控制面写不再开 PR-Issue，恒 undefined。 */
  prIssueId?: number;
}

/** wrapHttpWriteInWorktree 的失败返回（不抛错——caller 转 AppServerError）。 */
export interface HttpWriteErr {
  ok: false;
  /** 与 GitErrorCode/WRITE_FAILED 对齐。 */
  code: string;
  message: string;
}

/** write callback 拿到的上下文：caller 用 branch（恒为 "main"）调 persistable 写函数。 */
export interface WriteContext {
  /** 当前写落点 OOC world 根。 */
  baseDir: string;
  /** stone 写落点 git branch；控制面写恒为 "main"（直写 main 工作树）。 */
  branch: string;
}

export interface WrapHttpWriteInput {
  baseDir: string;
  /** commit 署名 + 写落点 objects/<objectId>/。 */
  authorObjectId: string;
  /** commit message。 */
  intent: string;
  /**
   * 实际写文件的 callback。调用方用 ctx.baseDir + stoneRef._stonesBranch=ctx.branch
   * 调原 persistable 函数（writeSelf / createStoneObject / ...），文件即落 `stones/main/`。
   * 抛错被捕获转 { ok: false, code: "WRITE_FAILED", ... }。
   */
  write: (ctx: WriteContext) => Promise<void>;
}

/**
 * 把 HTTP 写 stone 操作直接 commit 到 main（薄适配 → programmable.httpDirectMainWrite）。
 */
export async function wrapHttpWriteInWorktree(input: WrapHttpWriteInput): Promise<HttpWriteOk | HttpWriteErr> {
  const r = await httpDirectMainWrite({
    baseDir: input.baseDir,
    authorObjectId: input.authorObjectId,
    intent: input.intent,
    write: async (branch) => input.write({ baseDir: input.baseDir, branch }),
  });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  return { ok: true, commitSha: r.commitSha, merged: r.merged };
}
