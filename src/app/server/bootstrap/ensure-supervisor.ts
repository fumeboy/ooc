/**
 * ensureSupervisorObject — World bootstrap invariant：确保 supervisor stone 存在。
 *
 * 设计动机（2026-05-25 user 指令）：
 *   "初始的 OOC World 没有初始的 OOC Agent 对象；支持初始化 World 时一并初始化
 *    一个 supervisor 对象。"
 *
 * 也是体验官 R5 #32 caveat 的彻底解：recovery-check 之前假设 supervisor 存在
 * 但空 world 没有，导致 [recovery-needed] PR-Issue 创建抛错被静默吞、broken
 * 列表丢失。supervisor 升格为 bootstrap invariant 后（PR-Issue 是 stone-versioning
 * 决议链路用的，不是已移除的 issue 看板）：
 *
 * 1. 第一启动自动建 supervisor stone（self.md / readable.md / 5 篇 seed knowledge）
 * 2. 后续启动 idempotent skip（stone 已存在则跳过）
 * 3. recovery-check / metaprog R12 等所有依赖 supervisor 的协议都得到稳定锚点
 *
 * 实现：完全走 wrapHttpWriteInWorktree 通路（根因 #2 契约：所有 stone 写入必经
 * stone-versioning），与 HTTP createStone 同语义——bootstrap supervisor 也是一次
 * "metaprog branch + commit + ff merge" 流程。
 */

import { stat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  stoneDir,
  stoneKnowledgeDir,
  createStoneObject,
  writeSelf,
  writeReadable,
  STONES_MAIN_BRANCH,
  gitCommitAll,
} from "@src/persistable";
import { createPoolObject, poolMetadataFile } from "@src/persistable/pool-object";
import {
  SUPERVISOR_OBJECT_ID,
  SUPERVISOR_SELF_MD,
  SUPERVISOR_README_MD,
  SUPERVISOR_SEED_KNOWLEDGE,
} from "./supervisor-seed";

/** ensureSupervisorObject 的返回值，告诉 caller 是否真创建过、对应 commit。 */
export interface EnsureSupervisorResult {
  /** true = 本次新建；false = 已存在（idempotent skip） */
  created: boolean;
  /** 新建时的 commit sha（如已走 ff merge）；skip 时 undefined */
  commitSha?: string;
}

/**
 * 检查 supervisor stone 是否已存在。
 *
 * 通过 stat `stones/<branch>/objects/supervisor/.stone.json` 判定——这是
 * createStoneObject 必写的元数据文件，比检查整目录更精确（防御老 world 有
 * 残留空目录的情况）。
 */
async function supervisorStoneExists(baseDir: string, branch: string): Promise<boolean> {
  const ref = { baseDir, objectId: SUPERVISOR_OBJECT_ID, stonesBranch: branch };
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
 * 第一启动时创建 supervisor stone。
 *
 * **Bootstrap 直写 main**：此时尚未进入 LLM 上下文运行 metaprog 命令，最简
 * 方式是直接 createStoneObject + writeSelf/Readme + 写 seed knowledge +
 * gitCommitAll on main worktree。运行期 supervisor 创建他人 Object 走 metaprog
 * `create_object`（与本函数同款实现的快捷命令）或标准 metaprog 流程。
 *
 * 流程：
 *   1. ref 用 stonesBranch="main"（main worktree path）
 *   2. createStoneObject + writeSelf + writeReadable + 写 seed knowledge
 *   3. gitCommitAll 把 main worktree 全部新增 stage + commit（author=supervisor）
 *
 * 失败时抛错（启动期一次性副作用 — 与 ensureStoneRepo 同风格）。
 */
async function createSupervisorStone(baseDir: string, branch: string): Promise<string | undefined> {
  const ref = { baseDir, objectId: SUPERVISOR_OBJECT_ID, stonesBranch: branch };

  // createStoneObject 预创 .stone.json + self.md (空) + readable.md (空)
  await createStoneObject(ref);
  // 覆盖空占位为真实内容
  await writeSelf(ref, SUPERVISOR_SELF_MD);
  await writeReadable(ref, SUPERVISOR_README_MD);
  // 写 seed knowledge：stones/<branch>/objects/supervisor/knowledge/<file>
  const knowledgeBaseDir = stoneKnowledgeDir(ref);
  await mkdir(knowledgeBaseDir, { recursive: true });
  for (const [filename, content] of Object.entries(SUPERVISOR_SEED_KNOWLEDGE)) {
    await writeFile(join(knowledgeBaseDir, filename), content, "utf8");
  }

  // git commit on main worktree (bootstrap-time 直写：尚无 LLM 上下文运行 metaprog)
  const mainWorktreePath = join(baseDir, "stones", branch);
  const commit = gitCommitAll(mainWorktreePath, {
    authorName: SUPERVISOR_OBJECT_ID,
    authorEmail: `${SUPERVISOR_OBJECT_ID}@ooc.local`,
    message: "bootstrap: ensure supervisor stone (world invariant)",
  });
  if (!commit.ok) {
    throw new Error(
      `[ensure-supervisor] failed to commit supervisor stone (${commit.code}): ${commit.stderr ?? "git error"}`,
    );
  }
  return commit.value;
}

/**
 * 启动期入口：确保 supervisor stone 存在；idempotent。
 *
 * 调用位置：buildServer 启动期，紧跟 ensureStoneRepo 之后、recovery-check 之前。
 *
 * 失败处理：抛错并退出（与 ensureStoneRepo 同风格——bootstrap invariant 失败
 * 不允许 server 跑下去；区别于 advisory 类 check）。
 */
/**
 * Idempotent pool skeleton for supervisor.
 *
 * 2026-05-25 Round 6 Batch C 增（M-5 解）：体验官报告
 * `/api/tree?scope=world&path=pools/objects/supervisor/knowledge` 404，根因是
 * pools/objects/supervisor/ 在 bootstrap 时不预创——只有等 supervisor 第一次写
 * sediment 才会出现。把 pool 骨架升格为 bootstrap invariant 之一：
 *
 * - 新 world: 第一启动建 supervisor stone 后顺手 createPoolObject(supervisor)
 * - 已有 world 但缺 pool: 后续启动检测到 .pool.json 不存在 → createPoolObject 补建
 * - 已有 pool: skip（通过 .pool.json marker 判定）
 *
 * 与 createStoneObject + ensureSupervisorObject 同款 idempotent 风格。
 * 不写 git（pool 不进 git）。
 */
async function ensureSupervisorPool(baseDir: string): Promise<boolean> {
  const ref = { baseDir, objectId: SUPERVISOR_OBJECT_ID };
  try {
    await stat(poolMetadataFile(ref));
    return false; // already exists
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await createPoolObject(ref);
  return true;
}

export async function ensureSupervisorObject(opts: {
  baseDir: string;
  branch?: string;
}): Promise<EnsureSupervisorResult> {
  const branch = opts.branch ?? STONES_MAIN_BRANCH;
  let commitSha: string | undefined;
  let created = false;
  if (!(await supervisorStoneExists(opts.baseDir, branch))) {
    commitSha = await createSupervisorStone(opts.baseDir, branch);
    created = true;
  }
  // pool skeleton: idempotent，与 stone 创建解耦——已有 stone 但缺 pool 的旧 world 也补建
  await ensureSupervisorPool(opts.baseDir);
  return { created, commitSha };
}
