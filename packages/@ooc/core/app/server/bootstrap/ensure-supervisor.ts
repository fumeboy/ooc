/**
 * ensureSupervisorObject — World bootstrap invariant：确保 supervisor object package 存在。
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
 * 1. 第一启动自动建 supervisor package（self.md / readable.md / 5 篇 seed knowledge）
 * 2. 后续启动 idempotent skip（package 已存在则跳过）
 * 3. recovery-check / metaprog R12 等所有依赖 supervisor 的协议都得到稳定锚点
 *
 * 2026-06-01 bun workspace 迁移：从 stones/ 移到 packages/，移除 branch 概念。
 */

import { stat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  packageDir,
  stoneDir,
  stoneKnowledgeDir,
  createStoneObject,
  writeSelf,
  writeReadme,
} from "@ooc/core/persistable";
import { createPoolObject, poolMetadataFile } from "@ooc/core/persistable/pool-object";
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
 * 检查 supervisor package 是否已存在。
 *
 * 通过 stat `packages/supervisor/package.json` 判定——这是
 * createStoneObject 必写的元数据文件，比检查整目录更精确（防御老 world 有
 * 残留空目录的情况）。
 */
async function supervisorStoneExists(baseDir: string): Promise<boolean> {
  const ref = { baseDir, objectId: SUPERVISOR_OBJECT_ID };
  const marker = join(packageDir(ref), "package.json");
  try {
    const st = await stat(marker);
    return st.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * 第一启动时创建 supervisor package。
 *
 * **Bootstrap 直写 packages/**：此时尚未进入 LLM 上下文运行 metaprog 命令，最简
 * 方式是直接 createStoneObject + writeSelf/Readme + 写 seed knowledge。
 *
 * 流程：
 *   1. createStoneObject + writeSelf + writeReadme + 写 seed knowledge
 */
async function createSupervisorStone(baseDir: string): Promise<string | undefined> {
  const ref = { baseDir, objectId: SUPERVISOR_OBJECT_ID };

  // createStoneObject 预创 package.json + self.md (空) + readable.md (空)
  await createStoneObject(ref);
  // 覆盖空占位为真实内容
  await writeSelf(ref, SUPERVISOR_SELF_MD);
  await writeReadme(ref, SUPERVISOR_README_MD);
  // 写 seed knowledge：packages/supervisor/knowledge/<file>
  const knowledgeBaseDir = stoneKnowledgeDir(ref);
  await mkdir(knowledgeBaseDir, { recursive: true });
  for (const [filename, content] of Object.entries(SUPERVISOR_SEED_KNOWLEDGE)) {
    await writeFile(join(knowledgeBaseDir, filename), content, "utf8");
  }

  return undefined; // no commit sha in workspace model
}

/**
 * 启动期入口：确保 supervisor package 存在；idempotent。
 *
 * 调用位置：buildServer 启动期，recovery-check 之前。
 *
 * 失败处理：抛错并退出（bootstrap invariant 失败
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
}): Promise<EnsureSupervisorResult> {
  let commitSha: string | undefined;
  let created = false;
  if (!(await supervisorStoneExists(opts.baseDir))) {
    commitSha = await createSupervisorStone(opts.baseDir);
    created = true;
  }
  // pool skeleton: idempotent，与 stone 创建解耦——已有 stone 但缺 pool 的旧 world 也补建
  await ensureSupervisorPool(opts.baseDir);
  return { created, commitSha };
}
