/**
 * stone-versioning —— 高层编排，把 worktree commit / scope 评估 / merge /
 * PR-Issue / rollback / GC 收口在 persistable 层之上。
 *
 * 地基不变量（用户拍板）：`session-<sid>` worktree 是纯运行时派生物，**永不合入
 * main**——session→main 合入语义（旧 tryMergeSelf self-scope ff / cross-scope→PR 二元闸 +
 * create_pr_and_invite_reviewers）已退役。沉淀进 canonical 走 reflectable feat-branch PR 路径（见 stone-feat-branch.ts）。
 *
 * stone 写落点：
 * - **HTTP 控制面写**（人类已决策）经 `httpDirectMainWrite` 直写 `stones/main/` 并 commit。
 * - **reflectable 沉淀**经 stone-feat-branch.ts 从 main 派生 feat 分支（createFeatBranchWorktree）
 *   → 直接编辑 → commit + 开 PR（commitAndOpenPr）；本模块 `resolvePrIssue` 作 interim 合入通道
 *   （单 supervisor merge/reject）。
 *
 * 保留的底层原语（供上述两路 + 治理复用）：resolvePrIssue / rollback / httpDirectMainWrite /
 * pruneStaleWorktrees / commitWorktree（feat/test 用）。各自 docstring 详述。
 * 所有 git 子命令通过 `enqueueSessionWrite("git:" + baseDir, ...)` 串行化。
 *
 * 唯一治理特权是 `rollback`（仅 supervisor 可调）。supervisor 与 user 都是 Builtin Object
 * （`packages/@ooc/builtins/{supervisor,user}`），随 OOC 发版，Agent 不可改写。
 */

import { rmdir, stat, cp } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { stoneDir } from "./stone-object.js";
import {
  gitArchiveBranch,
  gitCheckout,
  gitCommit,
  gitCommitAll,
  gitHead,
  gitMergeFastForward,
  gitRevParse,
  gitWorktreeList,
  gitWorktreePrune,
  gitWorktreeUnregister,
  type GitErrorCode,
} from "./stone-git.js";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";
import {
  nestedObjectPath,
  STONE_OBJECTS_SUBDIR,
  STONES_MAIN_BRANCH,
  SESSION_BRANCH_PREFIX,
} from "./common.js";

/** Supervisor 的 objectId（治理身份：rollback 仅 supervisor 可调；PR-Issue 默认收件人）。 */
export const SUPERVISOR_OBJECT_ID = "supervisor";

/** 历史 metaprog worktree 残留目录名——仅供 GC 清理（去 metaprog 后不再产生此类分支）。 */
const WORKTREE_BRANCH_PREFIX = "metaprog";

/**
 * worktree 移除后 GC 空父目录：从 worktree 父目录起逐级 `rmdir`，只删空目录、到 `stones/metaprog/`
 * 即止（不碰 `stones/`）。best-effort：rmdir 遇非空/不存在即停。
 */
async function gcEmptyWorktreeParents(worktreePathAbs: string, baseDir: string): Promise<void> {
  const metaprogRoot = join(baseDir, "stones", WORKTREE_BRANCH_PREFIX);
  let dir = dirname(worktreePathAbs);
  while (dir === metaprogRoot || dir.startsWith(metaprogRoot + sep)) {
    try {
      await rmdir(dir); // 仅当空时成功；非空抛 ENOTEMPTY → 停
    } catch {
      break;
    }
    dir = dirname(dir);
  }
}

/**
 * 启动 hygiene：后序清扫整个 `stones/metaprog/` 子树里的空目录，回收历史遗留（旧版 worktree
 * 移除未 GC 父目录、或非正常退出留下的空 `metaprog/<id>/`）。best-effort：rmdir 失败静默跳过。
 */
