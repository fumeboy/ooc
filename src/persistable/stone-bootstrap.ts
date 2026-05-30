/**
 * stones/ git 仓库 bootstrap —— 启动期一次性自检与初始化（bare repo + linked worktrees 模式）。
 *
 * 行为契约（详见 docs/plans/2026-05-20-001-feat-stones-git-versioning-plan.md U1）：
 *
 * 1. 旧布局自动迁移：若 `stones/` 下存在 `agent_of_*` / `supervisor` 等扁平
 *    Object 目录，自动 `mv` 到 `stones/main/` 内。
 * 2. bare repo 初始化：若 `stones/.stones_repo/` 不存在，建一个 bare repo
 *    （`git init --bare -b main`），然后通过临时 clone 灌入初始 commit、push 回 bare、
 *    最后用 `git worktree add ../main main` 把 main 挂为 linked worktree。
 *    这样 main 不是"主仓库"——跟未来添加的任意 worktree（如 metaprog/X/abc）平级；
 *    删 main 不破坏其它 worktree。
 * 3. 兼容老式非 bare（`stones/main/.git/` 是目录而不是文件）：检测到则保留并跑 idempotent
 *    分支检查；不强制迁移到 bare（避免破坏正在使用的 world）。
 * 4. 幂等：再次启动不重复迁移、不重复 commit。
 *
 * 不做的事：
 * - 不污染外层 OOC 源码仓库（git data 在 `stones/.stones_repo/` 内）
 * - 不修改 git 全局 config（commit author 走 per-call `-c` 注入）
 */

