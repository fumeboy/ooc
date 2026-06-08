/**
 * git CLI 薄包装 —— U3 实现，仅 stone-versioning 内部调用。
 *
 * 设计原则：
 * - 不引入 git npm 依赖；用 `Bun.spawnSync` 同步调用 git CLI（与
 *   `src/executable/windows/root/method.grep.impl.ts` / `src/executable/program/shell.ts` 同款）
 * - 每个函数 cwd 参数化；不修改 git 全局 config（commit author 走 per-call `-c` 注入）
 * - 失败永远返回 `{ ok: false, code, stderr }`，不抛错（`docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md`）
 * - 严格输入校验：branch / path / objectId 等 user-controlled string reject
 *   `..`、控制字符、空字符串、过长、非法字符
 *
 * Caller serialization：所有 git 子命令应通过 `enqueueSessionWrite("git:" + repoDir, ...)`
 * 串行化（详见 stone-versioning.ts），保证同 repo 内 git 命令不交错。
 */

import { rmSync } from "node:fs";
import { join } from "node:path";

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;
const SHA_PATTERN = /^[a-f0-9]{4,40}$/;

/** git 命令统一返回类型。 */
export type GitResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; code: GitErrorCode; stderr: string };

/** 已知错误码集合，便于上层做明确分支处理。 */
export type GitErrorCode =
  | "INVALID_INPUT"
  | "NON_FAST_FORWARD"
  | "REBASE_CONFLICT"
  | "BRANCH_EXISTS"
  | "BRANCH_NOT_FOUND"
  | "WORKTREE_EXISTS"
  | "WORKTREE_NOT_FOUND"
  | "NOT_A_REPO"
  | "GIT_GENERIC";

/** 校验 git ref / branch 名（拒 `..` / 空 / 控制字符 / 非法字符）。 */
export function isValidBranchName(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 200) return false;
  if (!BRANCH_NAME_PATTERN.test(value)) return false;
  if (value.includes("..")) return false;
  if (value.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return false;
  if (value.endsWith(".lock") || value.endsWith("/")) return false;
  return true;
}

interface SpawnOk {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runRaw(repoDir: string, args: string[]): SpawnOk {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: new TextDecoder().decode(proc.stdout ?? new Uint8Array()),
    stderr: new TextDecoder().decode(proc.stderr ?? new Uint8Array()),
  };
}

function failGeneric(stderr: string): { ok: false; code: GitErrorCode; stderr: string } {
  return { ok: false, code: "GIT_GENERIC", stderr: stderr.trim() };
}

function failInput(message: string): { ok: false; code: GitErrorCode; stderr: string } {
  return { ok: false, code: "INVALID_INPUT", stderr: message };
}

/* ---------- repo 基础 ---------- */

/** 在 `repoDir` 处 git init -b <branch>。 */
export function gitInit(repoDir: string, branch: string = "main"): GitResult {
  if (!isValidBranchName(branch)) return failInput(`invalid branch '${branch}'`);
  const r = runRaw(repoDir, ["init", "-b", branch]);
  if (r.exitCode !== 0) return failGeneric(r.stderr);
  return { ok: true };
}

/** 当前 HEAD 所在分支名；HEAD 未生根返回 ok:true value:"". */
export function gitCurrentBranch(repoDir: string): GitResult<string> {
  const r = runRaw(repoDir, ["symbolic-ref", "--short", "HEAD"]);
  if (r.exitCode !== 0) {
    // HEAD detached or unborn — 不算错误
    return { ok: true, value: "" };
  }
  return { ok: true, value: r.stdout.trim() };
}

/** HEAD 当前 sha；未生根返回 ok:true value:"". */
export function gitHead(repoDir: string): GitResult<string> {
  const r = runRaw(repoDir, ["rev-parse", "HEAD"]);
  if (r.exitCode !== 0) return { ok: true, value: "" };
  return { ok: true, value: r.stdout.trim() };
}

/** 解析 ref 到 sha；ref 不存在返回 INVALID_INPUT。 */
export function gitRevParse(repoDir: string, ref: string): GitResult<string> {
  if (typeof ref !== "string" || ref.length === 0) return failInput("empty ref");
  const r = runRaw(repoDir, ["rev-parse", "--verify", ref]);
  if (r.exitCode !== 0) return failInput(`unknown ref '${ref}'`);
  return { ok: true, value: r.stdout.trim() };
}