async function gcEmptyMetaprogTree(baseDir: string): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const metaprogRoot = join(baseDir, "stones", WORKTREE_BRANCH_PREFIX);
  async function sweep(dir: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false; // 不存在/不可读 → 不删
    }
    let allEmpty = true;
    for (const e of entries) {
      if (e.isDirectory()) {
        const childEmptied = await sweep(join(dir, e.name));
        if (!childEmptied) allEmpty = false;
      } else {
        allEmpty = false; // 有文件 → 非空
      }
    }
    if (allEmpty) {
      try {
        await rmdir(dir);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  await sweep(metaprogRoot);
}

/**
 * 合入/驳回后清理 session worktree：解除注册（保留运行时数据）+ GC 空父目录。
 * `gitWorktreeUnregister` 内部已 prune bare repo stale 注册，无需额外 prune。
 * best-effort：unregister 失败 warn 但不阻塞（caller 下次启动 prune 兜底）。
 */
async function cleanupWorktreeAfterMerge(
  repo: string,
  wtPath: string,
  baseDir: string,
  branch: string,
  ctx: string,
): Promise<void> {
  const r = gitWorktreeUnregister(repo, wtPath);
  if (!r.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[stone-versioning] ${ctx} worktree cleanup failed branch=${branch} stderr=${r.stderr}`);
  }
  await gcEmptyWorktreeParents(wtPath, baseDir);
}

export interface SessionWorktreeRef {
  /** OOC world 根。 */
  baseDir: string;
  /** session worktree 对应的 git branch 名（`session-<sid>`）。 */
  branch: string;
  /** worktree 在磁盘上的绝对路径。 */
  path: string;
}

/** 主仓库（main 工作树）目录，所有 git 操作的 cwd。 */
function repoDir(baseDir: string): string {
  return join(baseDir, "stones", STONES_MAIN_BRANCH);
}

/**
 * worktree branch 名 → 磁盘物理路径。session 分支（`session-<sid>`）落 `flows/<sid>`（与
 * sessionWorktreePath / stoneDir 对齐）；其余 branch（metaprog 残留等）仍走 `stones/<branch>`。
 * resolvePrIssue 的 worktree GC 依赖本映射定位真 worktree。
 */
function worktreePath(baseDir: string, branch: string): string {
  if (branch.startsWith(SESSION_BRANCH_PREFIX)) {
    const sid = branch.slice(SESSION_BRANCH_PREFIX.length);
    return join(baseDir, "flows", sid);
  }
  return join(baseDir, "stones", branch);
}

/**
 * caller-supplied scope-key 用于串行化所有同一 baseDir 上的 git 操作。
 * **exported**：pr builtin 的 resolve 编排（PR 下沉 P2）须用同一 key 与本模块 git 写串行化。
 */
export function gitQueueKey(baseDir: string): string {
  return `git:${baseDir}`;
}

/** 单段 objectId 合法字符（同原 isValidObjectId：不含 `/`）。 */
const OBJECT_ID_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/**
 * 校验 objectId（含嵌套 child：`parent/child`、`a/b/c`）。
 *
 * 嵌套语义：objectId 用 `/` 编码父子层级，物理落点经 nestedObjectPath
 * 翻译成 `objects/parent/children/child/`。放开 `/` 后必须逐段严格校验，防 path
 * traversal：
 * - 整串长度 ≤ 64
 * - 拆 `/` 后**每段**各自匹配单段 pattern（拒空段 → 过滤掉 `//`/前导/尾随 `/`）
 * - 显式拒 `.` / `..` 段（pattern 允许 `.` 在非首位，故 `..` 能过 pattern——必须单独挡）
 * - 至少 1 段
 */
function isValidObjectId(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  const segments = value.split("/");
  if (segments.length === 0) return false;
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return false;
    if (!OBJECT_ID_SEGMENT_PATTERN.test(seg)) return false;
  }
  return true;
}

/**
 * Sync a merged object from the git repo (stones/main/objects/) to the
 * workspace packages/ directory. After a successful ff merge, changes live
 * in the git worktree at stones/main/objects/<nestedPath>/ but runtime reads
 * (stoneDir with _stonesBranch="main") go directly to packages/<nestedPath>/.
 */
async function syncMergedObjectToPackages(baseDir: string, objectId: string): Promise<void> {
  const source = join(baseDir, "stones", STONES_MAIN_BRANCH, STONE_OBJECTS_SUBDIR, ...nestedObjectPath(objectId));
  const target = stoneDir({ baseDir, objectId });
  try {
    await stat(source);
  } catch {
    return; // nothing to sync (e.g., object deleted in merge)
  }
  await cp(source, target, { recursive: true, force: true });
}

/**
 * Extract unique object IDs from a list of git paths (all starting with
 * `objects/<nestedPath>/...`).
 */
function extractObjectIdsFromPaths(paths: string[]): string[] {
  const ids = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith("objects/")) continue;
    const rest = p.slice("objects/".length);
    const segs = rest.split("/");
    // Reconstruct objectId by walking segments and handling children/ markers
    const idSegs: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg === "children") {
        i++; // skip children marker, next seg is the actual object name
        if (i < segs.length) idSegs.push(segs[i]!);
      } else {
        if (idSegs.length === 0) idSegs.push(seg);
        else break; // non-children, non-first seg means we're inside an object's files
      }
    }
    if (idSegs.length > 0) ids.add(idSegs.join("/"));
  }
  return Array.from(ids);
}

