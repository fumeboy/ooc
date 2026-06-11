import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILTIN_OBJECT_IDS,
  resolveBuiltinDir,
  readSelf,
  stoneDir,
} from "@ooc/core/persistable";
import { createStonesService } from "../modules/stones/service";

export interface InstantiateClassesResult {
  /** 本次新建的 instance objectId */
  instantiated: string[];
  /** 已存在、跳过的 objectId（幂等） */
  skipped: string[];
}

/**
 * world bootstrap：把带 `ooc.instantiate_with_new_world` 的框架 builtin **class** 幂等
 * 实例化为 `objects/<id>` 的可交互 object。
 *
 * 对每个这样的 class：
 * - 若 `objects/<id>/` 已存在 → 跳过（幂等，保住用户对实例 self.md 的改动）；
 * - 否则建 object：拷贝 class 的 self.md（own 身份）、`ooc.class="_builtin/<id>"`（继承 class
 *   方法/行为）、commit on main（走 stone-versioning worktree → ff merge）。
 *
 * class 经 `_builtin/<id>` 寻址从框架包读（resolveBuiltinDir / readSelf）；instance 落
 * `stones/main/objects/<id>/`（stoneDir 已不再特殊解析 bare builtin id）。
 */
export async function instantiateBuiltinClassObjects(opts: {
  baseDir: string;
}): Promise<InstantiateClassesResult> {
  const { baseDir } = opts;
  const service = createStonesService({ baseDir });
  const instantiated: string[] = [];
  const skipped: string[] = [];

  for (const id of BUILTIN_OBJECT_IDS) {
    const classDir = resolveBuiltinDir(id);
    if (!classDir) continue;
    let pkg: { ooc?: { instantiate_with_new_world?: unknown } } | undefined;
    try {
      pkg = JSON.parse(await readFile(join(classDir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (pkg?.ooc?.instantiate_with_new_world !== true) continue;

    // 幂等：instance object 已存在则跳过。
    if (existsSync(join(stoneDir({ baseDir, objectId: id }), "package.json"))) {
      skipped.push(id);
      continue;
    }

    // class 的 self.md（经 _builtin/ 寻址从框架包读）拷贝为 instance own 身份。
    const classSelf = (await readSelf({ baseDir, objectId: `_builtin/${id}` })) ?? "";
    await service.createStone({ objectId: id, self: classSelf, class: `_builtin/${id}` });
    instantiated.push(id);
  }

  return { instantiated, skipped };
}
