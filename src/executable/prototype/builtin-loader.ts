// src/executable/prototype/builtin-loader.ts
import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { STONE_OBJECTS_SUBDIR } from "../../persistable";
import { BUILTIN_BRANCH } from "./constants";
import { loadObjectRecord, type ObjectRecord } from "./object-record";
import { buildObjectRegistry, type ObjectRegistry } from "./registry";

/**
 * 扫描 stones/_builtin/objects/ 下全部原型，loadObjectRecord 每个，build 成 L2 registry
 * （含拓扑校验）。_builtin 目录缺失 → fail-loud。
 *
 * L3 阶段仅被测试消费；接入活 render/command resolve 是 L4。
 */
export async function loadBuiltinRegistry(baseDir: string): Promise<ObjectRegistry> {
  const dir = join(baseDir, "stones", BUILTIN_BRANCH, STONE_OBJECTS_SUBDIR);
  // 必须显式 cast `as Dirent[]`：withFileTypes 在本仓库 tsconfig(types:[bun,node]) 下
  // 会解析成 Buffer 重载 Dirent<NonSharedBuffer>[]，使 e.name 变 Buffer 导致 .startsWith
  // 报 tsc error。沿用既有 precedent src/app/server/modules/ui/service.ts:88-92。
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`loadBuiltinRegistry: ${dir} 不存在——ensureBuiltinObjects 未运行?`);
    }
    throw error;
  }
  const protoNames = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

  const records: ObjectRecord[] = [];
  for (const name of protoNames) {
    records.push(await loadObjectRecord({ baseDir, objectId: name, stonesBranch: BUILTIN_BRANCH }));
  }
  return buildObjectRegistry(records);
}