/* ---------------------------------------------------------------- *
 * commitWorktree
 * ---------------------------------------------------------------- */

export interface CommitWorktreeInput {
  worktree: SessionWorktreeRef;
  intent: string;
  authorObjectId: string;
}

export type CommitWorktreeResult =
  | { ok: true; commitSha: string }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string };

/** 在 worktree 内 stage 全部变更并 commit；author 写为 authorObjectId。 */
export async function commitWorktree(input: CommitWorktreeInput): Promise<CommitWorktreeResult> {
  if (!isValidObjectId(input.authorObjectId)) {
    return { ok: false, code: "INVALID_INPUT", message: `invalid authorObjectId '${input.authorObjectId}'` };
  }
  if (!input.intent.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "intent required" };
  }

  return enqueueSessionWrite(gitQueueKey(input.worktree.baseDir), async () => {
    const r = gitCommitAll(input.worktree.path, {
      authorName: input.authorObjectId,
      authorEmail: `${input.authorObjectId}@ooc.local`,
      message: input.intent,
    });
    if (!r.ok) return { ok: false, code: "GIT", gitCode: r.code, stderr: r.stderr } as const;
    return { ok: true, commitSha: r.value } as const;
  });
}


/* ---------------------------------------------------------------- *
 * git 合入原语（纯 git 机制，无 pr-issue 依赖）
 *
 * resolve 编排（读 issue + 调本原语 + close 账本）已下沉 pr builtin
 * （`builtins/agent/children/pr/resolve.ts`，PR 下沉 P2）；本模块只留纯 git 机制。
 * **queue-naive**：假定调用方已持 `gitQueueKey` 串行化（pr builtin resolve 在其 enqueue 内调用）。
 * ---------------------------------------------------------------- */

export type MergeFeatBranchResult =
  | { ok: true; commitSha: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string };

export type ArchiveFeatBranchResult =
  | { ok: true; archivedRef: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string };

/**
 * ff-merge feat branch → main：checkout main → ff-merge → 同步 packages → 取 head → 回收 worktree。
 * 不读写 pr-issue；分支/路径由调用方传入。commitSha 取合后 main head。
 */
export async function mergeFeatBranch(
  baseDir: string,
  branch: string,
  paths: string[],
  reason = "mergeFeatBranch",
): Promise<MergeFeatBranchResult> {
  const repo = repoDir(baseDir);
  const checkoutMain = gitCheckout(repo, STONES_MAIN_BRANCH);
  if (!checkoutMain.ok) {
    return { ok: false, code: "GIT", gitCode: checkoutMain.code, stderr: checkoutMain.stderr };
  }
  const ff = gitMergeFastForward(repo, branch);
  if (!ff.ok) return { ok: false, code: "GIT", gitCode: ff.code, stderr: ff.stderr };

  const objectIds = extractObjectIdsFromPaths(paths);
  for (const oid of objectIds) {
    await syncMergedObjectToPackages(baseDir, oid);
  }

  const head = gitHead(repo);
  if (!head.ok) return { ok: false, code: "GIT", gitCode: head.code, stderr: head.stderr };

  await cleanupWorktreeAfterMerge(repo, worktreePath(baseDir, branch), baseDir, branch, reason);
  return { ok: true, commitSha: head.value };
}

/**
 * archive feat branch → `refs/ooc/rejected/<branch>` + 回收 worktree。不读写 pr-issue。
 */
export async function archiveFeatBranch(
  baseDir: string,
  branch: string,
  reason = "archiveFeatBranch",
): Promise<ArchiveFeatBranchResult> {
  const repo = repoDir(baseDir);
  await cleanupWorktreeAfterMerge(repo, worktreePath(baseDir, branch), baseDir, branch, reason);
  const archive = gitArchiveBranch(repo, branch);
  if (!archive.ok) {
    return { ok: false, code: "GIT", gitCode: archive.code, stderr: archive.stderr };
  }
  return { ok: true, archivedRef: `refs/ooc/rejected/${branch}` };
}

