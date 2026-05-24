/**
 * HTTP stone-write versioning helper —— 根因 #2（HTTP-git 语义统一）。
 *
 * 让 HTTP service.ts 的写 stone 操作复用 LLM 命令同样的 stone-versioning 流程：
 *   open metaprog worktree → exec write callback in worktree → commit → tryMergeSelf
 *
 * 设计原则（克制熵增）：
 *   - 不引入新的"HttpVersioningProtocol"抽象——只是把 `openMetaprogWorktree` /
 *     `commitWorktree` / `tryMergeSelf` 的三步串成一行
 *   - 调用方 (service.ts) 在 callback 内**仍调原 persistable 函数**，只是把 stoneRef
 *     的 stonesBranch 改成 worktree.branch，让写入落在 worktree 工作目录
 *   - silent-swallow ban：任一步失败立刻返回 { ok: false, code, message }，调用方
 *     转 AppServerError
 *
 * 不在范围（root cause #3 处理）：knowledge / files (pool 层) / callMethod。
 */
import {
  commitWorktree,
  ensureStoneRepo,
  openMetaprogWorktree,
  requestPrIssueReview,
  tryMergeSelf,
  type MetaprogWorktreeRef,
} from "@src/persistable";

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

function shortRandom(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** stone-versioning 各失败 union 的 message 字段不统一（INVALID_INPUT/ISSUE_SERVICE 有 message，GIT 用 stderr）。 */
function extractMessage(r: { code: string; message?: string; stderr?: string; gitCode?: string }): string {
  if (r.message) return r.message;
  if (r.stderr) return r.gitCode ? `${r.gitCode}: ${r.stderr}` : r.stderr;
  return r.code;
}

/**
 * 把 HTTP 写 stone 操作包成 stone-versioning 流程。
 *
 * 失败语义（silent-swallow ban）：任一步失败直接返回 ok:false；caller 必须转 AppServerError。
 * worktree 由 tryMergeSelf 在 merged/non-FF 路径自动清理；PR-Issue 路径下 worktree 保留
 * 等 Supervisor 决议（resolvePrIssue 时清理）。
 */
export async function wrapHttpWriteInWorktree(input: WrapHttpWriteInput): Promise<HttpWriteOk | HttpWriteErr> {
  // 契约 3 状态翻转唯一 owner：versioning-helper 自己负责 stone repo init 前置条件，
  // 不依赖 caller（buildServer / 测试 / cron 等）记得调用。ensureStoneRepo 是
  // idempotent 的，已 init 时是 fast no-op；首次 buildServer 测试场景下惰性触发 bare repo 初始化。
  try {
    await ensureStoneRepo({ baseDir: input.baseDir });
  } catch (e) {
    return {
      ok: false,
      code: "REPO_INIT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const open = await openMetaprogWorktree({
    baseDir: input.baseDir,
    objectId: input.authorObjectId,
    token: `http-${shortRandom()}`,
  });
  if (!open.ok) return { ok: false, code: open.code, message: extractMessage(open) };
  const worktree: MetaprogWorktreeRef = open.worktree;

  try {
    await input.write({ path: worktree.path, baseDir: worktree.baseDir, branch: worktree.branch });
  } catch (e) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const commit = await commitWorktree({
    worktree,
    intent: input.intent,
    authorObjectId: input.authorObjectId,
  });
  if (!commit.ok) return { ok: false, code: commit.code, message: extractMessage(commit) };

  const merge = await tryMergeSelf(worktree, input.authorObjectId);
  if (!merge.ok) return { ok: false, code: merge.code, message: extractMessage(merge) };

  if (merge.kind === "merged") {
    return { ok: true, commitSha: merge.commitSha, merged: true };
  }
  if (merge.kind === "must-pr-issue") {
    const pr = await requestPrIssueReview({
      worktree,
      intent: input.intent,
      authorObjectId: input.authorObjectId,
    });
    if (!pr.ok) return { ok: false, code: pr.code, message: extractMessage(pr) };
    return { ok: true, commitSha: commit.commitSha, merged: false, prIssueId: pr.issueId };
  }
  // rebase-conflict / non-fast-forward —— caller 应当看到失败信号
  return {
    ok: false,
    code: merge.kind === "rebase-conflict" ? "REBASE_CONFLICT" : "NON_FAST_FORWARD",
    message: merge.stderr,
  };
}
