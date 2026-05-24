/**
 * Bootstrap advisory for stale stone-side `database/` subdirectories（2026-05-24）。
 *
 * 背景:
 * 2026-05-23 引入 stone "六件套"时曾在 `stones/<branch>/objects/<id>/` 下创建
 * `database/{schemas,migrations}/` 子目录，作为 pool/sql 的 schema 设计层。
 * 2026-05-24 二次简化删掉了 sql_pool / migration runner，改用 csv 作为结构化数据载体
 * （详见 meta/object.doc.ts persistable.pool.children.data_pool）；
 * 此时 stone 缩回"五件套"（self / readme / server / client / knowledge），
 * `database/` 已无任何语义。
 *
 * 本检查：扫描旧 world 中残留的 `stones/<branch>/objects/<id>/database/`，
 * console.warn 提示用户在 stones worktree 内手工 `git rm -r database/` + commit
 * 清理形态。空目录无害，所以不强制；这只是个 advisory。
 *
 * 静默策略：任何 fs 错误（除 ENOENT 自然处理）都吞掉——这只是个 advisory，
 * 绝不阻塞 server 启动。
 *
 * 与 check-pool-migration.ts 风格保持对称：异步 + try/catch 静默 + 只 warn 不报错。
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { STONES_MAIN_BRANCH, STONE_OBJECTS_SUBDIR } from "@src/persistable";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface StaleDatabaseDirCheckResult {
  /** Object ids whose stone-side database/ subdir still exists（按 branch 维度返回扁平 id 列表）。 */
  staleObjectIds: string[];
  /** 扫描时使用的 stones branch 名（用于 warn 文本拼接路径）。 */
  branch: string;
}

/**
 * 扫描 stones/<branch>/objects/ 下所有 Object，找出仍持有 `database/` 子目录的对象。
 *
 * 完全 advisory：
 * - 不存在的 world / 缺失的 stones/ 目录 → 返回空结果（不抛错）。
 * - 任何 per-object fs 错误 → 吞掉继续扫下一个。
 */
export async function scanStaleDatabaseDir(opts: {
  baseDir: string;
  branch?: string;
}): Promise<StaleDatabaseDirCheckResult> {
  const branch = opts.branch ?? STONES_MAIN_BRANCH;
  const objectsDir = join(opts.baseDir, "stones", branch, STONE_OBJECTS_SUBDIR);
  let entries;
  try {
    entries = await readdir(objectsDir, { withFileTypes: true });
  } catch {
    return { staleObjectIds: [], branch };
  }
  const staleObjectIds: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const objectId = e.name;
    const databaseDir = join(objectsDir, objectId, "database");
    try {
      if (await pathExists(databaseDir)) {
        staleObjectIds.push(objectId);
      }
    } catch {
      // ignore per-object failures
    }
  }
  return { staleObjectIds, branch };
}

/** 把扫描结果用 console.warn 输出（如果非空）；空时不 noisy。 */
export function reportStaleDatabaseDir(
  result: StaleDatabaseDirCheckResult,
  baseDir: string,
): void {
  const n = result.staleObjectIds.length;
  if (n === 0) return;
  console.warn(
    `[ooc-app-server] stale stone-side database/ subdirs detected: ${n} object(s). ` +
      `These were created in the 2026-05-23 "six-piece stone" layout; the 2026-05-24 simplification ` +
      `removed sql_pool / migration_runner, so database/ no longer has semantics (stone is now five-piece: ` +
      `self / readme / server / client / knowledge).`,
  );
  console.warn(
    `  Suggestion: in each stones worktree, run \`git rm -r objects/<id>/database/\` and commit to clean ` +
      `up the stone shape. Empty directories are harmless, so this is not mandatory.`,
  );
  console.warn(
    `  Affected (under stones/${result.branch}/${STONE_OBJECTS_SUBDIR}/<id>/database/): ` +
      result.staleObjectIds.join(", "),
  );
  console.warn(`  Base dir: ${baseDir}`);
}

/**
 * 启动期入口：扫 + warn 一体。失败完全静默。
 *
 * 调用方式（src/app/server/index.ts）：
 *
 *   await checkStaleDatabaseDir(config.baseDir, config.stonesBranch);
 */
export async function checkStaleDatabaseDir(
  baseDir: string,
  branch?: string,
): Promise<void> {
  try {
    const result = await scanStaleDatabaseDir({ baseDir, branch });
    reportStaleDatabaseDir(result, baseDir);
  } catch {
    // advisory only; never throw / never block startup
  }
}
