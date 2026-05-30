// src/app/server/bootstrap/ensure-builtin-objects.ts
/**
 * ensureBuiltinObjects — World bootstrap invariant：物化 8 个 builtin 原型骨架到
 * stones/_builtin/objects/<proto>/。
 *
 * _builtin 是框架派生投影：覆盖式重生（每启动从 builtin-seed 重写），不进 git
 * （createStoneObject 纯 fs；_builtin 在 main worktree 之外）。builtin 不可被用户
 * override（spec §3.2），故覆盖安全。L3 只物化骨架；behavior 由 L4 转写。
 */

import { createStoneObject, writeSelf, writeReadable } from "@src/persistable";
import { BUILTIN_BRANCH } from "@src/executable/prototype";
import { BUILTIN_PROTOTYPES, buildSelfMd } from "./builtin-seed";

/** ensureBuiltinObjects 结果。 */
export interface EnsureBuiltinObjectsResult {
  /** 本次物化的原型名（覆盖式，每次都是全部）。 */
  materialized: string[];
}

/**
 * 物化全部 builtin 原型。覆盖式幂等：每次都对 8 原型 createStoneObject + writeSelf
 * （+ root writeReadable），同 seed → 同输出。
 */
export async function ensureBuiltinObjects(opts: { baseDir: string }): Promise<EnsureBuiltinObjectsResult> {
  const materialized: string[] = [];
  for (const seed of BUILTIN_PROTOTYPES) {
    const ref = { baseDir: opts.baseDir, objectId: seed.name, stonesBranch: BUILTIN_BRANCH };
    await createStoneObject(ref);
    await writeSelf(ref, buildSelfMd(seed));
    if (seed.readable !== undefined && seed.readable.length > 0) {
      await writeReadable(ref, seed.readable);
    }
    materialized.push(seed.name);
  }
  return { materialized };
}