/**
 * porcelain status 文本（caller 自行 parse）。空字符串表示工作树干净。
 * `--untracked-files=all` 把未跟踪**目录**展开成逐个文件（否则 git 折叠成 `dir/`），
 * 让 caller（evolve_self diff）能列到文件粒度。
 */
export function gitStatus(repoDir: string): GitResult<string> {
  const r = runRaw(repoDir, ["status", "--porcelain", "--untracked-files=all"]);
  if (r.exitCode !== 0) return failGeneric(r.stderr);
  return { ok: true, value: r.stdout };
}

/* ---------- diff / log ---------- */

/**
 * 列出两个 ref 之间累积 diff 涉及的文件路径（git diff --name-only baseRef...headRef）。
 * 三点 `...` 语义：列出 headRef 相对于两者 merge-base 的修改，跟 PR/merge-request 语义一致。
 */
export function gitDiffNames(repoDir: string, baseRef: string, headRef: string): GitResult<string[]> {
  if (typeof baseRef !== "string" || baseRef.length === 0) return failInput("empty baseRef");
  if (typeof headRef !== "string" || headRef.length === 0) return failInput("empty headRef");
  const r = runRaw(repoDir, ["diff", "--name-only", `${baseRef}...${headRef}`]);
  if (r.exitCode !== 0) return failGeneric(r.stderr);
  const value = r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return { ok: true, value };
}

/**
 * git format-patch 等价的 patch 文本：返回 baseRef..headRef 范围内每条 commit 的 patch
 * 拼成的 unified diff 字符串。供 PR-Issue payload 使用。
 */
export function gitDiffPatch(repoDir: string, baseRef: string, headRef: string): GitResult<string> {
  const r = runRaw(repoDir, ["diff", "--patch", `${baseRef}...${headRef}`]);
  if (r.exitCode !== 0) return failGeneric(r.stderr);
  return { ok: true, value: r.stdout };
}

/* ---------- commit ---------- */

export interface CommitInput {
  authorName: string;
  authorEmail: string;
  message: string;
  /** allow-empty：当工作树没有内容变化时也产出 commit（bootstrap 用）。 */
  allowEmpty?: boolean;
}

/**
 * stage 全部变更并以指定 author 提交。Per-call `-c user.name=... -c user.email=...`
 * 注入，不污染全局 git config。返回新 commit 的 sha。
 *
 * 注意：caller 负责自己 stage（add）—— 这里只 commit 已 stage 的内容。如需自动 add-all，
 * caller 自己跑 `runRaw(repoDir, ["add", "-A"])`，或用 `gitCommitAll` 便捷函数。
 */
export function gitCommit(repoDir: string, input: CommitInput): GitResult<string> {
  if (!input.authorName.trim()) return failInput("authorName required");
  if (!input.authorEmail.trim()) return failInput("authorEmail required");
  if (!input.message.trim()) return failInput("commit message required");

  const args = [
    "-c",
    `user.name=${input.authorName}`,
    "-c",
    `user.email=${input.authorEmail}`,
    "commit",
    "-m",
    input.message,
  ];
  if (input.allowEmpty) args.push("--allow-empty");
  const r = runRaw(repoDir, args);
  if (r.exitCode !== 0) return failGeneric(r.stderr);

  const head = gitHead(repoDir);
  if (!head.ok) return head;
  return { ok: true, value: head.value };
}

/** stage 全部变更后 commit。便利函数。 */
export function gitCommitAll(repoDir: string, input: CommitInput): GitResult<string> {
  const add = runRaw(repoDir, ["add", "-A"]);
  if (add.exitCode !== 0) return failGeneric(add.stderr);
  return gitCommit(repoDir, input);
}

/* ---------- branch ---------- */

/** 创建分支：`git branch <name> <baseRef>`. */
export function gitBranchCreate(repoDir: string, name: string, baseRef: string): GitResult {
  if (!isValidBranchName(name)) return failInput(`invalid branch name '${name}'`);
  if (typeof baseRef !== "string" || baseRef.length === 0) return failInput("empty baseRef");
  const r = runRaw(repoDir, ["branch", name, baseRef]);
  if (r.exitCode !== 0) {
    if (r.stderr.includes("already exists")) {
      return { ok: false, code: "BRANCH_EXISTS", stderr: r.stderr.trim() };
    }
    return failGeneric(r.stderr);
  }
  return { ok: true };
}

