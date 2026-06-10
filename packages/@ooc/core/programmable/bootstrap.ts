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
 *    这样 main 不是"主仓库"——跟未来添加的任意 worktree 平级；删 main 不破坏其它 worktree。
 * 3. 兼容老式非 bare（`stones/main/.git/` 是目录而不是文件）：检测到则保留并跑 idempotent
 *    分支检查；不强制迁移到 bare（避免破坏正在使用的 world）。
 * 4. 幂等：再次启动不重复迁移、不重复 commit。
 *
 * git versioning 操作 `stones/`（每个 branch 下挂 objects/），运行时读经 stoneDir() 路由到
 * `packages/`（_stonesBranch 未设时）；合入后从 stones/main/objects/ 同步到 packages/。
 *
 * 不做的事：
 * - 不污染外层 OOC 源码仓库（git data 在 `stones/.stones_repo/` 内）
 * - 不修改 git 全局 config（commit author 走 per-call `-c` 注入）
 */

import { existsSync, lstatSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  STONE_OBJECTS_SUBDIR,
  STONES_MAIN_BRANCH,
  STONES_BARE_REPO_DIR,
} from "../persistable/common.js";

// 常量 canonical 源已迁入 persistable/common（打破 pr-issue → bootstrap 反向依赖）；
// 此处 re-export 保持旧 import 路径（`programmable/bootstrap`）可用。
export { STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR };

const BOOTSTRAP_AUTHOR_NAME = "bootstrap";
const BOOTSTRAP_AUTHOR_EMAIL = "bootstrap@ooc.local";
const BOOTSTRAP_COMMIT_MESSAGE = "chore(bootstrap): import existing stones/";

/** per-call author 注入参数（不污染全局 git config）。 */
const AUTHOR_FLAGS = ["-c", `user.name=${BOOTSTRAP_AUTHOR_NAME}`, "-c", `user.email=${BOOTSTRAP_AUTHOR_EMAIL}`];

interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * bootstrap 专用 git 调用：抛错式 fail-loud 流程里收口 `Bun.spawnSync` + decode 样板。
 * git.ts 薄包装是 `{ok,code}` 返回式且面向 worktree，不覆盖此处的 bare/clone/push；故本地自包。
 */
function runGit(args: string[], cwd?: string): GitRun {
  const p = Bun.spawnSync(["git", ...args], { ...(cwd ? { cwd } : {}), stdout: "pipe", stderr: "pipe" });
  return {
    ok: p.exitCode === 0,
    stdout: new TextDecoder().decode(p.stdout ?? new Uint8Array()).trim(),
    stderr: new TextDecoder().decode(p.stderr ?? new Uint8Array()).trim(),
  };
}

/**
 * main 分支根的 .gitignore 内容（方案 A 续，2026-06-09）。
 *
 * session worktree（`flows/<sid>`）从 main checkout 时继承它。tracked stone 身份文件与运行时
 * 数据同落 `objects/<id>/`，故白名单 `objects/` 后再用黑名单排除运行时特征文件：
 *   - 顶层 `/*` 排除 session 级运行时；`!/objects/` `!/.gitignore` 放行。
 *   - `objects/** /threads/`、`objects/** /.flow.json`、`objects/** /state.json` 排除对象级运行时。
 * 让 `git status` / evolve diff 只看见身份改动，不被运行时数据污染。
 */
const STONE_MAIN_GITIGNORE =
  "/*\n!/objects/\n!/.gitignore\nobjects/**/threads/\nobjects/**/.flow.json\nobjects/**/state.json\n";

/** 保留目录名，迁移时不会被搬到 main/ 下。 */
const RESERVED_TOP_LEVEL = new Set([STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR, ".git", ".gitignore"]);

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

