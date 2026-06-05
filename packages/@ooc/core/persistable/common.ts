import { join } from "node:path";
import { readdir } from "node:fs/promises";

/**
 * flow/stone 引用类型 + 纯路径函数的 canonical 源已于 batch C5 迁入
 * `@ooc/core/_shared/types/thread.ts`（零依赖层，打破 thinkable ↔ persistable 类型耦合）。
 * 此处 re-export 保持旧 import 路径 (`persistable/common`) 可用。
 *
 * **留在本文件**的是带 IO / 路径路由的实现：objectDir / threadDir / stoneDir /
 * _deprecatedPackageDir / resolveStoneDir（依赖 node:path / node:fs，不可下沉 `_shared`）
 * 以及它们专用的 STONE_OBJECTS_SUBDIR 常量。
 */
export type {
  FlowObjectRef,
  ThreadPersistenceRef,
  StoneObjectRef,
} from "../_shared/types/thread.js";
export {
  STONE_CHILDREN_SUBDIR,
  BUILTIN_OBJECT_IDS,
  nestedObjectPath,
  isBuiltinObjectId,
  toJson,
  deriveStoneFromThread,
} from "../_shared/types/thread.js";

import type { FlowObjectRef, ThreadPersistenceRef, StoneObjectRef } from "../_shared/types/thread.js";
import { BUILTIN_OBJECT_IDS, nestedObjectPath } from "../_shared/types/thread.js";

/**
 * Intermediate `objects/` dir in the versioning-worktree layout
 * `stones/<branch>/objects/<id>`. The flat canonical layout (`stones/<id>`)
 * omits it, but git metaprog worktrees and the main-branch mirror still use it.
 */
export const STONE_OBJECTS_SUBDIR = "objects";

/** stones git 主分支名常量，与 fast-forward-to-main 语义对齐。 */
export const STONES_MAIN_BRANCH = "main";

/** bare 仓库目录名（plugins_worktrees 风格的 `.plugins_repo` 等价物）。 */
export const STONES_BARE_REPO_DIR = ".stones_repo";

/**
 * 计算 flow object 目录绝对路径。objectId 中的 "/" 被翻译为 children/ 嵌套
 * （与 stoneDir 对称；详见 nestedObjectPath）。
 */
export function objectDir(ref: FlowObjectRef): string {
  return join(
    ref.baseDir,
    "flows",
    ref.sessionId,
    ...nestedObjectPath(ref.objectId),
  );
}

/** 计算线程目录绝对路径，被 thread-json 与 debug-file 共用。 */
export function threadDir(ref: ThreadPersistenceRef): string {
  return join(objectDir(ref), "threads", ref.threadId);
}

/**
 * 计算 object stone 目录绝对路径（canonical，M2 2026-06-03）。
 *
 * Routing priority:
 * 1. `_stonesBranch` set → versioning worktree: `stones/{_stonesBranch}/objects/{nestedPath}`
 * 2. Builtin ids (_builtin/*, supervisor, user) → `packages/@ooc/builtins/<id>` in the repo or World node_modules
 * 3. Flat stone path (default): `stones/{nestedPath}`
 * 4. Fallback (deprecated): `packages/{nestedPath}` — warns on use, kept for one release
 *
 * `nestedPath` translates "/" in objectId into `children/` segments.
 */
export function stoneDir(ref: StoneObjectRef): string {
  if (ref._stonesBranch != null) {
    return join(
      ref.baseDir,
      "stones",
      ref._stonesBranch,
      STONE_OBJECTS_SUBDIR,
      ...nestedObjectPath(ref.objectId),
    );
  }
  if (ref.objectId.startsWith("_builtin/")) {
    const builtinType = ref.objectId.slice("_builtin/".length);
    return join(ref.baseDir, "packages", "@ooc", "builtins", builtinType);
  }
  if (BUILTIN_OBJECT_IDS.has(ref.objectId)) {
    return join(ref.baseDir, "packages", "@ooc", "builtins", ref.objectId);
  }
  // canonical = main 分支 worktree（P1 收口，2026-06-05；用户拍板：保留 stone git 分支设计，
  // main = canonical）。等价 _stonesBranch="main"；对象 bootstrap 即落 stones/main/objects/。
  // 取代旧的扁平 stones/<id>/ 默认（M2 声明但 bootstrap 未落实，三套布局分叉的根之一）。
  return join(
    ref.baseDir,
    "stones",
    STONES_MAIN_BRANCH,
    STONE_OBJECTS_SUBDIR,
    ...nestedObjectPath(ref.objectId),
  );
}

/**
 * 计算 fallback package 路径（deprecated `packages/` layout），用于存在性检查。
 * Internal helper for dual-path compatibility.
 */
export function _deprecatedPackageDir(ref: StoneObjectRef): string {
  if (ref.objectId.startsWith("_builtin/") || BUILTIN_OBJECT_IDS.has(ref.objectId)) {
    return stoneDir(ref);
  }
  if (ref._stonesBranch != null) return stoneDir(ref);
  return join(
    ref.baseDir,
    "packages",
    ...nestedObjectPath(ref.objectId),
  );
}

/**
 * Resolve an existing stone directory with multi-path fallback (M2 2026-06-03).
 *
 * Priority:
 *   1. Flat layout:  stones/<id>/                    (canonical)
 *   2. Versioning:   stones/<branch>/objects/<id>/   (git worktree, metaprog)
 *   3. Deprecated:   packages/<id>/                  (legacy, console.warn)
 *
 * If none exist, returns the canonical flat path (caller handles ENOENT).
 *
 * Use this at I/O boundaries (ServerLoader, listStones, etc.) where we actually
 * read from disk. Call sites that only need the path for string manipulation can
 * keep using the synchronous `stoneDir()`.
 */
export async function resolveStoneDir(
  ref: StoneObjectRef,
  opts: { statFn?: (path: string) => Promise<{ isDirectory(): boolean }> } = {},
): Promise<string> {
  const { stat } = await import("node:fs/promises");
  const doStat = opts.statFn ?? stat;

  const idSegments = nestedObjectPath(ref.objectId);

  // 1. Canonical flat layout
  const canonical = stoneDir(ref);
  try {
    const s = await doStat(canonical);
    if (s.isDirectory()) return canonical;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // 2. Versioning worktree layout: stones/<branch>/objects/<nestedId>
  if (!ref.objectId.startsWith("_builtin/") && !BUILTIN_OBJECT_IDS.has(ref.objectId)) {
    try {
      const stonesEntries = await readdir(join(ref.baseDir, "stones"), { withFileTypes: true });
      for (const e of stonesEntries) {
        if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("@")) continue;
        const candidate = join(ref.baseDir, "stones", e.name, STONE_OBJECTS_SUBDIR, ...idSegments);
        try {
          const s = await doStat(candidate);
          if (s.isDirectory()) return candidate;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  // 3. Deprecated packages/ layout
  const fallback = _deprecatedPackageDir(ref);
  if (fallback !== canonical) {
    try {
      const s = await doStat(fallback);
      if (s.isDirectory()) {
        // eslint-disable-next-line no-console
        console.warn(
          `[stoneDir] deprecated: object '${ref.objectId}' found at '${fallback}' (packages/ layout). ` +
          `Please migrate to '${canonical}' (stones/ layout). packages/ fallback will be removed.`,
        );
        return fallback;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  return canonical;
}
