/**
 * Bootstrap warning for stone→pool migration（2026-05-23 / 修订 2026-05-25）。
 *
 * **2026-05-25 修订（Round 6 Batch C, AgentOfPersistable）**:
 * 旧逻辑触发条件 "stones/<id>/knowledge/ 存在 AND pools/objects/<id>/knowledge/ 不存在"
 * 在 seed / sediment 二分后失真——任何含 seed 的合法 stone（如 supervisor 5 篇 seed
 * knowledge）都会被打"legacy"标签，导致警告永久挂着、无 actionable 含义。
 *
 * 现在按 **sediment 形态信号** 触发：
 * - stone 下 `knowledge/memory/` 或 `knowledge/relations/` 子目录存在 → 这是 sediment
 *   命名约定（详见 meta/object.doc.ts persistable.pool.children.knowledge_pool），出现
 *   在 stone 侧意味着旧 world 把 sediment 错存到了 stone 层，**应当迁移到 pool**。
 * - stone 下 `files/` 存在 → files 是 sediment-only（meta 已固化），出现在 stone 侧
 *   同样应当迁移。
 * - stone 下 `knowledge/<*.md>`（无 memory/relations 子目录）→ 这是 **seed knowledge**
 *   的合法形态，**不触发警告**。
 *
 * 配合 ensure-supervisor / ensure-user 现在在 bootstrap 时预创 pool skeleton
 * (pools/objects/<id>/{knowledge/{memory,relations},files}) ——这是 M-5 体验官报告的
 * /api/tree?scope=world&path=pools/objects/supervisor/knowledge 404 的根因解。
 *
 * 不自动迁移（CLAUDE.md "不悄悄做"），不阻塞启动。
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { poolKnowledgeMemoryDir, poolKnowledgeRelationsDir, poolFilesDir } from "@ooc/core/persistable/pool-object";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface PoolMigrationCheckResult {
  /** Object id: 仍在 stone 下持有 `knowledge/memory/` 或 `knowledge/relations/` 子目录（sediment 错位）。 */
  sedimentInStoneKnowledge: string[];
  /** Object id: 仍在 stone 下持有 `files/`（sediment-only，应迁 pool）。 */
  sedimentInStoneFiles: string[];
}

/**
 * 扫描 packages/ 下所有 Object，识别 package 侧错放的 sediment：
 * - `knowledge/memory/` 或 `knowledge/relations/` 子目录 → sedimentInStoneKnowledge
 * - `files/` 目录       → sedimentInStoneFiles
 *
 * 与对应 pool 是否已存在 **无关** —— 即使 pool 已有 memory/，只要 stone 里同时还有
 * sediment 痕迹就应该提示用户清理（双源会让 synthesizer 同 idPath 冲突告警）。
 *
 * 静默策略：任何 fs 错误（除 ENOENT 自然处理）都吞掉——这只是个 advisory。
 */
export async function checkStoneToPoolMigration(opts: {
  baseDir: string;
}): Promise<PoolMigrationCheckResult> {
  const packagesDir = join(opts.baseDir, "packages");
  let entries;
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    return { sedimentInStoneKnowledge: [], sedimentInStoneFiles: [] };
  }
  const sedimentInStoneKnowledge: string[] = [];
  const sedimentInStoneFiles: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("@")) continue;
    const objectId = e.name;
    const stoneKnowledgeMemory = join(packagesDir, objectId, "knowledge", "memory");
    const stoneKnowledgeRelations = join(packagesDir, objectId, "knowledge", "relations");
    const stoneFiles = join(packagesDir, objectId, "files");
    try {
      if ((await pathExists(stoneKnowledgeMemory)) || (await pathExists(stoneKnowledgeRelations))) {
        sedimentInStoneKnowledge.push(objectId);
      }
      if (await pathExists(stoneFiles)) {
        sedimentInStoneFiles.push(objectId);
      }
    } catch {
      // ignore per-object failures
    }
  }
  // 显式 reference unused exports to keep tsc happy and signal intent of these helpers
  void poolKnowledgeMemoryDir;
  void poolKnowledgeRelationsDir;
  void poolFilesDir;
  return { sedimentInStoneKnowledge, sedimentInStoneFiles };
}

/** 把检查结果用 console.warn 输出（如果非空）；空时不 noisy。 */
export function reportPoolMigration(result: PoolMigrationCheckResult, baseDir: string): void {
  const k = result.sedimentInStoneKnowledge.length;
  const f = result.sedimentInStoneFiles.length;
  if (k === 0 && f === 0) return;
  console.warn(
    `[ooc-app-server] sediment-shaped content detected under packages/: ${k} object(s) with ` +
      `knowledge/{memory,relations}/, ${f} object(s) with files/.`,
  );
  console.warn(
    `  These dirs are sediment-only by 2026-05-24 seed/sediment split — they should live under ` +
      `pools/objects/<id>/{knowledge,files}/, NOT packages/. Move them, then \`rm -r\` the package-side copy.`,
  );
  console.warn(
    `  Bulk migrate CLI (treats stone knowledge as sediment; review report after):`,
  );
  console.warn(
    `  bun run src/app/server/bootstrap/migrate-stone-knowledge-to-pool.ts --world ${baseDir}`,
  );
  if (k > 0) console.warn(`  knowledge sediment: ${result.sedimentInStoneKnowledge.join(", ")}`);
  if (f > 0) console.warn(`  files sediment:     ${result.sedimentInStoneFiles.join(", ")}`);
}