/* ---------------------------------------------------------------- *
 * rollback (F3)
 * ---------------------------------------------------------------- */

export interface RollbackInput {
  baseDir: string;
  /** 待回滚 stone 所属的 objectId（其文件位于 main work-tree 的 `${objectId}/` 下）。 */
  objectId: string;
  /** 目标 commit sha（必须在 main 历史上）。 */
  targetCommit: string;
  /**
   * Supervisor 身份；例外允许其它 Object 实例化不动时 Supervisor 代签 commit。
   * 缺省强制 SUPERVISOR_OBJECT_ID。
   */
  supervisorAuthor?: string;
}

export type RollbackResult =
  | { ok: true; commitSha: string }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "FORBIDDEN"; message: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string };

/**
 * Supervisor 主导回滚：把 main 上 `${objectId}/` 子树恢复到目标 commit 状态，并以 Supervisor 署名提交。
 *
 * supervisor-only：本函数自身强制 supervisorAuthor === SUPERVISOR_OBJECT_ID。LLM 命令层 / HTTP
 * route / 测试夹具的 caller 校验是补充防御，但本层是唯一可信防线——任何新入口（cron / 工具脚本 /
 * 未来子模块）调本函数时都自动得到边界保护。
 */
export async function rollback(input: RollbackInput): Promise<RollbackResult> {
  if (!isValidObjectId(input.objectId)) {
    return { ok: false, code: "INVALID_INPUT", message: `invalid objectId '${input.objectId}'` };
  }
  const supervisorAuthor = input.supervisorAuthor ?? SUPERVISOR_OBJECT_ID;
  if (!isValidObjectId(supervisorAuthor)) {
    return { ok: false, code: "INVALID_INPUT", message: `invalid supervisorAuthor '${supervisorAuthor}'` };
  }
  // supervisor-only 最深防御：治理 rollback 经控制面 HTTP 端点
  // （POST /api/runtime/stones/<id>/rollback，固定传 SUPERVISOR_OBJECT_ID）行使；
  // 本关是唯一可信防线，任何绕过控制面的入口都过不去。
  if (supervisorAuthor !== SUPERVISOR_OBJECT_ID) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: `rollback requires supervisorAuthor === '${SUPERVISOR_OBJECT_ID}', got '${supervisorAuthor}'`,
    };
  }
  if (typeof input.targetCommit !== "string" || input.targetCommit.length === 0) {
    return { ok: false, code: "INVALID_INPUT", message: "targetCommit required" };
  }

  return enqueueSessionWrite(gitQueueKey(input.baseDir), async () => {
    const repo = repoDir(input.baseDir);
    // 验证 targetCommit 存在
    const target = gitRevParse(repo, input.targetCommit);
    if (!target.ok) return { ok: false, code: "GIT", gitCode: target.code, stderr: target.stderr } as const;

    // 切到 main
    const checkout = gitCheckout(repo, STONES_MAIN_BRANCH);
    if (!checkout.ok) return { ok: false, code: "GIT", gitCode: checkout.code, stderr: checkout.stderr } as const;

    // git checkout {target} -- objects/{objectId}/
    const restore = Bun.spawnSync(
      ["git", "checkout", target.value, "--", `objects/${input.objectId}/`],
      { cwd: repo, stdout: "pipe", stderr: "pipe" },
    );
    if (restore.exitCode !== 0) {
      const stderr = new TextDecoder().decode(restore.stderr ?? new Uint8Array()).trim();
      return { ok: false, code: "GIT", gitCode: "GIT_GENERIC", stderr } as const;
    }

    await syncMergedObjectToPackages(input.baseDir, input.objectId);

    // commit 由 supervisor 署名
    const commit = gitCommit(repo, {
      authorName: supervisorAuthor,
      authorEmail: `${supervisorAuthor}@ooc.local`,
      message: `chore(rollback): restore ${input.objectId}/ to ${target.value.slice(0, 8)}`,
    });
    if (!commit.ok) {
      // 索引可能为空（target 与 head 一致）—— allowEmpty 走一次
      if (commit.code === "GIT_GENERIC" && commit.stderr.includes("nothing to commit")) {
        const head = gitHead(repo);
        if (!head.ok) return { ok: false, code: "GIT", gitCode: head.code, stderr: head.stderr } as const;
        return { ok: true, commitSha: head.value } as const;
      }
      return { ok: false, code: "GIT", gitCode: commit.code, stderr: commit.stderr } as const;
    }
    return { ok: true, commitSha: commit.value } as const;
  });
}

