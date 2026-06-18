/**
 * super-flow actor 冒泡（reflectable 新对象自沉淀 bootstrap，用户拍板）。
 *
 * 背景：新对象只在 flow session worktree 存在、未进 `stones/main`（不 canonical）。
 * 它自己不能当 super(self) 的 super-flow actor / PR author——会撞 `_builtin/agent/pr 的 pr-issue.ts`
 * 的 `ensureAuthorExists`（author 必须在 `stones/main/objects/<id>/`）。
 *
 * 解法（沿用冒泡机制）：`talk(target="super")` 时，把 super-alias 的 callee 从「caller 自身」
 * 改为「最近的 canonical 祖先」。由该 canonical 祖先以 super flow 身份把新对象首版经
 * feat-branch PR 沉淀进 main——author=祖先（canonical），ensureAuthorExists 自然通过，
 * 无需放宽 author 校验。
 *
 * canonical 定义与 ensureAuthorExists 严格一致：`stones/main/objects/<nestedObjectPath(id)>/`
 * 目录存在（`stoneDir({_stonesBranch:"main"})` + isDirectory）。
 */

import { stat } from "node:fs/promises";
import { stoneDir, STONES_MAIN_BRANCH } from "./common";
import { ancestorObjectIds } from "./stone-object";

/** 冒泡兜底落点：根 parent，恒 canonical（bootstrap 实例化进 stones/main/objects/supervisor）。 */
export const SUPER_ACTOR_FALLBACK = "supervisor";

/**
 * objectId 是否 canonical = `stones/main/objects/<nestedObjectPath(id)>/` 目录存在。
 * 与 `_builtin/agent/pr 的 pr-issue.ts:ensureAuthorExists` 用同一寻址（stoneDir + isDirectory），保证
 * 选出的 actor 一定能通过 author 校验。
 */
export async function isCanonicalObject(baseDir: string, objectId: string): Promise<boolean> {
  if (!objectId) return false;
  try {
    const s = await stat(stoneDir({ baseDir, objectId, _stonesBranch: STONES_MAIN_BRANCH }));
    return s.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * 解析 super-flow actor（super-alias 的 callee）。
 *
 * - callerObjectId 自身 canonical → 返回它自身（**canonical caller 透明、行为不变**：
 *   自我演化的 super(self) 路径逐字节不受影响）。
 * - 否则沿 parent 链由近及远冒泡，返回最近的 canonical 祖先。
 * - 顶层新对象（无路径 parent）或一路无 canonical 祖先 → 落 supervisor（根 parent，恒 canonical）。
 *
 * `ancestorObjectIds` 复用 stone-object（root→immediate-parent 序），这里 reverse 取「由近及远」
 * 以选最近 canonical 祖先。
 */
export async function resolveSuperActor(baseDir: string, callerObjectId: string): Promise<string> {
  if (await isCanonicalObject(baseDir, callerObjectId)) return callerObjectId;
  for (const ancestor of [...ancestorObjectIds(callerObjectId)].reverse()) {
    if (await isCanonicalObject(baseDir, ancestor)) return ancestor;
  }
  return SUPER_ACTOR_FALLBACK;
}
