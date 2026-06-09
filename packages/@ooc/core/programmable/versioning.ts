/**
 * stone-versioning —— 高层编排，把 worktree commit / scope 评估 / merge /
 * PR-Issue / rollback / GC 收口在 persistable 层。
 *
 * 去 metaprog（2026-06-09，docs/2026-06-09-remove-metaprog-unify-session-worktree-design.md）：
 * 删除并行的 metaprog worktree 写路径（openMetaprogWorktree / supervisorCreateObject /
 * versionedStoneWrite）。stone 写只剩两个落点——
 * - **LLM session 内任何 stone 写**（改自己 + 改别人/建别人）落业务 session 的 worktree
 *   （方案 A：物理 `flows/<sid>/`、branch `session-<sid>`，plain write），经 super flow
 *   `evolve_self` 合入 main。
 * - **HTTP 控制面写**（人类已决策）经 `httpDirectMainWrite` 直写 `stones/main/` 并 commit。
 *
 * Caller 视角（保留的底层原语，供上述两路 + 治理复用）：
 * - `commitWorktree(ref, { intent, authorObjectId })` stage 全部并 commit
 * - `tryMergeSelf(ref, authorObjectId)` 尝试 self-scope ff merge：rebase 到 main
 *   HEAD → 路径分类 → 全在自治区则 ff，否则 must-pr-issue（caller 转 requestPrIssueReview）
 * - `requestPrIssueReview(ref, { intent, authorObjectId })` 在 super session 创 PR-Issue
 * - `resolvePrIssue(opts)` 让 Supervisor 的决议生效
 * - `rollback(opts)` Supervisor 署名回滚
 * - `httpDirectMainWrite(input)` 控制面写直写 main 并 commit
 * - `pruneStaleWorktrees(baseDir)` 启动 hygiene
 *
 * 所有 git 子命令通过 `enqueueSessionWrite("git:" + baseDir, ...)` 串行化。
 *
 * Supervisor 对称化：supervisor 走与其它 Object 完全相同的合入路径——session worktree
 * → super flow evolve_self。改动落在 `objects/supervisor/` 下为 self-scope（ff merge），
 * 跨自治区为 cross-scope 自动开 PR-Issue。**supervisor 评审自己的 PR-Issue 是合法的**
 * （自审是治理责任的一部分）。唯一保留的特权是 `rollback`（只 supervisor 可调）。
 * supervisor 与 user 都是 Builtin Object（`packages/@ooc/builtins/{supervisor,user}`），
 * 随 OOC 代码仓发版，Agent 不可改写。
 */

import { mkdir, rm, rmdir, stat, writeFile, cp } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { createStoneObject, stoneDir, stoneKnowledgeDir } from "../persistable/stone-object.js";
import { writeSelf } from "../persistable/stone-self.js";
import { writeReadable } from "../persistable/stone-readme.js";
import {
  gitArchiveBranch,
  gitCheckout,
  gitCommit,
  gitCommitAll,
  gitCurrentBranch,
  gitDiffNames,
  gitDiffPatch,
  gitHead,
  gitMergeFastForward,
  gitRebase,
  gitRevParse,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreePrune,
  gitWorktreeRemove,
  gitWorktreeUnregister,
  isValidBranchName,
  type GitErrorCode,
  type GitResult,
} from "./git.js";
import { closePrIssue, createPrIssue, readPrIssue, type PrIssueRecord } from "../persistable/pr-issue.js";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";
import {
  nestedObjectPath,
  isBuiltinObjectId,
  STONE_OBJECTS_SUBDIR,
  STONES_MAIN_BRANCH,
  SESSION_BRANCH_PREFIX,
} from "../persistable/common.js";

/** Supervisor 的 objectId（治理身份：rollback 仅 supervisor 可调；PR-Issue 默认收件人）。 */
export const SUPERVISOR_OBJECT_ID = "supervisor";

/** worktree branch 命名约定：`metaprog/{objectId}/{token}`（{token} 由 caller 提供或自动生成）。 */
const WORKTREE_BRANCH_PREFIX = "metaprog";

