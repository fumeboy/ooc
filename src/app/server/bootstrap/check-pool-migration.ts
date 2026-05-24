/**
 * Bootstrap warning for stone→pool migration（2026-05-23）。
 *
 * 当某 stone object 还有 `knowledge/` / `files/` 子目录、但对应的 pool
 * `pools/objects/<id>/{knowledge,files}` 不存在时，启动期 console.warn 提示用户
 * 处理一下。
 *
 * **2026-05-24 注意事项**:
 * knowledge 已改为 **seed / sediment 二分**（详见
 * meta/object.doc.ts persistable.stone.children.seed_knowledge）：
 * - `stones/<self>/knowledge/` 现在是 **seed knowledge** 的合法路径（不再需要迁移）。
 * - 只有"运行时沉淀"语义的旧条目才属于 sediment、应当迁到 pool。
 *
 * 因此，当本检查发现旧 world 还有 `stones/<id>/knowledge/` 时，**不要简单跑迁移 CLI**
 * 一股脑迁到 pool —— 用户需要参照新二分人工判定每个 .md：
 * - 设计意图/初始能力 → 留在 stone/knowledge（已经是合法位置）。
 * - 运行时沉淀/记忆 → 在 pool/knowledge 下分到 memory/ 或 relations/。
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
    `[ooc-app-server] legacy stone-side knowledge/ or files/ detected: ${k} object(s) with knowledge/, ` +
      `${f} object(s) with files/.`,
  );
  console.warn(
    `  NOTE (2026-05-24): knowledge is now split seed (stone) / sediment (pool). Do NOT just run the migrate ` +
      `CLI to move everything to pool — inspect each .md and decide whether it is seed (design intent → keep ` +
      `under stones/<branch>/objects/<id>/knowledge/, the new legitimate path) or sediment (runtime accumulation ` +
      `→ move into pools/objects/<id>/knowledge/{memory,relations}/).`,
  );
  console.warn(
    `  If you still want the legacy bulk-migrate (treats everything as sediment), run:`,
  );
  console.warn(
    `  bun run src/app/server/bootstrap/migrate-stone-knowledge-to-pool.ts --world ${baseDir}`,
  );
  if (k > 0) console.warn(`  knowledge: ${result.knowledgeNeedsMigrate.join(", ")}`);
  if (f > 0) console.warn(`  files:     ${result.filesNeedsMigrate.join(", ")}`);
}