function safeIsDir(p: string): boolean {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 扁平 → main 布局迁移（2026-05-20 Round 3 U1.1）。
 *
 * 旧布局：`stones/<objectId>/` 直接在 stones/ 下。新布局：`stones/main/objects/<objectId>/`。
 * 幂等：检测到旧形态目录才迁移，且迁移后删除旧目录、避免下次再迁。
 */
async function migrateFlatToMain(stonesDir: string): Promise<boolean> {
  try {
    const entries = await readdir(stonesDir, { withFileTypes: true });
    const toMigrate = entries.filter(
      (e) => e.isDirectory() && !RESERVED_TOP_LEVEL.has(e.name) && !e.name.startsWith("metaprog/"),
    );
    if (toMigrate.length === 0) return false;

    const mainObjectsDir = join(stonesDir, STONES_MAIN_BRANCH, STONE_OBJECTS_SUBDIR);
    await mkdir(mainObjectsDir, { recursive: true });
    for (const e of toMigrate) {
      await rename(join(stonesDir, e.name), join(mainObjectsDir, e.name));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 初始化 bare repo + main worktree。
 *
 * 步骤：init bare → 临时 clone scratch（bare 不能直接 commit）→ scratch 写 .gitignore + commit →
 * push 回 bare → 删 scratch → 从 bare `git worktree add ./main main`。
 */
async function createBareRepoWithMainWorktree(opts: {
  stonesDir: string;
  bareDir: string;
  mainDir: string;
}): Promise<string> {
  const { stonesDir, bareDir, mainDir } = opts;

  // Step 1: init bare
  const init = runGit(["init", "--bare", "-b", STONES_MAIN_BRANCH, bareDir]);
  if (!init.ok) throw new Error(`git init --bare failed: ${init.stderr}`);

  // Step 2-4: scratch clone + initial commit + push
  const scratchDir = join(stonesDir, ".scratch-bootstrap");
  await rm(scratchDir, { recursive: true, force: true });

  const clone = runGit(["clone", bareDir, scratchDir]);
  if (!clone.ok) {
    await rm(scratchDir, { recursive: true, force: true });
    throw new Error(`git clone failed: ${clone.stderr}`);
  }

  // 写 main 根 .gitignore（方案 A）：session worktree 从 main checkout 继承它，排除 flows/<sid>
  // 下运行时产物，只 track objects/。它本身白名单（`!/.gitignore`）即初始 commit 的内容载体，
  // 无需额外 .gitkeep（`.gitkeep` 会被 `/*` 规则忽略，git add 反而失败）。
  await Bun.write(join(scratchDir, ".gitignore"), STONE_MAIN_GITIGNORE);

  const add = runGit(["add", ".gitignore"], scratchDir);
  if (!add.ok) {
    await rm(scratchDir, { recursive: true, force: true });
    throw new Error(`git add failed: ${add.stderr}`);
  }

  const commit = runGit([...AUTHOR_FLAGS, "commit", "-m", BOOTSTRAP_COMMIT_MESSAGE], scratchDir);
  if (!commit.ok) {
    await rm(scratchDir, { recursive: true, force: true });
    throw new Error(`git commit failed: ${commit.stderr}`);
  }

  const push = runGit(["push", "origin", STONES_MAIN_BRANCH], scratchDir);
  if (!push.ok) {
    await rm(scratchDir, { recursive: true, force: true });
    throw new Error(`git push failed: ${push.stderr}`);
  }

  const commitSha = runGit(["rev-parse", "HEAD"], scratchDir).stdout;
  await rm(scratchDir, { recursive: true, force: true });

  // Step 5: 删除 caller 预创建的 mainDir，让 git worktree add 自己创建
  await rm(mainDir, { recursive: true, force: true });

  // Step 6: 从 bare 挂 main worktree
  const worktreeAdd = runGit(["worktree", "add", join(stonesDir, STONES_MAIN_BRANCH), STONES_MAIN_BRANCH], bareDir);
  if (!worktreeAdd.ok) throw new Error(`git worktree add failed: ${worktreeAdd.stderr}`);

  return commitSha;
}

/**
 * 幂等确保 main 分支根 .gitignore 内容与期望（STONE_MAIN_GITIGNORE）一致（方案 A 续 2026-06-09）。
 *
 * 缺失或内容陈旧 → 覆盖更新并 commit 到 main，让已 bootstrap 的旧 world 升级；内容已一致 → no-op。
 * best-effort：读/写/commit 失败不抛（不阻塞启动），但 warn 让运维知情。
 */
async function ensureMainGitignore(mainDir: string): Promise<void> {
  const gitignorePath = join(mainDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    try {
      const current = await Bun.file(gitignorePath).text();
      if (current === STONE_MAIN_GITIGNORE) return;
    } catch (err) {
      console.warn(`[bootstrap] ensureMainGitignore read failed: ${(err as Error).message}`);
      // 读失败时仍尝试覆盖写（下面），把内容拉回期望态。
    }
  }
  try {
    await Bun.write(gitignorePath, STONE_MAIN_GITIGNORE);
    const add = runGit(["add", ".gitignore"], mainDir);
    if (!add.ok) {
      console.warn(`[bootstrap] ensureMainGitignore git add failed: ${add.stderr}`);
      return;
    }
    // 暂存区无变化（内容已与 HEAD 一致，仅 read 失败误入此路径）→ 跳过 commit 避免 "nothing to commit" 误报。
    if (runGit(["diff", "--cached", "--quiet", "--", ".gitignore"], mainDir).ok) return;
    const commit = runGit(
      [...AUTHOR_FLAGS, "commit", "-m", "chore(bootstrap): update main .gitignore (objects/ runtime blacklist)"],
      mainDir,
    );
    if (!commit.ok) {
      console.warn(`[bootstrap] ensureMainGitignore git commit failed: ${commit.stderr}`);
    }
  } catch (err) {
    console.warn(`[bootstrap] ensureMainGitignore failed: ${(err as Error).message}`);
  }
}

/**
 * 兼容老式非 bare 仓库（stones/main/.git/ 是目录）。只做最轻量检查：当前 HEAD 在 main、不强制迁移。
 */
async function ensureLegacyEmbedded(
  mainDir: string,
  migrated: boolean,
): Promise<EnsureStoneRepoResult> {
  const branchRun = runGit(["rev-parse", "--abbrev-ref", "HEAD"], mainDir);
  if (branchRun.ok && branchRun.stdout !== STONES_MAIN_BRANCH) {
    throw new Error(
      `legacy embedded repo HEAD points to '${branchRun.stdout}', expected '${STONES_MAIN_BRANCH}'`,
    );
  }
  return { initialized: false, migrated, layout: "legacy-embedded" };
}

/** 检查 bare repo 是否已有初始 commit（HEAD 未生根则返回 false）。 */
function headIsBorn(bareDir: string): boolean {
  return runGit(["rev-parse", "--verify", "HEAD"], bareDir).ok;
}

function currentBranch(bareDir: string): string | null {
  const r = runGit(["symbolic-ref", "--short", "HEAD"], bareDir);
  return r.ok ? r.stdout : null;
}

/** Check if there are old flat-layout object directories under stones/ that need migration. */
async function hasOldFlatLayout(stonesDir: string): Promise<boolean> {
  try {
    const entries = await readdir(stonesDir, { withFileTypes: true });
    return entries.some(
      (e) => e.isDirectory() && !RESERVED_TOP_LEVEL.has(e.name) && !e.name.startsWith("metaprog/"),
    );
  } catch {
    return false;
  }
}

/**
 * 启动期对 `${baseDir}/stones/` 进行一次性自检：迁移旧布局、init bare repo、初始化 main 分支。
 * 安全幂等：每次 server 启动都可调用；已就绪则只做轻量结构检查。
 */
export async function ensureStoneRepo(opts: { baseDir: string }): Promise<EnsureStoneRepoResult> {
  const stonesDir = join(opts.baseDir, "stones");
  await mkdir(stonesDir, { recursive: true });
  // 顺手 mkdir flows/ pools/ —— 不属于 git 跟踪范围，但前端 /api/tree 在目录不存在时返回 404
  // 会让 refreshBasics 的 Promise.all reject、连带 stones 数组也回不到 UI。空目录让 cold-start 顺滑。
  await mkdir(join(opts.baseDir, "flows"), { recursive: true });
  await mkdir(join(opts.baseDir, "pools"), { recursive: true });

  // Detect old flat layout BEFORE creating worktree (which would delete stones/main/)
  const needsMigration = await hasOldFlatLayout(stonesDir);

  const bareDir = join(stonesDir, STONES_BARE_REPO_DIR);
  const mainDir = join(stonesDir, STONES_MAIN_BRANCH);
  const mainGitPath = join(mainDir, ".git");

  // 检测仓库形态
  const bareExists = existsSync(bareDir);
  const mainGitExists = existsSync(mainGitPath);
  const mainGitIsDir = mainGitExists ? safeIsDir(mainGitPath) : false;

  // 兼容老式非 bare：stones/main/.git 是 *目录*（U1 早期写法）
  if (mainGitIsDir && !bareExists) {
    const migrated = needsMigration ? await migrateFlatToMain(stonesDir) : false;
    return ensureLegacyEmbedded(mainDir, migrated);
  }

  // bare 路径——不能无条件 mkdir(mainDir)，否则 `git worktree add ../main` 会在已存在的空目录处
  // 报 fatal: '../main' already exists。只在 bare 不存在时（走 createBareRepoWithMainWorktree 的
  // scratch 流程）才预创建 mainDir；其余路径让 git worktree add 自己创建。

  let initialized = false;
  let bootstrapCommit: string | undefined;
  let migrated = false;

  if (!bareExists) {
    await mkdir(mainDir, { recursive: true });
    // 全新初始化 → 建 bare + seed initial commit + 把 main 挂成 linked worktree
    bootstrapCommit = await createBareRepoWithMainWorktree({ stonesDir, bareDir, mainDir });
    initialized = true;

    // worktree 已存在，迁移旧扁平布局（如需）并 commit
    if (needsMigration) {
      migrated = await migrateFlatToMain(stonesDir);
      if (migrated && runGit(["add", "objects/"], mainDir).ok) {
        const commit = runGit([...AUTHOR_FLAGS, "commit", "-m", BOOTSTRAP_COMMIT_MESSAGE], mainDir);
        if (commit.ok) bootstrapCommit = runGit(["rev-parse", "HEAD"], mainDir).stdout;
      }
    }
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
    // main worktree 可能不存在（首次启动或被手动清理）——尝试创建
    if (!existsSync(join(mainDir, ".git"))) {
      await rm(mainDir, { recursive: true, force: true });
      const worktreeAdd = runGit(
        ["worktree", "add", join(stonesDir, STONES_MAIN_BRANCH), STONES_MAIN_BRANCH],
        bareDir,
      );
      if (!worktreeAdd.ok) {
        throw new Error(`git worktree add (existing bare) failed: ${worktreeAdd.stderr}`);
      }
    }
  }

  // 幂等确保 main 根 .gitignore 存在（新 bootstrap 的初始 commit 已带；旧 world 在此补齐）。
  await ensureMainGitignore(mainDir);

  return { initialized, migrated, bootstrapCommit, layout: "bare" };
}