/**
 * worktree 移除后 GC 空父目录（2026-06-07）。
 *
 * `git worktree remove` 只删 worktree 目录本身（`stones/metaprog/<id>/<token>`），留下空的父路径段
 * `stones/metaprog/<id>/`（甚至 `stones/metaprog/`）。本函数从 worktree 父目录起逐级 `rmdir`，只删空目录、
 * 到 `stones/metaprog/` 即止（不碰 `stones/`）。best-effort：rmdir 遇非空/不存在即停。
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
 * 后序清扫整个 `stones/metaprog/` 子树里的空目录（启动 hygiene，2026-06-07）。
 *
 * 用于回收历史遗留：旧版 worktree 移除未 GC 父目录、或非正常退出留下的空 `metaprog/<id>/`。
 * 自底向上 rmdir，只删空目录；`stones/metaprog/` 自身若清空也一并删除（取代旧的空目录残留）。
 * best-effort：任何 rmdir 失败（非空/竞态）静默跳过。
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

export interface MetaprogWorktreeRef {
  /** OOC world 根。 */
  baseDir: string;
  /** worktree 的发起 Object（main-side authorObjectId）。 */
  objectId: string;
  /** worktree 对应的 git branch 名（即 `${WORKTREE_BRANCH_PREFIX}/${objectId}/${token}`）。 */
  branch: string;
  /** worktree 在磁盘上的绝对路径（`${baseDir}/stones/${branch}`）。 */
  path: string;
  /** 创建时 main 当前 commit sha（资料用，merge 时通过 gitMergeBase 重新解析）。 */
  baseCommit: string;
}

/** 主仓库（main 工作树）目录，所有 git 操作的 cwd。 */
function repoDir(baseDir: string): string {
  return join(baseDir, "stones", STONES_MAIN_BRANCH);
}

/**
 * worktree branch 名 → 磁盘物理路径。session 分支（`session-<sid>`）落 `flows/<sid>`
 * （方案 A，2026-06-09，与 sessionWorktreePath / stoneDir 对齐）；其余 branch（metaprog
 * 残留等）仍走 `stones/<branch>`。resolvePrIssue 的 worktree GC 依赖本映射定位真 worktree。
 */
function worktreePath(baseDir: string, branch: string): string {
  if (branch.startsWith(SESSION_BRANCH_PREFIX)) {
    const sid = branch.slice(SESSION_BRANCH_PREFIX.length);
    return join(baseDir, "flows", sid);
  }
  return join(baseDir, "stones", branch);
}

/** caller-supplied scope-key 用于串行化所有同一 baseDir 上的 git 操作。 */
function gitQueueKey(baseDir: string): string {
  return `git:${baseDir}`;
}