/** 删除分支（强制）。 */
export function gitBranchDelete(repoDir: string, name: string): GitResult {
  if (!isValidBranchName(name)) return failInput(`invalid branch name '${name}'`);
  const r = runRaw(repoDir, ["branch", "-D", name]);
  if (r.exitCode !== 0) {
    if (r.stderr.includes("not found")) {
      return { ok: false, code: "BRANCH_NOT_FOUND", stderr: r.stderr.trim() };
    }
    return failGeneric(r.stderr);
  }
  return { ok: true };
}

/* ---------- worktree ---------- */

export interface WorktreeAddInput {
  path: string;
  branch: string;
  baseRef: string;
}

export interface WorktreeEntry {
  path: string;
  branch?: string;
  head?: string;
  isDetached: boolean;
  isLocked: boolean;
}

/** `git worktree add <path> -b <branch> <baseRef>`. */
export function gitWorktreeAdd(repoDir: string, input: WorktreeAddInput): GitResult {
  if (typeof input.path !== "string" || input.path.length === 0) return failInput("empty path");
  if (input.path.includes("..") || input.path.includes("\0")) return failInput(`unsafe path '${input.path}'`);
  if (!isValidBranchName(input.branch)) return failInput(`invalid branch '${input.branch}'`);

  const r = runRaw(repoDir, ["worktree", "add", input.path, "-b", input.branch, input.baseRef]);
  if (r.exitCode !== 0) {
    if (r.stderr.includes("already exists") || r.stderr.includes("already used")) {
      return { ok: false, code: "WORKTREE_EXISTS", stderr: r.stderr.trim() };
    }
    return failGeneric(r.stderr);
  }
  return { ok: true };
}

/** `git worktree remove <path>` (强制)。 */
export function gitWorktreeRemove(repoDir: string, path: string, force: boolean = true): GitResult {
  if (typeof path !== "string" || path.length === 0) return failInput("empty path");
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(path);
  const r = runRaw(repoDir, args);
  if (r.exitCode !== 0) {
    if (r.stderr.includes("not a working tree") || r.stderr.includes("does not exist")) {
      return { ok: false, code: "WORKTREE_NOT_FOUND", stderr: r.stderr.trim() };
    }
    return failGeneric(r.stderr);
  }
  return { ok: true };
}

/**
 * 解除 worktree 注册但**保留目录与文件内容**（方案 A：session worktree 物理合一专用 GC）。
 *
 * session worktree 物理就是 `flows/<sid>/`，与运行时数据（threads / .session.json / .flow.json）
 * 共存。合入后若用 `gitWorktreeRemove --force` 会连运行时对话历史一并删 → session 在前端凭空消失。
 * 改为：删 `<wtPath>/.git` link 文件解除 worktree 身份 + `git worktree prune` 清 bare repo stale
 * 注册；**目录与运行时数据保留**（session 仍可见、可回看）。tracked 的 objects/ 旧副本留下无害——
 * worktree 解除后该 session 的 stone read 透传 main canonical（isSessionWorktree 判 .git 已不存在）。
 */
export function gitWorktreeUnregister(repoDir: string, wtPath: string): GitResult {
  if (typeof wtPath !== "string" || wtPath.length === 0) return failInput("empty path");
  // 删 .git link 解除 worktree 身份。不存在（已解除 / 从未建）= 幂等成功。
  try {
    rmSync(join(wtPath, ".git"), { force: true });
  } catch {
    // fs 错不阻塞 prune；prune 自身会反映 bare repo 侧的清理结果。
  }
  return gitWorktreePrune(repoDir);
}

/** `git worktree list --porcelain` 解析。 */
export function gitWorktreeList(repoDir: string): GitResult<WorktreeEntry[]> {
  const r = runRaw(repoDir, ["worktree", "list", "--porcelain"]);
  if (r.exitCode !== 0) return failGeneric(r.stderr);
  const entries: WorktreeEntry[] = [];
  let cur: Partial<WorktreeEntry> | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) entries.push(finalizeWorktreeEntry(cur));
      cur = { path: line.slice("worktree ".length).trim(), isDetached: false, isLocked: false };
    } else if (cur && line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length).trim();
    } else if (cur && line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (cur && line === "detached") {
      cur.isDetached = true;
    } else if (cur && line === "locked") {
      cur.isLocked = true;
    }
  }
  if (cur) entries.push(finalizeWorktreeEntry(cur));
  return { ok: true, value: entries };
}

