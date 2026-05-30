/**
 * ensureUserObject — World bootstrap invariant：确保 user stone 存在。
 *
 * 设计动机（2026-05-25）：
 *   `user` 是真人用户在 OOC World 中的占位 Object，其 `readable.md` 定义了
 *   Object → user 消息的 inline UI token 协议（详见 `user-seed.ts`）。其它
 *   Object 通过读 user 的 readme（在 relation_window 中）学到这套语法。
 *
 *   把它升格为 bootstrap invariant 后：
 *   1. 第一启动自动建 user stone（空 self.md + 真实 readable.md，无 seed knowledge）
 *   2. 后续启动 idempotent skip（stone 已存在则跳过）
 *   3. 新 World 的 Object 立刻能读到 inline UI 协议，不需手动构造
 *
 * 与 ensureSupervisorObject 的差别：
 *   - **无 seed knowledge**：user 不是 LLM Agent，没有"自动激活的知识"概念
 *   - **self.md 留空**：worker 不会调度 user 的 thread（见 worker.ts），无 instructions 注入
 *   - **commit author = supervisor**：bootstrap 期由 supervisor 代表 World 接生
 *     （类比 ensureSupervisorObject 自身用 supervisor 做 author——bootstrap 一致性）
 *
 * 实现：直写 main worktree（与 ensureSupervisorObject 同款），bootstrap 期尚无
 * LLM 上下文运行 metaprog，最简方式是 createStoneObject + writeReadable + gitCommitAll。
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  stoneDir,
  createStoneObject,
  writeReadable,
  STONES_MAIN_BRANCH,
  SUPERVISOR_OBJECT_ID,
  gitCommitAll,
} from "@src/persistable";
import { createPoolObject, poolMetadataFile } from "@src/persistable/pool-object";
import { USER_OBJECT_ID, USER_README_MD } from "./user-seed";

/** ensureUserObject 的返回值，告诉 caller 是否真创建过、对应 commit。 */
export interface EnsureUserResult {
  /** true = 本次新建；false = 已存在（idempotent skip） */
  created: boolean;
  /** 新建时的 commit sha；skip 时 undefined */
  commitSha?: string;
}

/**
 * 检查 user stone 是否已存在（通过 `.stone.json` marker，与 supervisor 同款判定）。
 */
async function userStoneExists(baseDir: string, branch: string): Promise<boolean> {
  const ref = { baseDir, objectId: USER_OBJECT_ID, stonesBranch: branch };
  const marker = join(stoneDir(ref), ".stone.json");
  try {
    const st = await stat(marker);
    return st.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * 第一启动时创建 user stone。
 *
 * 流程（与 ensureSupervisorObject 同款，去掉 self.md 与 seed knowledge）：
 *   1. ref 用 stonesBranch="main"（main worktree path）
 *   2. createStoneObject 预创 .stone.json + 空 self.md + 空 readable.md
 *   3. writeReadable 覆盖空 readable 为真实内容（self.md 保持空——user 无 LLM instructions）
 *   4. gitCommitAll 把 main worktree 全部新增 stage + commit (author=supervisor)
 */
async function createUserStone(baseDir: string, branch: string): Promise<string | undefined> {
  const ref = { baseDir, objectId: USER_OBJECT_ID, stonesBranch: branch };

  await createStoneObject(ref);
  await writeReadable(ref, USER_README_MD);

  const mainWorktreePath = join(baseDir, "stones", branch);
  const commit = gitCommitAll(mainWorktreePath, {
    authorName: SUPERVISOR_OBJECT_ID,
    authorEmail: `${SUPERVISOR_OBJECT_ID}@ooc.local`,
    message: "bootstrap: ensure user stone (world invariant)",
  });
  if (!commit.ok) {
    throw new Error(
      `[ensure-user] failed to commit user stone (${commit.code}): ${commit.stderr ?? "git error"}`,
    );
  }
  return commit.value;
}

/**
 * 启动期入口：确保 user stone 存在；idempotent。
 *
 * 调用位置：buildServer 启动期，紧跟 ensureSupervisorObject 之后、recovery-check 之前。
 *
 * 失败处理：抛错并退出（与 ensureSupervisorObject 同风格——bootstrap invariant
 * 失败不允许 server 跑下去）。
 */
/**
 * Idempotent pool skeleton for user（2026-05-25 Round 6 Batch C, M-5 解）。
 *
 * 与 ensureSupervisorPool 同款：通过 .pool.json marker 判 idempotent。
 * user 虽不是 LLM Agent，但 sediment 端仍可能写（如 collaborable.relations 中
 * 其它 Object 对 user 的 long_term 认知；或 user 上传 files），所以 pool skeleton
 * 同样预创——和 supervisor 一致地把 pool 视为 World 第一类骨架。
 */
async function ensureUserPool(baseDir: string): Promise<boolean> {
  const ref = { baseDir, objectId: USER_OBJECT_ID };
  try {
    await stat(poolMetadataFile(ref));
    return false; // already exists
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await createPoolObject(ref);
  return true;
}

export async function ensureUserObject(opts: {
  baseDir: string;
  branch?: string;
}): Promise<EnsureUserResult> {
  const branch = opts.branch ?? STONES_MAIN_BRANCH;
  let commitSha: string | undefined;
  let created = false;
  if (!(await userStoneExists(opts.baseDir, branch))) {
    commitSha = await createUserStone(opts.baseDir, branch);
    created = true;
  }
  await ensureUserPool(opts.baseDir);
  return { created, commitSha };
}