/** 生成短随机 token —— Date.now base36 + 4 位随机，避免外部依赖。 */
function generateToken(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${t}${r}`;
}

/** 单段 objectId 合法字符（同原 isValidObjectId：不含 `/`）。 */
const OBJECT_ID_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/**
 * 校验 objectId（含嵌套 child：`parent/child`、`a/b/c`）。
 *
 * 嵌套语义（task#16）：objectId 用 `/` 编码父子层级，物理落点经 nestedObjectPath
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
 * self-scope 自治区路径前缀。对嵌套 child 必须基于物理布局（nestedObjectPath），
 * 而非直拼 `objects/${objectId}/`：
 *   - flat `agent_of_x`   → `objects/agent_of_x/`
 *   - nested `parent/child` → `objects/parent/children/child/`（物理路径）
 *
 * 直拼会让 nested child 改自己（物理在 objects/parent/children/child/）被误判为
 * cross-scope。parent 的前缀 `objects/parent/` 仍正确覆盖整棵子树（含
 * children/），故 parent 改 child 自动落 self-scope。
 */
function selfScopePrefix(authorObjectId: string): string {
  return `objects/${nestedObjectPath(authorObjectId).join("/")}/`;
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
  worktree: MetaprogWorktreeRef;
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
 * classifyWorktreeBranch
 * ---------------------------------------------------------------- */

export type ScopeClass = "self-scope" | "cross-scope";

export interface ClassifyResult {
  ok: true;
  scope: ScopeClass;
  /** branch 累积 diff vs main merge-base 的文件路径列表。 */
  paths: string[];
}

export type ClassifyError =
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string };

/**
 * 路径划界判定：branch 累积 diff vs main merge-base，每个文件路径必须以
 * `selfScopePrefix(authorObjectId)` 起头才算 self-scope（R5/R6）。前缀对嵌套 child
 * 基于物理布局（nestedObjectPath：`objects/parent/children/child/`），直拼会误判。
 * supervisor 走同款路径判定——改自己 stones 是 self-scope（ff），改他人 stones 是
 * cross-scope（自动开 PR-Issue，可由 supervisor 自审）。
 */
export async function classifyWorktreeBranch(
  worktree: MetaprogWorktreeRef,
  authorObjectId: string,
): Promise<ClassifyResult | ClassifyError> {
  if (!isValidObjectId(authorObjectId)) {
    return { ok: false, code: "INVALID_INPUT", message: `invalid authorObjectId '${authorObjectId}'` };
  }

  return enqueueSessionWrite(gitQueueKey(worktree.baseDir), async () => {
    const repo = repoDir(worktree.baseDir);
    const r = gitDiffNames(repo, STONES_MAIN_BRANCH, worktree.branch);
    if (!r.ok) return { ok: false, code: "GIT", gitCode: r.code, stderr: r.stderr } as const;
    // 自治区路径 = nestedObjectPath(authorObjectId) 物理前缀（嵌套 child 经 children/ 翻译）。
    const prefix = selfScopePrefix(authorObjectId);
    const scope: ScopeClass = r.value.every((p) => p.startsWith(prefix)) ? "self-scope" : "cross-scope";
    return { ok: true, scope, paths: r.value } as const;
  });
}

/* ---------------------------------------------------------------- *
 * tryMergeSelf
 * ---------------------------------------------------------------- */

export type TryMergeSelfResult =
  | { ok: true; kind: "merged"; commitSha: string }
  | { ok: true; kind: "must-pr-issue"; paths: string[] }
  | { ok: true; kind: "rebase-conflict"; stderr: string }
  | { ok: true; kind: "non-fast-forward"; stderr: string }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string };

/**
 * 尝试自治区 fast-forward merge。流程：
 *   1. cd worktree → rebase main HEAD（冲突 abort 后返回 rebase-conflict）
 *   2. 重新 classify（rebase 后 path 集合可能变化）
 *   3. cross-scope → 返回 must-pr-issue（caller 应转 requestPrIssueReview）
 *   4. self-scope → 在 main 上 ff merge worktree branch；non-FF 返回 non-fast-forward
 *      （正常情况下 rebase 后必能 FF；non-FF 表示 main 又飘了，caller 应重试）
 *   5. 成功 ff → cleanup worktree
 */
export async function tryMergeSelf(
  worktree: MetaprogWorktreeRef,
  authorObjectId: string,
): Promise<TryMergeSelfResult> {
  if (!isValidObjectId(authorObjectId)) {
    return { ok: false, code: "INVALID_INPUT", message: `invalid authorObjectId '${authorObjectId}'` };
  }

  return enqueueSessionWrite(gitQueueKey(worktree.baseDir), async () => {
    const repo = repoDir(worktree.baseDir);
    // step 1: rebase
    const rebase = gitRebase(worktree.path, STONES_MAIN_BRANCH);
    if (!rebase.ok) {
      if (rebase.code === "REBASE_CONFLICT") {
        return { ok: true, kind: "rebase-conflict", stderr: rebase.stderr } as const;
      }
      return { ok: false, code: "GIT", gitCode: rebase.code, stderr: rebase.stderr } as const;
    }

    // step 2: classify
    const diff = gitDiffNames(repo, STONES_MAIN_BRANCH, worktree.branch);
    if (!diff.ok) return { ok: false, code: "GIT", gitCode: diff.code, stderr: diff.stderr } as const;
    const prefix = selfScopePrefix(authorObjectId);
    const isSelf = diff.value.every((p) => p.startsWith(prefix));
    if (!isSelf) {
      return { ok: true, kind: "must-pr-issue", paths: diff.value } as const;
    }

    // step 3: ff merge in repo (main work-tree)
    const checkoutMain = gitCheckout(repo, STONES_MAIN_BRANCH);
    if (!checkoutMain.ok) {
      return { ok: false, code: "GIT", gitCode: checkoutMain.code, stderr: checkoutMain.stderr } as const;
    }
    const ff = gitMergeFastForward(repo, worktree.branch);
    if (!ff.ok) {
      if (ff.code === "NON_FAST_FORWARD") {
        return { ok: true, kind: "non-fast-forward", stderr: ff.stderr } as const;
      }
      return { ok: false, code: "GIT", gitCode: ff.code, stderr: ff.stderr } as const;
    }

    await syncMergedObjectToPackages(worktree.baseDir, authorObjectId);

    const head = gitHead(repo);
    if (!head.ok) return { ok: false, code: "GIT", gitCode: head.code, stderr: head.stderr } as const;

    // step 4: cleanup worktree（解除注册，保留运行时数据；session worktree=flows/<sid> 物理合一）
    const removeWt = gitWorktreeUnregister(repo, worktree.path);
    // silent-swallow ban: 失败不阻塞 ff 成功，但必须 warn 让运维知情（caller 可下次启动 prune）
    if (!removeWt.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[stone-versioning] tryMergeSelf worktree cleanup failed branch=${worktree.branch} stderr=${removeWt.stderr}`,
      );
    }
    await gcEmptyWorktreeParents(worktree.path, worktree.baseDir);
    return { ok: true, kind: "merged", commitSha: head.value } as const;
  });
}

