/**
 * stone-feat-branch —— reflectable 沉淀的 **feat-branch PR** 路径（取代退役的 session→main 合入）。
 *
 * 地基不变量（用户拍板）：`session-<sid>` worktree 是纯运行时派生物，**永不合入 main**。
 * 要让改动成为 canonical，走「另起 feat 分支 → 在分支 worktree 下**直接编辑** → commit → PR
 * → review → merge」。
 *
 * 改写（用户拍板：不封装 edits 参数）：沉淀拆成两步，由 super(foo) thread 携
 * **feat 分支绑定**（thread.persistence.stonesBranch）串起来：
 *   1. `createFeatBranchWorktree`：从 main 派生 feat 分支 worktree（落 `stones/<branch>/`），
 *      只建空白副本、返回分支名——**不写任何文件**。super(foo) 随后用普通 write_file /
 *      file_window.edit 直接编辑该 worktree 下文件（经 resolveStoneIdentityRef 绑定覆盖优先路由）。
 *   2. `commitAndOpenPr`：finalizer——commit feat worktree（署名 author）、`computeReviewerSet`
 *      冒泡算 reviewer、`createPrIssue` 落 `flows/super/issues/`（prPayload.branch=feat 分支、
 *      record.reviewers=冒泡结果）。
 *
 * `computeReviewerSet` 纯函数保留（决策 A：逐路径拥有者）。reviewer 集只计算+存储，
 * 当前阶段**不强制执行**——interim 合入仍走既有 `resolvePrIssue`（单 supervisor merge/reject）。
 *
 * 与 session 合入闸（已退役）的本质区别：分支是**沉淀单元**而非运行时派生物；source 是
 * super(foo) 在 feat worktree 下的直接编辑，不读任何 session worktree。
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  gitCommitAll,
  gitDiffNames,
  gitDiffPatch,
  gitHead,
  gitStatus,
  gitWorktreeAdd,
  gitWorktreeUnregister,
} from "./stone-git.js";
import { createPrIssue } from "./pr-issue.js";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";
import {
  nestedObjectPath,
  STONES_BARE_REPO_DIR,
  STONES_MAIN_BRANCH,
} from "./common.js";

/** Supervisor 的 objectId（reviewer 集恒含；与 stone-versioning.SUPERVISOR_OBJECT_ID 同值）。 */
export const SUPERVISOR_OBJECT_ID = "supervisor";

/* ================================================================ *
 * computeReviewerSet（纯函数）
 * ================================================================ */

/**
 * 把 `objects/...` 物理路径翻译回**领地包含它的最近 parent 对象**（决策 A，spec §决策2A）。
 *
 * reviewer 是「领地包含变更的最近 parent 对象」：领地 = `objects/<X>/**`（含 children/）。
 * 因此触及别人 children 的变更，reviewer 是那个**顶层对象 X**（X 授权其整个领地，含子对象）——
 * 而非最深嵌套子对象。
 *   - `objects/<X>/...`              → X
 *   - `objects/<X>/children/<Y>/...` → X（X 领地覆盖 children/Y/）
 *
 * 非 `objects/` 路径（运行时产物 / 顶层文件）→ undefined（不产生 reviewer）。
 *
 * 注：author 自己的子树（可为 nested，如 `foo/sub`）由 authorSubtreePrefix 在上游先排除，
 * 不经本函数——故本函数只需回顶层领地 owner。
 */
function ownerObjectIdOfPath(path: string): string | undefined {
  const prefix = "objects/";
  if (!path.startsWith(prefix)) return undefined;
  const segs = path.slice(prefix.length).split("/").filter(Boolean);
  const top = segs[0];
  return top && top !== "children" ? top : undefined;
}

/**
 * author 子树前缀（`objects/<nestedPath>/`）。落在此前缀下的路径属 author 自治区，
 * 不产生越界 reviewer（含 author 的 children/）。与 stone-versioning.selfScopePrefix 对齐。
 */
function authorSubtreePrefix(authorObjectId: string): string {
  return `objects/${nestedObjectPath(authorObjectId).join("/")}/`;
}

/**
 * scope 冒泡算 reviewer 集（决策 A）。
 *
 * reviewer 集 = {落在 author 子树外的、每个被触及路径的拥有对象} ∪ {supervisor}。
 *   - author（foo）自己**不**作 reviewer（决策3）；改自己子树（含 children）→ {supervisor}。
 *   - 改 Y 的 children → reviewer 是 Y（领地包含变更的最近 parent 对象）。
 *   - supervisor 始终参与，且去重后仅一次。
 *
 * 返回稳定排序：越界拥有对象按字典序 + supervisor 末位，便于断言与可观测。
 */
