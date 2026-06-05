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
 * 2026-06-01 bun workspace migration: git versioning still operates on
 * `stones/` (with objects/ under each branch), but runtime reads route to
 * `packages/` via stoneDir() when _stonesBranch is unset. Merged changes are
 * synced from stones/main/objects/ to packages/ after each successful ff merge.
 *
 * 不做的事：
 * - 不污染外层 OOC 源码仓库（git data 在 `stones/.stones_repo/` 内）
 * - 不修改 git 全局 config（commit author 走 per-call `-c` 注入）
 */

import { existsSync, lstatSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
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
 * 旧布局（2026-05-20 前）：`stones/<objectId>/` 直接在 stones/ 下。
 * 新布局：`stones/main/objects/<objectId>/`（对象挂在 main worktree 下）。
 *
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
      const oldPath = join(stonesDir, e.name);
      const newPath = join(mainObjectsDir, e.name);
      await rename(oldPath, newPath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 初始化 bare repo + main worktree。
 *
 * 步骤：
 * 1. `git init --bare -b main` 在 `.stones_repo/`
 * 2. 临时 clone bare 到 scratch/ 目录（因为 bare 不能直接 commit）
 * 3. 在 scratch/ 中写 .gitkeep + commit
 * 4. push 回 bare
 * 5. 删除 scratch/
 * 6. 在 stones/ 目录下 `git worktree add ./main main` 从 bare 挂 main worktree
 */
async function createBareRepoWithMainWorktree(opts: {
  stonesDir: string;
  bareDir: string;
  mainDir: string;
}): Promise<string> {
  const { stonesDir, bareDir, mainDir } = opts;

  // Step 1: init bare
  const init = Bun.spawnSync(["git", "init", "--bare", "-b", STONES_MAIN_BRANCH, bareDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (init.exitCode !== 0) {
    throw new Error(
      `git init --bare failed: ${new TextDecoder().decode(init.stderr ?? new Uint8Array())}`,
    );
  }

  // Step 2-4: scratch clone + initial commit + push
  const scratchDir = join(stonesDir, ".scratch-bootstrap");
  await rm(scratchDir, { recursive: true, force: true });

  const clone = Bun.spawnSync(["git", "clone", bareDir, scratchDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (clone.exitCode !== 0) {
    await rm(scratchDir, { recursive: true, force: true });
    throw new Error(`git clone failed: ${new TextDecoder().decode(clone.stderr ?? new Uint8Array())}`);
  }

  // 写 .gitkeep 占位（main worktree 初始需要至少一个 commit）
  const gitkeepPath = join(scratchDir, ".gitkeep");
  await Bun.write(gitkeepPath, "");

  const add = Bun.spawnSync(["git", "add", ".gitkeep"], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (add.exitCode !== 0) {
    await rm(scratchDir, { recursive: true, force: true });
    throw new Error(`git add failed: ${new TextDecoder().decode(add.stderr ?? new Uint8Array())}`);
  }

  const commit = Bun.spawnSync(
    [
      "git",
      "-c",
      `user.name=${BOOTSTRAP_AUTHOR_NAME}`,
      "-c",
      `user.email=${BOOTSTRAP_AUTHOR_EMAIL}`,
      "commit",
      "-m",
      BOOTSTRAP_COMMIT_MESSAGE,
    ],
    { cwd: scratchDir, stdout: "pipe", stderr: "pipe" },
  );
  if (commit.exitCode !== 0) {
    await rm(scratchDir, { recursive: true, force: true });
    throw new Error(`git commit failed: ${new TextDecoder().decode(commit.stderr ?? new Uint8Array())}`);
  }

  const push = Bun.spawnSync(["git", "push", "origin", STONES_MAIN_BRANCH], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (push.exitCode !== 0) {
    await rm(scratchDir, { recursive: true, force: true });
    throw new Error(`git push failed: ${new TextDecoder().decode(push.stderr ?? new Uint8Array())}`);
  }

  // 提取 commit sha
  const revParse = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const commitSha = new TextDecoder().decode(revParse.stdout ?? new Uint8Array()).trim();

  await rm(scratchDir, { recursive: true, force: true });

  // Step 5: remove mainDir (it was pre-created by caller) so git worktree add can create it
  await rm(mainDir, { recursive: true, force: true });

  // Step 6: git worktree add from bare
  const worktreeAdd = Bun.spawnSync(
    ["git", "worktree", "add", join(stonesDir, STONES_MAIN_BRANCH), STONES_MAIN_BRANCH],
    { cwd: bareDir, stdout: "pipe", stderr: "pipe" },
  );
  if (worktreeAdd.exitCode !== 0) {
    throw new Error(
      `git worktree add failed: ${new TextDecoder().decode(worktreeAdd.stderr ?? new Uint8Array())}`,
    );
  }

  return commitSha;
}

/**
 * 兼容老式非 bare 仓库（stones/main/.git/ 是目录）。
 *
 * 只做最轻量检查：当前 HEAD 在 main、不强制迁移。
 */
async function ensureLegacyEmbedded(
  mainDir: string,
  migrated: boolean,
): Promise<EnsureStoneRepoResult> {
  // 简单幂等：仅检查当前分支
  const branchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: mainDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const branch = new TextDecoder().decode(branchProc.stdout ?? new Uint8Array()).trim();
  if (branch !== STONES_MAIN_BRANCH && branchProc.exitCode === 0) {
    throw new Error(
      `legacy embedded repo HEAD points to '${branch}', expected '${STONES_MAIN_BRANCH}'`,
    );
  }
  return { initialized: false, migrated, layout: "legacy-embedded" };
}

/**
 * 检查 bare repo 是否已有初始 commit（HEAD 是 "born" 状态则返回 false）。
 */
function headIsBorn(bareDir: string): boolean {
  const proc = Bun.spawnSync(["git", "rev-parse", "--verify", "HEAD"], {
    cwd: bareDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exitCode === 0;
}

function currentBranch(bareDir: string): string | null {
  const proc = Bun.spawnSync(["git", "symbolic-ref", "--short", "HEAD"], {
    cwd: bareDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return null;
  return new TextDecoder().decode(proc.stdout ?? new Uint8Array()).trim();
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
 *
 * 安全幂等：每次 server 启动都可调用；已就绪则只做轻量结构检查。
 */
export async function ensureStoneRepo(opts: { baseDir: string }): Promise<EnsureStoneRepoResult> {
  const stonesDir = join(opts.baseDir, "stones");
  await mkdir(stonesDir, { recursive: true });
  // 顺手 mkdir flows/ pools/ packages/ —— 不属于 git 跟踪范围，但前端 /api/tree 在
  // 目录不存在时返回 404 会让 refreshBasics 的 Promise.all reject、连带 stones
  // 数组也回不到 UI。空目录让初次 cold-start 体验顺滑。
  await mkdir(join(opts.baseDir, "flows"), { recursive: true });
  await mkdir(join(opts.baseDir, "pools"), { recursive: true });
  await mkdir(join(opts.baseDir, "packages"), { recursive: true });

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

  // bare 路径——注意：这里不能无条件 mkdir(mainDir)，否则 `git worktree add ../main`
  // 会在已存在的空目录处报 fatal: '../main' already exists。
  // 只在 bare 不存在时（要走 createBareRepoWithMainWorktree 的临时 scratch 流程）
  // 才需要预创建 mainDir；其余路径让 git worktree add 自己创建。

  let initialized = false;
  let bootstrapCommit: string | undefined;
  let migrated = false;

  if (!bareExists) {
    await mkdir(mainDir, { recursive: true });
    // 全新初始化 → 建 bare + seed initial commit + 把 main 挂成 linked worktree
    bootstrapCommit = await createBareRepoWithMainWorktree({ stonesDir, bareDir, mainDir });
    initialized = true;

    // Now that worktree exists, migrate old flat layout if needed and commit
    if (needsMigration) {
      migrated = await migrateFlatToMain(stonesDir);
      if (migrated) {
        // Commit the migrated files to the repo
        const add = Bun.spawnSync(["git", "add", "objects/"], { cwd: mainDir, stdout: "pipe", stderr: "pipe" });
        if (add.exitCode === 0) {
          const commit = Bun.spawnSync(
            [
              "git",
              "-c",
              `user.name=${BOOTSTRAP_AUTHOR_NAME}`,
              "-c",
              `user.email=${BOOTSTRAP_AUTHOR_EMAIL}`,
              "commit",
              "-m",
              BOOTSTRAP_COMMIT_MESSAGE,
            ],
            { cwd: mainDir, stdout: "pipe", stderr: "pipe" },
          );
          if (commit.exitCode === 0) {
            const revParse = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: mainDir, stdout: "pipe" });
            bootstrapCommit = new TextDecoder().decode(revParse.stdout ?? new Uint8Array()).trim();
          }
        }
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
    const mainWorktreeGitExists = existsSync(join(mainDir, ".git"));
    if (!mainWorktreeGitExists) {
      await rm(mainDir, { recursive: true, force: true });
      const worktreeAdd = Bun.spawnSync(
        ["git", "worktree", "add", join(stonesDir, STONES_MAIN_BRANCH), STONES_MAIN_BRANCH],
        { cwd: bareDir, stdout: "pipe", stderr: "pipe" },
      );
      if (worktreeAdd.exitCode !== 0) {
        throw new Error(
          `git worktree add (existing bare) failed: ${new TextDecoder().decode(worktreeAdd.stderr ?? new Uint8Array())}`,
        );
      }
    }
  }

  return { initialized, migrated, bootstrapCommit, layout: "bare" };
}