/* ---------------------------------------------------------------- *
 * requestPrIssueReview
 * ---------------------------------------------------------------- */

export interface RequestPrIssueInput {
  worktree: MetaprogWorktreeRef;
  intent: string;
  authorObjectId: string;
  /** 可选的 PR 标题；缺省由 intent 前 60 字符构造。 */
  title?: string;
  /** 可选的扩展描述。 */
  description?: string;
}

export type RequestPrIssueResult =
  | { ok: true; issueId: number }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string }
  | { ok: false; code: "ISSUE_SERVICE"; message: string };

/**
 * 拿到 worktree branch 的 diff（vs main），构造 PrIssuePayload，调
 * `createPrIssue` 落到 super session。
 */
export async function requestPrIssueReview(input: RequestPrIssueInput): Promise<RequestPrIssueResult> {
  if (!isValidObjectId(input.authorObjectId)) {
    return { ok: false, code: "INVALID_INPUT", message: `invalid authorObjectId '${input.authorObjectId}'` };
  }
  if (!input.intent.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "intent required" };
  }

  return enqueueSessionWrite(gitQueueKey(input.worktree.baseDir), async () => {
    const repo = repoDir(input.worktree.baseDir);
    const head = gitHead(repo);
    if (!head.ok) return { ok: false, code: "GIT", gitCode: head.code, stderr: head.stderr } as const;
    const baseSha = head.value;

    const names = gitDiffNames(repo, STONES_MAIN_BRANCH, input.worktree.branch);
    if (!names.ok) return { ok: false, code: "GIT", gitCode: names.code, stderr: names.stderr } as const;

    const patch = gitDiffPatch(repo, STONES_MAIN_BRANCH, input.worktree.branch);
    if (!patch.ok) return { ok: false, code: "GIT", gitCode: patch.code, stderr: patch.stderr } as const;

    const title = (input.title ?? input.intent).slice(0, 80);
    try {
      const issue = await createPrIssue({
        baseDir: input.worktree.baseDir,
        title,
        description: input.description,
        createdByObjectId: input.authorObjectId,
        prPayload: {
          intent: input.intent,
          branch: input.worktree.branch,
          diff: patch.value,
          paths: names.value,
          baseSha,
        },
      });
      return { ok: true, issueId: issue.id } as const;
    } catch (e) {
      return {
        ok: false,
        code: "ISSUE_SERVICE",
        message: e instanceof Error ? e.message : String(e),
      } as const;
    }
  });
}