/* ---------------------------------------------------------------- *
 * pruneStaleWorktrees (启动 hygiene)
 * ---------------------------------------------------------------- */

export interface PruneResult {
  ok: true;
  removed: string[];
  pruned: boolean;
}

/**
 * 启动期清理：list worktrees → 移除 main 之外的所有"分支已 merge / 已 archived"
 * 的 worktree。简化策略：本期只跑 `git worktree prune`（清掉 admin 文件 stale），
 * 不主动删任何 branch / 工作树目录——保留 Object 自己的判断。
 */
export async function pruneStaleWorktrees(baseDir: string): Promise<PruneResult> {
  return enqueueSessionWrite(gitQueueKey(baseDir), async () => {
    const repo = repoDir(baseDir);
    const list = gitWorktreeList(repo);
    const removed: string[] = [];
    if (list.ok) {
      for (const e of list.value) {
        if (e.path === repo) continue;
        // 物理路径已不存在的 worktree（脏状态）记入 removed 让 caller 看到；prune 清对应 admin 文件。
        const exists = await stat(e.path).then(() => true).catch(() => false);
        if (!exists) removed.push(e.path);
      }
    }
    // silent-swallow ban: prune 失败 warn 但不影响整体 ok（caller 仍能拿到 removed）
    const prune = gitWorktreePrune(repo);
    if (!prune.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[stone-versioning] pruneStaleWorktrees prune failed stderr=${prune.stderr}`,
      );
    }
    // 回收 metaprog 子树里的空目录残留（历史遗留 + 本轮 prune 后空出的父目录）
    await gcEmptyMetaprogTree(baseDir);
    return { ok: true, removed, pruned: prune.ok } as const;
  });
}

/* ---------------------------------------------------------------- *
 * httpDirectMainWrite (HTTP 控制面写 → 直接 commit main)
 * ---------------------------------------------------------------- */

export interface HttpDirectMainWriteInput {
  baseDir: string;
  /** 写入对象（commit 署名 + 写落点 objects/<objectId>/）。 */
  authorObjectId: string;
  /** commit message。 */
  intent: string;
  /**
   * 实际写文件的 callback。拿到的 branch 恒为 main——caller 用
   * stoneRef._stonesBranch=branch 调 persistable 写函数，文件即落 `stones/main/objects/<id>/`，
   * 所见即所得（不开 worktree、不隔离）。抛错被捕获转 WRITE_FAILED。
   */
  write: (branch: string) => Promise<void>;
}

export type HttpDirectMainWriteResult =
  | { ok: true; commitSha: string; merged: true }
  | { ok: false; code: string; message: string };

/**
 * HTTP 控制面写 stone → **直接 commit main**。
 *
 * 人类经控制面的编辑即「已决策/已评审」操作：所见即所得，无需 session 隔离与 super flow 评审。
 * 写直接落 `stones/main/` worktree，enqueueSessionWrite 串行化防 HTTP 并发 git 竞争，
 * 之后 gitCommitAll 署名 authorObjectId 提交 main。返回 merged=true（已即时生效）。
 */
export async function httpDirectMainWrite(
  input: HttpDirectMainWriteInput,
): Promise<HttpDirectMainWriteResult> {
  const branch = STONES_MAIN_BRANCH;
  return enqueueSessionWrite(gitQueueKey(input.baseDir), async () => {
    try {
      await input.write(branch);
    } catch (err) {
      return {
        ok: false,
        code: "WRITE_FAILED",
        message: (err as Error).message,
      } as const;
    }
    const mainWorktreePath = join(input.baseDir, "stones", branch);
    const commit = gitCommitAll(mainWorktreePath, {
      authorName: input.authorObjectId,
      authorEmail: `${input.authorObjectId}@ooc.local`,
      message: input.intent,
    });
    if (!commit.ok) {
      return {
        ok: false,
        code: commit.code ?? "GIT",
        message: commit.stderr ?? "git commit failed",
      } as const;
    }
    await syncMergedObjectToPackages(input.baseDir, input.authorObjectId);
    return { ok: true, commitSha: commit.value, merged: true } as const;
  });
}

/* ---------------------------------------------------------------- *
 * test-only helpers
 * ---------------------------------------------------------------- */

export const __testing = {
  gitQueueKey,
  isValidObjectId,
  worktreePath,
  repoDir,
};
