import { dirname } from "node:path";
import { BUILTIN_OBJECT_IDS } from "../_shared/types/thread.js";

/**
 * 解析 builtin 五件套所在的**框架包**目录（运行进程的 `@ooc/builtins/<id>`）。
 *
 * 根因（2026-06-07）：旧 `stoneDir(builtinRef)` 把 builtin 解析到
 * `<world>/packages/@ooc/builtins/<id>`（`common.ts:86`），而任何 world 该目录都为空
 * —— builtin 的 self.md / readable / knowledge 磁盘读永远落空，supervisor 一直靠 LLM
 * 即兴演角色。builtin 定义随框架代码发布，应从**运行进程**按包名解析，与 world 目录无关。
 *
 * 仅用于**读**路径（builtin 不可写；写仍走 stoneDir 且对 builtin 无意义）。
 * 接受裸 id（`supervisor`）与 `_builtin/<id>` 前缀两种形态。非 builtin id 返回 undefined。
 */
export function resolveBuiltinDir(objectId: string): string | undefined {
  const isPrefixed = objectId.startsWith("_builtin/");
  const id = isPrefixed ? objectId.slice("_builtin/".length) : objectId;
  if (!isPrefixed && !BUILTIN_OBJECT_IDS.has(id)) return undefined;
  try {
    return dirname(Bun.resolveSync(`@ooc/builtins/${id}/package.json`, process.cwd()));
  } catch {
    return undefined;
  }
}

/**
 * 给五件套**读**路径用的 builtin 目录解析：ref 是 builtin 且非 session worktree（无
 * `_stonesBranch`）时返回框架包目录，否则返回 undefined（caller 回退到 `stoneDir(ref)`）。
 * worktree ref（业务 session 试验层）不走框架包——builtin 不参与 worktree 版本化。
 */
export function resolveBuiltinReadDir(ref: {
  objectId: string;
  _stonesBranch?: string | null;
}): string | undefined {
  if (ref._stonesBranch != null) return undefined;
  return resolveBuiltinDir(ref.objectId);
}