/* ---------------------------------------------------------------- *
 * resolvePrIssue
 * ---------------------------------------------------------------- */

export type PrIssueDecision = "merge" | "reject" | "request-changes";

export interface ResolvePrIssueInput {
  baseDir: string;
  issueId: number;
  decision: PrIssueDecision;
}

export type ResolvePrIssueResult =
  | { ok: true; kind: "merged"; commitSha: string }
  | { ok: true; kind: "rejected"; archivedRef: string }
  | { ok: true; kind: "changes-requested" }
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "INVALID_STATE"; message: string }
  | { ok: false; code: "GIT"; gitCode: GitErrorCode; stderr: string }
  | { ok: false; code: "ISSUE_SERVICE"; message: string };

/**
 * Supervisor 决议生效：
 * - merge → 在 main 上 ff-merge worktree branch；成功后关闭 Issue
 * - reject → archive branch 到 `refs/ooc/rejected/<branch>`，删原 branch + worktree；关闭 Issue
 * - request-changes → 不动 worktree，不关闭 Issue（caller 在 issue 上加 comment 通知 Object 重做）
 */
export async function resolvePrIssue(input: ResolvePrIssueInput): Promise<ResolvePrIssueResult> {
  return enqueueSessionWrite(gitQueueKey(input.baseDir), async () => {
    // 取出 PR-Issue
    let issue: PrIssueRecord | undefined;
    try {
      issue = await readPrIssue(input.baseDir, input.issueId);
    } catch (e) {
      return {
        ok: false,
        code: "ISSUE_SERVICE",
        message: e instanceof Error ? e.message : String(e),
      } as const;
    }
    if (!issue) {
      return { ok: false, code: "NOT_FOUND", message: `PR-Issue #${input.issueId} not found` } as const;
    }
    if (!issue.prPayload) {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: `Issue #${input.issueId} is not a PR-Issue (missing prPayload)`,
      } as const;
    }
    if (issue.status !== "open") {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: `PR-Issue #${input.issueId} already ${issue.status}`,
      } as const;
    }

    const repo = repoDir(input.baseDir);
    const branch = issue.prPayload.branch;

    if (input.decision === "request-changes") {
      // 仅记录决议；caller 应另行 appendComment 通知发起 Object
      return { ok: true, kind: "changes-requested" } as const;
    }

    if (input.decision === "merge") {
      const checkoutMain = gitCheckout(repo, STONES_MAIN_BRANCH);
      if (!checkoutMain.ok) {
        return { ok: false, code: "GIT", gitCode: checkoutMain.code, stderr: checkoutMain.stderr } as const;
      }
      const ff = gitMergeFastForward(repo, branch);
      if (!ff.ok) return { ok: false, code: "GIT", gitCode: ff.code, stderr: ff.stderr } as const;

      const objectIds = extractObjectIdsFromPaths(issue.prPayload.paths);
      for (const oid of objectIds) {
        await syncMergedObjectToPackages(input.baseDir, oid);
      }

      const head = gitHead(repo);
      if (!head.ok) return { ok: false, code: "GIT", gitCode: head.code, stderr: head.stderr } as const;

      // cleanup worktree (best-effort) — silent-swallow ban: 失败 warn 但不阻塞 merge
      const rmMerge = gitWorktreeUnregister(repo, worktreePath(input.baseDir, branch));
      if (!rmMerge.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[stone-versioning] resolvePrIssue(merge) worktree remove failed branch=${branch} stderr=${rmMerge.stderr}`,
        );
      }
      const pruneMerge = gitWorktreePrune(repo);
      if (!pruneMerge.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[stone-versioning] resolvePrIssue(merge) worktree prune failed stderr=${pruneMerge.stderr}`,
        );
      }
      await gcEmptyWorktreeParents(worktreePath(input.baseDir, branch), input.baseDir);

      try {
        await closePrIssue({
          baseDir: input.baseDir,
          issueId: input.issueId,
        });
      } catch (e) {
        return {
          ok: false,
          code: "ISSUE_SERVICE",
          message: e instanceof Error ? e.message : String(e),
        } as const;
      }
      return { ok: true, kind: "merged", commitSha: head.value } as const;
    }

    // reject — silent-swallow ban: 失败 warn 但不阻塞 reject
    const rmReject = gitWorktreeUnregister(repo, worktreePath(input.baseDir, branch));
    if (!rmReject.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[stone-versioning] resolvePrIssue(reject) worktree remove failed branch=${branch} stderr=${rmReject.stderr}`,
      );
    }
    const pruneReject = gitWorktreePrune(repo);
    if (!pruneReject.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[stone-versioning] resolvePrIssue(reject) worktree prune failed stderr=${pruneReject.stderr}`,
      );
    }
    await gcEmptyWorktreeParents(worktreePath(input.baseDir, branch), input.baseDir);
    const archive = gitArchiveBranch(repo, branch);
    if (!archive.ok) {
      return { ok: false, code: "GIT", gitCode: archive.code, stderr: archive.stderr } as const;
    }
    try {
      await closePrIssue({
        baseDir: input.baseDir,
        issueId: input.issueId,
      });
    } catch (e) {
      return {
        ok: false,
        code: "ISSUE_SERVICE",
        message: e instanceof Error ? e.message : String(e),
      } as const;
    }
    return { ok: true, kind: "rejected", archivedRef: `refs/ooc/rejected/${branch}` } as const;
  });
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
   * Supervisor 身份；R4 例外允许其它 Object 实例化不动时 Supervisor 代签 commit。
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
 * Supervisor 主导回滚：把 main 上 `${objectId}/` 子树恢复到目标 commit 状态，
 * 并以 Supervisor 署名提交。
 *
 * R12 enforcement at persistable layer：本函数自身强制 supervisorAuthor ===
 * SUPERVISOR_OBJECT_ID（参考 R5 #28）。LLM 命令层 / HTTP route / 测试夹具的
 * caller 校验是补充防御，但 persistable 层是唯一可信防线——任何新入口（cron /
 * 工具脚本 / 未来子模块）调本函数时都自动得到边界保护。
 */
