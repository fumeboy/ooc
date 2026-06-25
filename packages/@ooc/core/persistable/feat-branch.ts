/**
 * reflectable / feat-branch PR 通道 —— stone 变更的合规沉淀路径。
 *
 * 设计权威：`.ooc-world-meta/.../children/reflectable/self.md`。
 *
 * 流程（super(foo) 内 agent 自驱动）：
 *   1. createFeatBranchWorktree({intent}) → 派生新 worktree (`.worktree/<slug>`) on
 *      feat-branch (`feat/<slug>`) from `stones/main`
 *   2. agent 在 worktree 内编辑文件（write_file / create_object 等）
 *   3. commitFeatAndOpenPR({intent, reviewerObjectIds}) → commit + create PR object 投递给
 *      reviewer 们的 thread context
 *   4. reviewer 在 pr window 上 comment/approve/reject
 *   5. all approved → mergeFeatBranch() → ff-merge 进 stones/main + worktree remove
 *
 * 当前最小：步骤 1 + 3（worktree + PR 创建）。merge / cleanup 留待 reviewer 流程跑通后再补。
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  gitBranchCreate,
  gitCommitAll,
  gitCurrentBranch,
  gitDiffPatch,
  gitInit,
  gitMergeFastForward,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreeRemove,
} from "./git.js";

/** 设置 repo-local git config（保证 commit 可生成）。 */
function ensureGitConfig(cwd: string): void {
  spawnSync("git", ["config", "user.name", "OOC Worker"], { cwd });
  spawnSync("git", ["config", "user.email", "ooc@worker.local"], { cwd });
}

/** intent 文本转 slug（短 kebab-case）。 */
export function slugFromIntent(intent: string): string {
  const slug = intent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || `feat-${Date.now().toString(36)}`;
}

export interface CreateFeatBranchWorktreeInput {
  baseDir: string;
  intent: string;
}

export interface CreateFeatBranchWorktreeResult {
  ok: boolean;
  branch: string;
  worktreePath: string;
  error?: string;
}

/**
 * 派生一个 feat-branch worktree —— `.worktree/<slug>` 切到 `feat/<slug>` from `stones/main`。
 *
 * 前置：stones/main 必须是个 git 仓库。如不是，先 `gitInit` 兜底。
 */
export async function createFeatBranchWorktree(
  input: CreateFeatBranchWorktreeInput,
): Promise<CreateFeatBranchWorktreeResult> {
  const stonesMain = join(input.baseDir, "stones", "main");
  await mkdir(stonesMain, { recursive: true });

  // 确保 git init + 初始 commit + main 分支（idempotent）。
  const isRepo = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: stonesMain }).status === 0;
  if (!isRepo) {
    const ig = gitInit(stonesMain);
    if (!ig.ok && !ig.stderr.includes("Reinitialized")) {
      return { ok: false, branch: "", worktreePath: "", error: `git init failed: ${ig.stderr}` };
    }
  }
  ensureGitConfig(stonesMain);
  const hasInitialCommit =
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: stonesMain }).status === 0;
  if (!hasInitialCommit) {
    await writeFile(join(stonesMain, ".gitkeep"), "", "utf8");
    const initial = gitCommitAll(stonesMain, "initial");
    if (!initial.ok) {
      return {
        ok: false,
        branch: "",
        worktreePath: "",
        error: `initial commit failed: ${initial.stderr || initial.stdout}`,
      };
    }
  }
  // 确保在 main 分支上
  const cur = gitCurrentBranch(stonesMain);
  if (cur && cur !== "main") {
    spawnSync("git", ["branch", "-M", "main"], { cwd: stonesMain });
  }

  const slug = slugFromIntent(input.intent);
  const branch = `feat/${slug}`;
  const worktreePath = join(input.baseDir, ".worktree", slug);
  await mkdir(join(input.baseDir, ".worktree"), { recursive: true });
  const list = gitWorktreeList(stonesMain);
  if (list.stdout.includes(worktreePath)) {
    return { ok: false, branch, worktreePath, error: `worktree exists: ${worktreePath}` };
  }
  const add = gitWorktreeAdd(stonesMain, worktreePath, branch, "main");
  if (!add.ok) {
    return { ok: false, branch, worktreePath, error: `worktree add failed: ${add.stderr}` };
  }
  return { ok: true, branch, worktreePath };
}

export interface CommitFeatInput {
  baseDir: string;
  worktreePath: string;
  message: string;
}

export interface CommitFeatResult {
  ok: boolean;
  diff: string;
  error?: string;
}

/** 在 worktree 内 `git add -A && git commit -m <message>`；返回与 main 的 diff。 */
export function commitFeatAndDiff(input: CommitFeatInput): CommitFeatResult {
  ensureGitConfig(input.worktreePath);
  const c = gitCommitAll(input.worktreePath, input.message);
  if (!c.ok && !c.stderr.includes("nothing to commit")) {
    return { ok: false, diff: "", error: c.stderr };
  }
  // diff 在 worktree 自己 cwd 跑（看 worktree HEAD vs main）
  const diff = gitDiffPatch(input.worktreePath, "main", "HEAD");
  return { ok: true, diff: diff.stdout };
}

export interface MergeFeatInput {
  baseDir: string;
  branch: string;
  worktreePath: string;
}

/** ff-merge feat-branch 进 stones/main + 清 worktree。 */
export function mergeFeatBranch(input: MergeFeatInput): { ok: boolean; error?: string } {
  const stonesMain = join(input.baseDir, "stones", "main");
  // 切到 main
  const merge = gitMergeFastForward(stonesMain, input.branch);
  if (!merge.ok) {
    return { ok: false, error: `merge failed: ${merge.stderr}` };
  }
  // 清 worktree
  const rm = gitWorktreeRemove(stonesMain, input.worktreePath, true);
  if (!rm.ok) {
    return { ok: false, error: `worktree remove failed: ${rm.stderr}` };
  }
  return { ok: true };
}

/** 读 worktree 内一个文件（reflectable 编辑场景的辅助）。 */
export async function readWorktreeFile(worktreePath: string, relPath: string): Promise<string | undefined> {
  try {
    return await readFile(join(worktreePath, relPath), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** 写 worktree 内一个文件。 */
export async function writeWorktreeFile(
  worktreePath: string,
  relPath: string,
  content: string,
): Promise<void> {
  const full = join(worktreePath, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content, "utf8");
}