import { existsSync, lstatSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/** 默认主分支名，与 R5 的 fast-forward-to-main 语义对齐。 */
export const STONES_MAIN_BRANCH = "main";

/** bare 仓库目录名（plugins_worktrees 风格的 `.plugins_repo` 等价物）。 */
export const STONES_BARE_REPO_DIR = ".stones_repo";

const BOOTSTRAP_AUTHOR_NAME = "bootstrap";
const BOOTSTRAP_AUTHOR_EMAIL = "bootstrap@ooc.local";
const BOOTSTRAP_COMMIT_MESSAGE = "chore(bootstrap): import existing stones/";

/** 保留目录名，迁移时不会被搬到 main/ 下。 */
// "_builtin" = OOC-4 builtin 原型伪分支（stones/_builtin/objects/<proto>，见
// src/executable/prototype/constants.ts BUILTIN_BRANCH）。是 world-level 伪分支，
// 与 main 平级，migrateFlatToMain 永不应把它扫进 main/objects/（防 main 被手删的边界）。
const RESERVED_TOP_LEVEL = new Set([STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR, "_builtin", ".git", ".gitignore"]);

/** ensureStoneRepo 的结果，用于日志与测试断言。 */
export interface EnsureStoneRepoResult {
  /** 本次启动是否真的初始化了 bare repo（创建 .stones_repo/）。 */
  initialized: boolean;
  /** 本次启动是否真的从扁平布局迁移到 `stones/main/`。 */
  migrated: boolean;
  /** 若本次启动写下了 bootstrap commit，给出 sha。 */
  bootstrapCommit?: string;
  /** 仓库布局形态："bare"（推荐，新建走这条路径）或 "legacy-embedded"（兼容已有非 bare）。 */
  layout: "bare" | "legacy-embedded";
}

/**
 * 启动期对 `${baseDir}/stones/` 进行一次性自检：迁移旧布局、init bare repo、初始化 main 分支。
 *
 * 安全幂等：每次 server 启动都可调用；已就绪则只做轻量结构检查。
 */
export async function ensureStoneRepo(opts: { baseDir: string }): Promise<EnsureStoneRepoResult> {
  const stonesDir = join(opts.baseDir, "stones");
  await mkdir(stonesDir, { recursive: true });
  // 顺手 mkdir flows/ —— 不属于 git 跟踪范围（R2），但前端 /api/tree?scope=flows
  // 在目录不存在时返回 404 会让 refreshBasics 的 Promise.all reject、连带 stones
  // 数组也回不到 UI。空 flows/ 让初次 cold-start 体验顺滑。
  await mkdir(join(opts.baseDir, "flows"), { recursive: true });

  const migrated = await migrateFlatToMain(stonesDir);

  const bareDir = join(stonesDir, STONES_BARE_REPO_DIR);
  const mainDir = join(stonesDir, STONES_MAIN_BRANCH);
  const mainGitPath = join(mainDir, ".git");

  // 检测仓库形态
  const bareExists = existsSync(bareDir);
  const mainGitExists = existsSync(mainGitPath);
  const mainGitIsDir = mainGitExists ? safeIsDir(mainGitPath) : false;

  // 兼容老式非 bare：stones/main/.git 是 *目录*（U1 早期写法）
  if (mainGitIsDir && !bareExists) {
    return ensureLegacyEmbedded(mainDir, migrated);
  }

  // bare 路径——注意：这里不能无条件 mkdir(mainDir)，否则 `git worktree add ../main`
  // 会在已存在的空目录处报 fatal: '../main' already exists。
  // 只在 bare 不存在时（要走 createBareRepoWithMainWorktree 的临时 scratch 流程）
  // 才需要预创建 mainDir；其余路径让 git worktree add 自己创建。

  let initialized = false;
  let bootstrapCommit: string | undefined;

  if (!bareExists) {
    await mkdir(mainDir, { recursive: true });
    // 全新初始化 → 建 bare + seed initial commit + 把 main 挂成 linked worktree
    bootstrapCommit = await createBareRepoWithMainWorktree({ stonesDir, bareDir, mainDir });
    initialized = true;
  } else {
    // bare 已存在 —— 校验当前 HEAD 在 main
    if (headIsBorn(bareDir)) {
      const branch = currentBranch(bareDir);
      if (branch !== STONES_MAIN_BRANCH) {
        throw new Error(
          `${STONES_BARE_REPO_DIR}/HEAD points to '${branch}', expected '${STONES_MAIN_BRANCH}'. Manual intervention required.`,
        );
      }
    }
    // main worktree 不存在则补挂（先 prune 一次，清掉之前可能残留的 worktree admin 记录）
    if (!mainGitExists) {
      Bun.spawnSync(["git", "-C", bareDir, "worktree", "prune"], { stdout: "pipe", stderr: "pipe" });
      const wtAdd = Bun.spawnSync(
        ["git", "-C", bareDir, "worktree", "add", `../${STONES_MAIN_BRANCH}`, STONES_MAIN_BRANCH],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (wtAdd.exitCode !== 0) {
        const stderr = new TextDecoder().decode(wtAdd.stderr ?? new Uint8Array()).trim();
        throw new Error(`failed to attach main worktree: ${stderr}`);
      }
    }
  }

  // bootstrap 一次性 hygiene：清理 orphan worktree admin 记录。非周期扫描——
  // 与 worker 事件驱动模型对齐：cleanup 是启动期 invariant，不是 runtime safety net。
  // 失败仅 advisory warn，不阻止 bootstrap（R5 #31）。dynamic import 避免与
  // stone-versioning.ts 形成静态循环依赖。
  try {
    const { pruneStaleWorktrees } = await import("./stone-versioning");
    const pr = await pruneStaleWorktrees(opts.baseDir);
    if (pr.ok && pr.removed.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[stone-bootstrap] pruneStaleWorktrees removed ${pr.removed.length} orphan worktree entries: ${pr.removed.join(", ")}`,
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[stone-bootstrap] pruneStaleWorktrees failed (advisory, non-fatal): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return { initialized, migrated, bootstrapCommit, layout: "bare" };
}

/**
 * 老式非 bare（main/.git 是 dir）的兼容路径：保持现状，仅做轻量校验。
 */
function ensureLegacyEmbedded(mainDir: string, migrated: boolean): EnsureStoneRepoResult {
  const branch = currentBranch(mainDir);
  if (branch !== STONES_MAIN_BRANCH && headIsBorn(mainDir)) {
    throw new Error(
      `legacy stones/main/.git is on branch '${branch}', expected '${STONES_MAIN_BRANCH}'. Manual intervention required.`,
    );
  }

  let bootstrapCommit: string | undefined;
  if (!headIsBorn(mainDir)) {
    bootstrapCommit = createBootstrapCommit(mainDir);
  }
  return { initialized: false, migrated, bootstrapCommit, layout: "legacy-embedded" };
}

/**
 * 全新建库流程：
 * 1. `git init --bare -b main` 在 `.stones_repo/`
 * 2. 临时 clone 出工作树、把 main/ 已迁移内容拷进去、commit、push 回 bare、删临时
 * 3. `git -C .stones_repo worktree add ../main main` 把 main 挂为 linked worktree
 *
 * 返回首个 commit 的 sha。
 */
async function createBareRepoWithMainWorktree(opts: {
  stonesDir: string;
  bareDir: string;
  mainDir: string;
}): Promise<string> {
  // 1. init bare
  runGit(opts.stonesDir, ["init", "--bare", "-b", STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR]);

  // 2. 暂存 main/ 内容（如果有的话）
  // 用一个 .scratch 临时 clone 工作；HEAD 未生根的 bare 也能 clone（得到一个空 work-tree）
  const scratchDir = join(opts.stonesDir, ".scratch_bootstrap");
  await rm(scratchDir, { recursive: true, force: true });
  runGit(opts.stonesDir, ["clone", STONES_BARE_REPO_DIR, ".scratch_bootstrap"]);

  // 3. 把 main/ 现有内容（如果有）拷进 scratch
  const mainEntries = await safeReaddir(opts.mainDir);
  for (const entry of mainEntries) {
    // .git / .stones_repo 之类不会出现在 main/ 里（main/ 是纯 stone 内容）
    await cp(join(opts.mainDir, entry), join(scratchDir, entry), { recursive: true });
  }

  // 4. 在 scratch 里建 main 分支、commit、push
  runGit(scratchDir, ["checkout", "-b", STONES_MAIN_BRANCH]);
  runGit(scratchDir, ["add", "-A"]);
  const commitArgs = [
    "-c",
    `user.name=${BOOTSTRAP_AUTHOR_NAME}`,
    "-c",
    `user.email=${BOOTSTRAP_AUTHOR_EMAIL}`,
    "commit",
    "-m",
    BOOTSTRAP_COMMIT_MESSAGE,
  ];
  // 允许 main 为空（即 stones/main/ 没有任何 stone 时也能 commit）
  const status = runGit(scratchDir, ["status", "--porcelain"]).stdout;
  if (status.trim().length === 0) commitArgs.push("--allow-empty");
  runGit(scratchDir, commitArgs);
  runGit(scratchDir, ["push", "origin", STONES_MAIN_BRANCH]);
  const sha = runGit(scratchDir, ["rev-parse", "HEAD"]).stdout.trim();

  // 5. 删 scratch + 删原 main/（其内容已 push 回 bare），重新 worktree add ../main main
  await rm(scratchDir, { recursive: true, force: true });
  await rm(opts.mainDir, { recursive: true, force: true });
  runGit(opts.bareDir, ["worktree", "add", `../${STONES_MAIN_BRANCH}`, STONES_MAIN_BRANCH]);

  return sha;
}

/**
 * 把 `stones/<id>/` 扁平布局迁移到 `stones/main/objects/<id>/`。已迁移则 no-op。
 * 返回 true 表示本次确实做了迁移。
 *
 * 2026-05-21 重组：把 stone 对象从分支根挪到 `objects/` 子目录，让 `stones/{branch}/`
 * 根本身可承载 world-level stone 资源（注册表、共享数据等）。
 */
async function migrateFlatToMain(stonesDir: string): Promise<boolean> {
  const entries = await readdir(stonesDir, { withFileTypes: true });

  const hasMain = entries.some((e) => e.isDirectory() && e.name === STONES_MAIN_BRANCH);
  if (hasMain) return false;

  const candidates = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(".") && !RESERVED_TOP_LEVEL.has(e.name),
  );

  if (candidates.length === 0) {
    // 空 stones/，不要凭空 mkdir main/——后续 worktree add 会自己创建工作树根。
    return false;
  }

  // 真有 Object 要迁，才物化 main/objects/
  const mainDir = join(stonesDir, STONES_MAIN_BRANCH);
  const objectsDir = join(mainDir, "objects");
  await mkdir(objectsDir, { recursive: true });

  for (const cand of candidates) {
    await rename(join(stonesDir, cand.name), join(objectsDir, cand.name));
  }
  return true;
}

/** legacy non-bare 路径下，HEAD 未生根时补一条 bootstrap commit。 */
function createBootstrapCommit(mainDir: string): string {
  runGit(mainDir, ["add", "-A"]);
  const status = runGit(mainDir, ["status", "--porcelain"]).stdout;
  const hasContent = status.trim().length > 0;

  const commitArgs = [
    "-c",
    `user.name=${BOOTSTRAP_AUTHOR_NAME}`,
    "-c",
    `user.email=${BOOTSTRAP_AUTHOR_EMAIL}`,
    "commit",
    "-m",
    BOOTSTRAP_COMMIT_MESSAGE,
  ];
  if (!hasContent) commitArgs.push("--allow-empty");
  runGit(mainDir, commitArgs);

  return runGit(mainDir, ["rev-parse", "HEAD"]).stdout.trim();
}

/* ------------------------------- helpers ------------------------------- */

function safeIsDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** HEAD 是否已指向真实 commit。 */
function headIsBorn(repoOrWorktree: string): boolean {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: repoOrWorktree,
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0;
}

/** 当前 HEAD 所在分支名；HEAD 未生根时返回空字符串。 */
function currentBranch(repoOrWorktree: string): string {
  const result = Bun.spawnSync(["git", "symbolic-ref", "--short", "HEAD"], {
    cwd: repoOrWorktree,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return "";
  return new TextDecoder().decode(result.stdout).trim();
}

interface GitOk {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 同步 git 子命令；非零 exit 抛错（带 stderr）。 */
function runGit(cwd: string, args: string[]): GitOk {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout ?? new Uint8Array());
  const stderr = new TextDecoder().decode(result.stderr ?? new Uint8Array());
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd} (exit ${result.exitCode}): ${stderr.trim() || "(no stderr)"}`,
    );
  }
  return { exitCode: result.exitCode ?? 0, stdout, stderr };
}