export function computeReviewerSet(diffPaths: string[], authorObjectId: string): string[] {
  const subtreePrefix = authorSubtreePrefix(authorObjectId);
  const reviewers = new Set<string>();
  for (const p of diffPaths) {
    if (p.startsWith(subtreePrefix)) continue; // author 自治区，不产生 reviewer
    const owner = ownerObjectIdOfPath(p);
    if (owner == null) continue; // 非 objects/ 路径忽略
    if (owner === authorObjectId) continue; // 防御：与 author 同 id（理论上已被前缀挡掉）
    if (owner === SUPERVISOR_OBJECT_ID) continue; // supervisor 固定末位追加，避免重复
    reviewers.add(owner);
  }
  return [...[...reviewers].sort(), SUPERVISOR_OBJECT_ID];
}

/* ================================================================ *
 * feat 分支 slug / 路径 helper
 * ================================================================ */

/** 从 intent 派生 git-safe slug（小写、非字母数字折叠成 `-`、收尾去 `-`、限长）。 */
export function slugFromIntent(intent: string): string {
  const slug = intent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "change";
}

/** feat 分支名：`feat/<slug>`。 */
export function featBranchName(slug: string): string {
  return `feat/${slug}`;
}

/** feat 分支 worktree 物理落点：`stones/<branch>/`（与 main / session worktree 并列）。 */
export function featWorktreePath(baseDir: string, branch: string): string {
  return join(baseDir, "stones", branch);
}

/** stones bare repo 目录：`<baseDir>/stones/.stones_repo`（worktree add 的 cwd）。 */
function stonesBareRepoDir(baseDir: string): string {
  return join(baseDir, "stones", STONES_BARE_REPO_DIR);
}

/** 主仓库（main 工作树）目录，diff/PR/worktree unregister 用 cwd。 */
function mainRepoDir(baseDir: string): string {
  return join(baseDir, "stones", STONES_MAIN_BRANCH);
}

/* ================================================================ *
 * createFeatBranchWorktree（开 feat 分支，不写文件）
 * ================================================================ */

export interface CreateFeatBranchWorktreeInput {
  baseDir: string;
  /** 沉淀意图（派生 slug；缺省 slug 时用）。 */
  intent: string;
  /** 可选显式 slug（覆盖 intent 派生）。 */
  slug?: string;
}

export type CreateFeatBranchWorktreeResult =
  | { ok: true; branch: string; worktreePath: string }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "GIT"; message: string };

/**
 * 从 main 派生 feat 分支 worktree（落 `stones/<branch>/`），**不写任何文件**。
 *
 * 返回分支名后由 super(foo) 把它绑到 thread.persistence.stonesBranch，随后用普通
 * write_file / file_window.edit 直接编辑该 worktree 下文件（经 resolveStoneIdentityRef
 * 绑定覆盖优先路由）。git 操作经 `git:<baseDir>` 串行化。
 */
export async function createFeatBranchWorktree(
  input: CreateFeatBranchWorktreeInput,
): Promise<CreateFeatBranchWorktreeResult> {
  const { baseDir, intent } = input;
  if (!intent || !intent.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "intent required" };
  }
  const slug = (input.slug && input.slug.trim()) || slugFromIntent(intent);
  const branch = featBranchName(slug);
  const wtPath = featWorktreePath(baseDir, branch);

  return enqueueSessionWrite(`git:${baseDir}`, async () => {
    const add = gitWorktreeAdd(stonesBareRepoDir(baseDir), {
      path: wtPath,
      branch,
      baseRef: STONES_MAIN_BRANCH,
    });
    if (!add.ok) {
      // WORKTREE_EXISTS：同名 feat 分支已建（同 intent 复用）→ 幂等视为成功。
      if (add.code === "WORKTREE_EXISTS") {
        return { ok: true, branch, worktreePath: wtPath } as const;
      }
      return {
        ok: false,
        code: "GIT",
        message: `feat-branch worktree add failed (branch=${branch}): ${add.stderr ?? add.code}`,
      } as const;
    }
    return { ok: true, branch, worktreePath: wtPath } as const;
  });
}

/* ================================================================ *
 * commitAndOpenPr（finalizer：commit feat worktree + 建 PR）
 * ================================================================ */

export interface CommitAndOpenPrInput {
  baseDir: string;
  /** feat 分支名（= thread.persistence.stonesBranch）。 */
  branch: string;
  /** 发起沉淀的 author（= super(foo) 的 foo；commit 署名 + PR createdBy + reviewer 集排除项）。 */
  authorObjectId: string;
  /** 沉淀意图（PR title/intent；commit message）。 */
  intent: string;
  /** 可选 PR title（缺省取 intent 前 80 字）。 */
  title?: string;
  /** 可选 PR 描述。 */
  description?: string;
  /**
   * 发起沉淀的 super(foo) threadId：随 prPayload 持久化，reject /
   * request-changes / 合入失败时把反馈回投到这条 thread 让 super(foo) resume 修复。
   */
  authorThreadId?: string;
}

