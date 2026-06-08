/**
 * versioned-write —— 把"写一个 stone 文件"的副作用统一包进 stone-versioning 流程：
 *
 *   openMetaprogWorktree → write(callback) → commitWorktree → tryMergeSelf
 *     - self-scope（diff 全落在 author 自治区 stones/main/objects/<author>/）→ ff merge 回 main
 *     - cross-scope（越界）→ requestPrIssueReview，等 Supervisor 决议
 *
 * 这是 persistable 层的单一 owner。两个 caller 复用它：
 *   - HTTP 控制面（app/server/modules/stones/versioning-helper.ts 薄 re-export）
 *   - LLM 的 write_file 命令（executable/windows/root，写 stones/ 路径时路由进来）
 *
 * 设计原则（克制熵增）：不引入新抽象，只把 openMetaprogWorktree / commitWorktree /
 * tryMergeSelf / requestPrIssueReview 四步串成一行；caller 在 write callback 内仍调
 * 原 persistable 函数，只是把写入落点指向 worktree 工作目录。
 *
 * 失败语义（silent-swallow ban）：任一步失败立刻返回 { ok: false, code, message }，
 * 绝不静默直写绕过 versioning。
 */
import {
  commitWorktree,
  openMetaprogWorktree,
  requestPrIssueReview,
  tryMergeSelf,
  type MetaprogWorktreeRef,
} from "./versioning.js";

/** versionedStoneWrite 成功返回。 */
export interface VersionedWriteOk {
  ok: true;
  /** self-scope merge 后 main 上的 commit sha；cross-scope 时退回 worktree commit 的 sha。 */
  commitSha: string;
  /** true = 已 ff merge 到 main；false = 已落 PR-Issue 等 Supervisor 决议。 */
  merged: boolean;
  /** cross-scope 时新建的 PR-Issue id。 */
  prIssueId?: number;
}

/** versionedStoneWrite 失败返回（不抛错——caller 自行决定如何呈现）。 */
export interface VersionedWriteErr {
  ok: false;
  /** 与 stone-versioning 的 GitErrorCode/INVALID_INPUT/ISSUE_SERVICE 对齐。 */
  code: string;
  message: string;
}

/** write callback 拿到的 worktree 上下文。caller 应当把写入落点指向 worktree 工作目录。 */
export interface VersionedWriteContext {
  /** worktree 在磁盘上的绝对路径（`${baseDir}/stones/${branch}`）。 */
  path: string;
  /** worktree 仍属于的 OOC world 根（与外层 baseDir 一致）。 */
  baseDir: string;
  /** worktree 对应的 git branch；写 stone 时把 stoneRef.stonesBranch 改为这个值。 */
  branch: string;
}

export interface VersionedStoneWriteInput {
  baseDir: string;
  /** 当前发起写的 Object（main-side authorObjectId）。当前实现仅支持从 main 派生 metaprog 分支。 */
  authorObjectId: string;
  /** commit message。 */
  intent: string;
  /**
   * 实际写文件的 callback。调用方应当用 ctx.path（worktree 工作树根）或
   * ctx.baseDir + stoneRef.stonesBranch=ctx.branch 调原 persistable 函数，
   * 让文件落在 worktree 工作目录而非 main。
   *
   * 抛错会被捕获并转为 { ok: false, code: "WRITE_FAILED", ... }。
   */
  write: (ctx: VersionedWriteContext) => Promise<void>;
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
 * 把一次写 stone 文件操作包成 stone-versioning 流程。
 *
 * worktree 由 tryMergeSelf 在 merged/non-FF 路径自动清理；PR-Issue 路径下 worktree 保留
 * 等 Supervisor 决议（resolvePrIssue 时清理）。
 */
export async function versionedStoneWrite(
  input: VersionedStoneWriteInput,
): Promise<VersionedWriteOk | VersionedWriteErr> {
  // metaprog worktree 落在 stones/ 下（openMetaprogWorktree），不依赖 `<world>/packages/`。
  // 旧的 mkdir packages/ 前置条件已于 2026-06-07 随 deprecated packages/ 布局一并移除。
  const open = await openMetaprogWorktree({
    baseDir: input.baseDir,
    objectId: input.authorObjectId,
    token: `vw-${shortRandom()}`,
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
