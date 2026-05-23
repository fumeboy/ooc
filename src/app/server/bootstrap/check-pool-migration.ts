/**
 * Bootstrap warning for stone→pool migration（2026-05-23）。
 *
 * 当某 stone object 还有 `knowledge/` / `files/` 子目录、但对应的 pool
 * `pools/objects/<id>/{knowledge,files}` 不存在时，启动期 console.warn 提示用户
 * 跑一次性迁移命令：
 *
 *   bun run src/app/server/bootstrap/migrate-stone-knowledge-to-pool.ts --world <baseDir>
 *
 * 不自动迁移（CLAUDE.md "不悄悄做"），不阻塞启动。
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { STONES_MAIN_BRANCH, STONE_OBJECTS_SUBDIR } from "@src/persistable";
import { poolKnowledgeDir, poolFilesDir } from "@src/persistable/pool-object";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface PoolMigrationCheckResult {
  /** Object 数: 仍持有 stone 层 knowledge/ 但 pool 还没建。 */
  knowledgeNeedsMigrate: string[];
  /** Object 数: 仍持有 stone 层 files/ 但 pool 还没建。 */
  filesNeedsMigrate: string[];
}

/**
 * 扫描 stones/<branch>/objects/ 下所有 Object，对每个检查 stone 侧 knowledge/files
 * 是否存在但 pool 侧目标不存在。返回需迁移的 objectId 列表，由调用方决定是否警告。
 *
 * 静默策略：任何 fs 错误（除 ENOENT 自然处理）都吞掉——这只是个 advisory。
 */
export async function checkStoneToPoolMigration(opts: {
  baseDir: string;
  branch?: string;
}): Promise<PoolMigrationCheckResult> {
  const branch = opts.branch ?? STONES_MAIN_BRANCH;
  const objectsDir = join(opts.baseDir, "stones", branch, STONE_OBJECTS_SUBDIR);
  let entries;
  try {
    entries = await readdir(objectsDir, { withFileTypes: true });
  } catch {
    return { knowledgeNeedsMigrate: [], filesNeedsMigrate: [] };
  }
  const knowledgeNeedsMigrate: string[] = [];
  const filesNeedsMigrate: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const objectId = e.name;
    const stoneKnowledge = join(objectsDir, objectId, "knowledge");
    const stoneFiles = join(objectsDir, objectId, "files");
    const poolKnowledge = poolKnowledgeDir({ baseDir: opts.baseDir, objectId });
    const poolFiles = poolFilesDir({ baseDir: opts.baseDir, objectId });
    try {
      if ((await pathExists(stoneKnowledge)) && !(await pathExists(poolKnowledge))) {
        knowledgeNeedsMigrate.push(objectId);
      }
      if ((await pathExists(stoneFiles)) && !(await pathExists(poolFiles))) {
        filesNeedsMigrate.push(objectId);
      }
    } catch {
      // ignore per-object failures
    }
  }
  return { knowledgeNeedsMigrate, filesNeedsMigrate };
}

/** 把检查结果用 console.warn 输出（如果非空）；空时不 noisy。 */
export function reportPoolMigration(result: PoolMigrationCheckResult, baseDir: string): void {
  const k = result.knowledgeNeedsMigrate.length;
  const f = result.filesNeedsMigrate.length;
  if (k === 0 && f === 0) return;
  console.warn(
    `[ooc-app-server] stone→pool migration pending: ${k} object(s) with knowledge/, ` +
      `${f} object(s) with files/ — run:`,
  );
  console.warn(
    `  bun run src/app/server/bootstrap/migrate-stone-knowledge-to-pool.ts --world ${baseDir}`,
  );
  if (k > 0) console.warn(`  knowledge: ${result.knowledgeNeedsMigrate.join(", ")}`);
  if (f > 0) console.warn(`  files:     ${result.filesNeedsMigrate.join(", ")}`);
}