export type CommitAndOpenPrResult =
  | {
      ok: true;
      issueId: number;
      branch: string;
      reviewers: string[];
      paths: string[];
    }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "GIT"; message: string }
  | { ok: false; code: "NO_CHANGES"; message: string }
  | { ok: false; code: "ISSUE_SERVICE"; message: string };

/**
 * finalizer：commit feat worktree（署名 author）→ diff vs main → computeReviewerSet →
 * createPrIssue（branch=feat 分支、reviewers=冒泡结果）。
 *
 * 编辑由 super(foo) 提前经 write_file / file_window.edit 直接落进 feat worktree——本函数
 * 只把工作树现状 commit 出来。失败一律 fail-loud。git 操作经 `git:<baseDir>` 串行化。
 */
export async function commitAndOpenPr(
  input: CommitAndOpenPrInput,
): Promise<CommitAndOpenPrResult> {
  const { baseDir, branch, authorObjectId, intent } = input;
  if (!authorObjectId || !authorObjectId.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "authorObjectId required" };
  }
  if (!intent || !intent.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "intent required" };
  }
  if (!branch || !branch.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "branch required" };
  }
  const wtPath = featWorktreePath(baseDir, branch);

  return enqueueSessionWrite(`git:${baseDir}`, async () => {
    // 1. 工作树干净（无编辑）→ NO_CHANGES（git "nothing to commit" 走 stdout，gitCommit
    //    的 failGeneric 只拿 stderr 检测不到，故先用 status 显式判）。
    const status = gitStatus(wtPath);
    if (!status.ok) {
      return {
        ok: false,
        code: "GIT",
        message: `read feat worktree status failed (branch=${branch}): ${status.stderr}`,
      } as const;
    }
    if (status.value.trim() === "") {
      return {
        ok: false,
        code: "NO_CHANGES",
        message:
          `feat 分支 ${branch} 工作树无 stone 改动——先 write_file / file_window.edit 编辑 stone 路径 ` +
          `（stones/<self>/...，objects/...）再 evolve_self。若你本次只往 pool 沉淀了知识/记忆 ` +
          `（pools/...，write-through 已立即生效），则无需 evolve_self、也开不出 PR。`,
      } as const;
    }

    // 2. commit（署名 author）
    const commit = gitCommitAll(wtPath, {
      authorName: authorObjectId,
      authorEmail: `${authorObjectId}@ooc.local`,
      message: intent,
    });
    if (!commit.ok) {
      return { ok: false, code: "GIT", message: `feat-branch commit failed: ${commit.stderr}` } as const;
    }

    // 3. diff（feat 分支 vs main）→ paths + patch + baseSha
    const repo = mainRepoDir(baseDir);
    const head = gitHead(repo);
    if (!head.ok) {
      return { ok: false, code: "GIT", message: `read main HEAD failed: ${head.stderr}` } as const;
    }
    const names = gitDiffNames(repo, STONES_MAIN_BRANCH, branch);
    if (!names.ok) {
      return { ok: false, code: "GIT", message: `diff names failed: ${names.stderr}` } as const;
    }
    if (names.value.length === 0) {
      return { ok: false, code: "NO_CHANGES", message: "feat branch has no diff vs main" } as const;
    }
    const patch = gitDiffPatch(repo, STONES_MAIN_BRANCH, branch);
    if (!patch.ok) {
      return { ok: false, code: "GIT", message: `diff patch failed: ${patch.stderr}` } as const;
    }

    // 4. reviewer 集（冒泡）+ createPrIssue（branch=feat 分支、reviewers=冒泡结果）
    const reviewers = computeReviewerSet(names.value, authorObjectId);
    const title = (input.title ?? intent).slice(0, 80);
    try {
      const issue = await createPrIssue({
        baseDir,
        title,
        description: input.description,
        createdByObjectId: authorObjectId,
        reviewers,
        prPayload: {
          intent,
          branch,
          diff: patch.value,
          paths: names.value,
          baseSha: head.value,
          ...(input.authorThreadId ? { authorThreadId: input.authorThreadId } : {}),
        },
      });
      return {
        ok: true,
        issueId: issue.id,
        branch,
        reviewers,
        paths: names.value,
      } as const;
    } catch (e) {
      // PR 创建失败：feat 分支已 commit，但无 PR record 追踪 → 解除 worktree（分支保留供排查）。
      gitWorktreeUnregister(mainRepoDir(baseDir), wtPath);
      return {
        ok: false,
        code: "ISSUE_SERVICE",
        message: e instanceof Error ? e.message : String(e),
      } as const;
    }
  });
}

/** 解除 feat 分支 worktree（沉淀 finalize 后清理；分支保留供排查）。 */
export async function unregisterFeatWorktree(baseDir: string, branch: string): Promise<void> {
  const wtPath = featWorktreePath(baseDir, branch);
  gitWorktreeUnregister(mainRepoDir(baseDir), wtPath);
  await rm(wtPath, { recursive: true, force: true });
}
