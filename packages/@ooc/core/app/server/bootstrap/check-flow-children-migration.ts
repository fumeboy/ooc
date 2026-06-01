/**
 * Bootstrap migration: flow 子 object 物理布局从 flat 嵌套迁移到 children/ marker（2026-05-27）。
 *
 * 历史上 `objectDir()` 直接 `join(... ref.objectId)`，objectId 中的 "/" 被 path.join
 * 解释为目录分隔符，sub-object 落在 `<sid>/<a>/<b>/`，与 stone 的 `packages/<a>/children/<b>/`
 * 不对称。本次统一为 children/ 嵌套。
 *
 * 启动时扫所有 session：把任何 `<sid>/<a>/<b>/` 形态（即非 children/ 子目录里又含
 * .flow.json 的目录）平移到 `<sid>/<a>/children/<b>/`。幂等：已在 children/ 下的不动。
 *
 * 失败时 console.warn 不抛——bootstrap 不让一次磁盘异常拖垮启动。
 */

import { readdir, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { STONE_CHILDREN_SUBDIR } from "@ooc/core/persistable";

async function isFlowObjectDir(dir: string): Promise<boolean> {
  try {
    const s = await stat(join(dir, ".flow.json"));
    return s.isFile();
  } catch {
    return false;
  }
}

async function migrateUnderObjectDir(parentObjectDir: string): Promise<number> {
  let moved = 0;
  let entries;
  try {
    entries = await readdir(parentObjectDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "threads" || e.name === "knowledge" || e.name === "files" || e.name === "data" || e.name === "database" || e.name === STONE_CHILDREN_SUBDIR) continue;
    const childDir = join(parentObjectDir, e.name);
    if (!(await isFlowObjectDir(childDir))) continue;
    // 旧 flat 嵌套：把它挪进 children/
    const childrenDir = join(parentObjectDir, STONE_CHILDREN_SUBDIR);
    await mkdir(childrenDir, { recursive: true });
    const dest = join(childrenDir, e.name);
    await rename(childDir, dest);
    moved += 1;
    // 递归：被挪进 children/ 后内部可能还有更深 flat 嵌套
    moved += await migrateUnderObjectDir(dest);
  }
  return moved;
}

async function migrateSession(sessionDir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(sessionDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let moved = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const root = join(sessionDir, e.name);
    if (!(await isFlowObjectDir(root))) continue;
    moved += await migrateUnderObjectDir(root);
  }
  return moved;
}

export async function checkFlowChildrenMigration(baseDir: string): Promise<{ migrated: number }> {
  let total = 0;
  try {
    const flowsDir = join(baseDir, "flows");
    const sessions = await readdir(flowsDir, { withFileTypes: true });
    for (const s of sessions) {
      if (!s.isDirectory()) continue;
      total += await migrateSession(join(flowsDir, s.name));
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[flow-children-migration] failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (total > 0) {
    console.warn(`[flow-children-migration] migrated ${total} sub-object dir(s) to children/ marker`);
  }
  return { migrated: total };
}
