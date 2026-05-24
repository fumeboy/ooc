/**
 * ensureSupervisorObject — World bootstrap invariant：确保 supervisor stone 存在。
 *
 * 设计动机（2026-05-25 user 指令）：
 *   "初始的 OOC World 没有初始的 OOC Agent 对象；支持初始化 World 时一并初始化
 *    一个 supervisor 对象。"
 *
 * 也是体验官 R5 #32 caveat 的彻底解：recovery-check 之前假设 supervisor 存在
 * 但空 world 没有，导致 [recovery-needed] PR-Issue 创建抛错被静默吞、broken
 * 列表丢失。supervisor 升格为 bootstrap invariant 后：
 *
 * 1. 第一启动自动建 supervisor stone（self.md / readme.md / 5 篇 seed knowledge）
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
  writeReadme,
  STONES_MAIN_BRANCH,
  gitCommitAll,
} from "@src/persistable";
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
 * **Supervisor 不走 metaprog worktree**（R12 例外，见 stone-versioning.ts:122）：
 * supervisor 是自治区外的协调者，stone 改动不该走"metaprog branch + PR-Issue
 * review"流程（流程本身需要 supervisor 审阅，circular）。直写 main worktree。
 *
 * 流程：
 *   1. ref 用 stonesBranch="main"（main worktree path）
 *   2. createStoneObject + writeSelf + writeReadme + 写 seed knowledge
 *   3. gitCommitAll 把 main worktree 全部新增 stage + commit（author=supervisor）
 *
 * 失败时抛错（启动期一次性副作用 — 与 ensureStoneRepo 同风格）。
 */
async function createSupervisorStone(baseDir: string, branch: string): Promise<string | undefined> {
  const ref = { baseDir, objectId: SUPERVISOR_OBJECT_ID, stonesBranch: branch };

  // createStoneObject 预创 .stone.json + self.md (空) + readme.md (空)
  await createStoneObject(ref);
  // 覆盖空占位为真实内容
  await writeSelf(ref, SUPERVISOR_SELF_MD);
  await writeReadme(ref, SUPERVISOR_README_MD);
  // 写 seed knowledge：stones/<branch>/objects/supervisor/knowledge/<file>
  const knowledgeBaseDir = stoneKnowledgeDir(ref);
  await mkdir(knowledgeBaseDir, { recursive: true });
  for (const [filename, content] of Object.entries(SUPERVISOR_SEED_KNOWLEDGE)) {
    await writeFile(join(knowledgeBaseDir, filename), content, "utf8");
  }

  // git commit on main worktree (R12 supervisor 例外: 直写 main, 不走 metaprog branch)
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
export async function ensureSupervisorObject(opts: {
  baseDir: string;
  branch?: string;
}): Promise<EnsureSupervisorResult> {
  const branch = opts.branch ?? STONES_MAIN_BRANCH;
  if (await supervisorStoneExists(opts.baseDir, branch)) {
    return { created: false };
  }
  const commitSha = await createSupervisorStone(opts.baseDir, branch);
  return { created: true, commitSha };
}