export async function rollback(input: RollbackInput): Promise<RollbackResult> {
  if (!isValidObjectId(input.objectId)) {
    return { ok: false, code: "INVALID_INPUT", message: `invalid objectId '${input.objectId}'` };
  }
  const supervisorAuthor = input.supervisorAuthor ?? SUPERVISOR_OBJECT_ID;
  if (!isValidObjectId(supervisorAuthor)) {
    return { ok: false, code: "INVALID_INPUT", message: `invalid supervisorAuthor '${supervisorAuthor}'` };
  }
  // R12 supervisor-only: persistable 层强制最深防御。治理 rollback 经控制面 HTTP 端点
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

    // git checkout {target} -- objects/{objectId}/  (2026-05-21 layout)
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
        // 物理路径不存在的 worktree（脏状态）—— 顺手清
        if (e.path === repo) continue;
        try {
          const stat = await import("node:fs/promises").then((m) => m.stat(e.path));
          // intentional: stat 仅作存在性探测，成功时无需进一步使用，下一轮迭代
          void stat;
        } catch {
          // intentional: 路径已不存在（ENOENT 等），记入 removed 让 caller 看到；
          // prune 会清掉对应 admin 文件
          removed.push(e.path);
        }
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
 * HTTP 控制面写 stone → **直接 commit main**（去 metaprog，2026-06-09）。
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
  generateToken,
  gitQueueKey,
  isValidObjectId,
  selfScopePrefix,
  worktreePath,
  repoDir,
};

// 强制把 rm 当作活跃符号，避免未来误删（pruneStaleWorktrees 实际可能扩展用之）
// intentional: silent-swallow ban 例外——这是 unused-import keep-alive，不是错误吞噬。
void rm;
