import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILTIN_OBJECT_IDS,
  resolveBuiltinDir,
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
 * world bootstrap：把声明 `ooc.kind === "object"` 的框架 builtin 包幂等实例化为
 * `objects/<id>` 的可交互 world object。
 *
 * 判定（Wave 4 裁决）：`instantiate_with_new_world` 字段废弃——builtin 包自身用
 * `kind:"object"` 表态「这就是个实例」（如 supervisor / user）。`kind:"class"` 的纯定义包
 * （`_builtin/<id>` 五件套，如 plan/file/...）不实例化，仅供经 `ooc.class` 继承寻址。
 *
 * 对每个 `kind:"object"` 的 builtin：
 * - 若 `objects/<id>/` 已存在 → 跳过（幂等，保住用户对实例 self.md 的改动）；
 * - 否则建 object：拷贝该包的 self.md（own 身份）、`ooc.class` 取该包声明的父类
 *   （缺省不设 class，如 user）、commit on main（走 stone-versioning worktree → ff merge）。
 *
 * self.md 经 builtin 寻址从框架包读（resolveBuiltinDir / readSelf）；instance 落
 * `stones/main/objects/<id>/`。
 */
export async function instantiateBuiltinClassObjects(opts: {
  baseDir: string;
}): Promise<InstantiateClassesResult> {
  const { baseDir } = opts;
  const service = createStonesService({ baseDir });
  const instantiated: string[] = [];
  const skipped: string[] = [];

  for (const id of BUILTIN_OBJECT_IDS) {
    const builtinDir = resolveBuiltinDir(id);
    if (!builtinDir) continue;
    let pkg: { ooc?: { kind?: unknown; class?: unknown } } | undefined;
    try {
      pkg = JSON.parse(await readFile(join(builtinDir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    // 只实例化自声明为 object 的 builtin（替代废弃的 instantiate_with_new_world 判定）。
    if (pkg?.ooc?.kind !== "object") continue;

    // 幂等：instance object 已存在则跳过。
    if (existsSync(join(stoneDir({ baseDir, objectId: id }), "package.json"))) {
      skipped.push(id);
      continue;
    }

    // self.md 从 builtin 框架包目录直接读（kind:"object" 包的 self.md 就在包根；bare id
    // 不经 resolveBuiltinReadDir，故不走 readSelf）拷贝为 instance own 身份。
    let builtinSelf = "";
    try {
      builtinSelf = await readFile(join(builtinDir, "self.md"), "utf8");
    } catch {
      builtinSelf = "";
    }
    const parentClass =
      typeof pkg.ooc.class === "string" && pkg.ooc.class.length > 0
        ? pkg.ooc.class
        : undefined;
    await service.createStone({
      objectId: id,
      self: builtinSelf,
      ...(parentClass ? { class: parentClass } : {}),
    });
    instantiated.push(id);
  }

  return { instantiated, skipped };
}
