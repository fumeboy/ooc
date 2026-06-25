import { dirname } from "node:path";
import { BUILTIN_OBJECT_IDS } from "../types/paths.js";

/**
 * 解析 builtin 五件套所在的**框架包**目录（运行进程的 `@ooc/builtins/<id>`）。
 *
 * 根因：旧 `stoneDir(builtinRef)` 把 builtin 解析到
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
 * 给五件套**读**路径用的 builtin **class** 目录解析：仅当 ref.objectId 是 `_builtin/<id>`
 * 显式 class 寻址（且非 worktree）时返回框架包目录，否则 undefined（caller 回退 stoneDir）。
 *
 * **bare builtin id（如 "supervisor"）不再走框架包**——它现在是 `objects/<id>` 下由 class
 * 实例化的普通 object，五件套读自己的实例目录（其 self.md 是 class self.md 的拷贝）。
 * 只有 class 本身（`_builtin/supervisor`）才读框架包。这避免了 instance 与 class 同名时
 * 实例磁盘被框架遮蔽。
 */
export function resolveBuiltinReadDir(ref: {
  objectId: string;
  _stonesBranch?: string | null;
}): string | undefined {
  if (ref._stonesBranch != null) return undefined;
  if (!ref.objectId.startsWith("_builtin/")) return undefined;
  return resolveBuiltinDir(ref.objectId);
}
