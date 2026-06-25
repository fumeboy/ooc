/**
 * git CLI 薄包装 —— 给 reflectable feat-branch PR 通道用。
 *
 * 设计：bun.spawnSync 直接调 git，捕获 stdout/stderr/exitCode。
 * 不做高级 git logic（rebase / 冲突解决）——那些归 reflectable 编排层。
 */
import { spawnSync } from "node:child_process";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function gitRun(args: string[], cwd: string): GitResult {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exitCode: r.status ?? -1,
  };
}

/** 在 cwd 初始化 git 仓库（如未初始化）；老版本 git 不支持 --initial-branch。 */
export function gitInit(cwd: string): GitResult {
  const r = gitRun(["init"], cwd);
  if (!r.ok) return r;
  // 显式重命名默认分支为 main（老 git 默认 master）
  gitRun(["symbolic-ref", "HEAD", "refs/heads/main"], cwd);
  return r;
}

/** 当前分支。 */
export function gitCurrentBranch(cwd: string): string {
  const r = gitRun(["branch", "--show-current"], cwd);
  return r.stdout.trim();
}

/** 当前 HEAD commit SHA。 */
export function gitHead(cwd: string): string {
  return gitRun(["rev-parse", "HEAD"], cwd).stdout.trim();
}

/** add 一切并 commit。 */
export function gitCommitAll(cwd: string, message: string): GitResult {
  const a = gitRun(["add", "-A"], cwd);
  if (!a.ok) return a;
  return gitRun(["commit", "-m", message], cwd);
}

/** 创建新分支并切过去。 */
export function gitBranchCreate(cwd: string, name: string, base?: string): GitResult {
  const args = base ? ["checkout", "-b", name, base] : ["checkout", "-b", name];
  return gitRun(args, cwd);
}

/** 列出 worktrees。 */
export function gitWorktreeList(cwd: string): GitResult {
  return gitRun(["worktree", "list", "--porcelain"], cwd);
}

/** 添加一个新的 git worktree（branch 派生 + 物理路径）。 */
export function gitWorktreeAdd(cwd: string, path: string, branch: string, base?: string): GitResult {
  const args = base ? ["worktree", "add", "-b", branch, path, base] : ["worktree", "add", path, branch];
  return gitRun(args, cwd);
}

/** 移除一个 worktree。 */
export function gitWorktreeRemove(cwd: string, path: string, force = false): GitResult {
  const args = ["worktree", "remove", path];
  if (force) args.push("--force");
  return gitRun(args, cwd);
}

/** 计算两 ref 的 diff（patch 文本）。 */
export function gitDiffPatch(cwd: string, fromRef: string, toRef: string): GitResult {
  return gitRun(["diff", fromRef, toRef], cwd);
}

/** fast-forward merge（仅 ff，冲突直接失败）。 */
export function gitMergeFastForward(cwd: string, target: string): GitResult {
  return gitRun(["merge", "--ff-only", target], cwd);
}