function finalizeWorktreeEntry(p: Partial<WorktreeEntry>): WorktreeEntry {
  return {
    path: p.path ?? "",
    branch: p.branch,
    head: p.head,
    isDetached: p.isDetached ?? false,
    isLocked: p.isLocked ?? false,
  };
}

/** `git worktree prune`（清掉 admin 文件 stale 记录）。 */
export function gitWorktreePrune(repoDir: string): GitResult {
  const r = runRaw(repoDir, ["worktree", "prune"]);
  if (r.exitCode !== 0) return failGeneric(r.stderr);
  return { ok: true };
}

/* ---------- rebase / merge ---------- */

/** rebase 当前 HEAD 到 ontoRef。冲突时 abort 并返回 REBASE_CONFLICT，不留 dirty 工作树。 */
export function gitRebase(repoDir: string, ontoRef: string): GitResult {
  if (typeof ontoRef !== "string" || ontoRef.length === 0) return failInput("empty ontoRef");
  const r = runRaw(repoDir, ["rebase", ontoRef]);
  if (r.exitCode !== 0) {
    // abort 让工作树回到 rebase 前状态；忽略 abort 自身的 exit code
    runRaw(repoDir, ["rebase", "--abort"]);
    if (r.stderr.includes("CONFLICT") || r.stderr.includes("conflict")) {
      return { ok: false, code: "REBASE_CONFLICT", stderr: r.stderr.trim() };
    }
    return failGeneric(r.stderr);
  }
  return { ok: true };
}

/**
 * fast-forward only merge：把 branch 合到当前分支。non-FF 直接返回 NON_FAST_FORWARD。
 */
export function gitMergeFastForward(repoDir: string, branch: string): GitResult {
  if (!isValidBranchName(branch)) return failInput(`invalid branch '${branch}'`);
  const r = runRaw(repoDir, ["merge", "--ff-only", branch]);
  if (r.exitCode !== 0) {
    if (r.stderr.includes("Not possible to fast-forward") || r.stderr.includes("not a fast-forward")) {
      return { ok: false, code: "NON_FAST_FORWARD", stderr: r.stderr.trim() };
    }
    return failGeneric(r.stderr);
  }
  return { ok: true };
}

/** checkout 到指定 ref / branch（典型在 main 上做 ff merge 前）。 */
export function gitCheckout(repoDir: string, ref: string): GitResult {
  if (typeof ref !== "string" || ref.length === 0) return failInput("empty ref");
  const r = runRaw(repoDir, ["checkout", ref]);
  if (r.exitCode !== 0) return failGeneric(r.stderr);
  return { ok: true };
}

/* ---------- archive (R8 reject 时的 branch 存档) ---------- */

/**
 * 把 branch 移到 `refs/ooc/rejected/{branch}` 并删除原 branch ref。
 * Object 后续仍可以用 archived ref 来 diff 看自己被 reject 的修改。
 */
export function gitArchiveBranch(repoDir: string, branch: string): GitResult {
  if (!isValidBranchName(branch)) return failInput(`invalid branch '${branch}'`);
  const sha = gitRevParse(repoDir, branch);
  if (!sha.ok) return sha;
  const archive = runRaw(repoDir, ["update-ref", `refs/ooc/rejected/${branch}`, sha.value]);
  if (archive.exitCode !== 0) return failGeneric(archive.stderr);
  const del = gitBranchDelete(repoDir, branch);
  if (!del.ok) return del;
  return { ok: true };
}

/** 给定 baseRef 与 headRef，返回 merge-base sha。 */
export function gitMergeBase(repoDir: string, baseRef: string, headRef: string): GitResult<string> {
  const r = runRaw(repoDir, ["merge-base", baseRef, headRef]);
  if (r.exitCode !== 0) return failGeneric(r.stderr);
  return { ok: true, value: r.stdout.trim() };
}

/* ---------- 内部 helper（test 可见） ---------- */

export const __testing = {
  isValidSha(value: string) {
    return SHA_PATTERN.test(value);
  },
  runRaw,
};
