import { join } from "node:path";
import { readdir } from "node:fs/promises";

/**
 * flow/stone 引用类型 + 纯路径函数的 canonical 源已迁入
 * `@ooc/core/_shared/types/thread.ts`（零依赖层，打破 thinkable ↔ persistable 类型耦合）。
 * 此处 re-export 保持旧 import 路径 (`persistable/common`) 可用。
 *
 * **留在本文件**的是带 IO / 路径路由的实现：objectDir / threadDir / stoneDir /
 * resolveStoneDir（依赖 node:path / node:fs，不可下沉 `_shared`）
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
 * omits it, but versioning worktrees and the main-branch mirror still use it.
 */
export const STONE_OBJECTS_SUBDIR = "objects";

/** stones git 主分支名常量，与 fast-forward-to-main 语义对齐。 */
export const STONES_MAIN_BRANCH = "main";

/** bare 仓库目录名（plugins_worktrees 风格的 `.plugins_repo` 等价物）。 */
export const STONES_BARE_REPO_DIR = ".stones_repo";

/**
 * business session 的 stone 分支名前缀：branch = `session-<sid>`（git branch 名，与物理
 * worktree 路径 `flows/<sid>` 解耦）。canonical 源放本文件，供 stoneDir 路由与
 * stone-worktree 的 sessionStoneBranch 共用，避免前缀字面量分散两处漂移。
 */
export const SESSION_BRANCH_PREFIX = "session-";

/**
 * 计算 flow object 目录绝对路径。
 *
 * 落点统一为 `flows/<sid>/objects/<nestedObjectPath>` —— 与 stoneDir 的 session worktree
 * 分支（`flows/<sid>/objects/<id>`）同落点：一个 `objects/<id>/` 目录同时容纳该对象的
 * **身份文件（tracked stone：self.md / readable.md / executable/** / …）+ 运行时数据
 * （untracked：.flow.json / threads/ / state.json）**，由 main 根 .gitignore 黑名单区分。
 *
 * objectId 中的 "/" 被翻译为 children/ 嵌套（与 stoneDir 对称；详见 nestedObjectPath）——
 * nested child 仍落 `objects/<a>/children/<b>/`，只是基路径多了一段 `objects/`。
 */
export function objectDir(ref: FlowObjectRef): string {
  return join(
    ref.baseDir,
    "flows",
    ref.sessionId,
    STONE_OBJECTS_SUBDIR,
    ...nestedObjectPath(ref.objectId),
  );
}

/** 计算线程目录绝对路径，被 thread-json 与 debug-file 共用。 */
export function threadDir(ref: ThreadPersistenceRef): string {
  return join(objectDir(ref), "threads", ref.threadId);
}

/**
 * 计算 object stone 目录绝对路径（canonical）。
 *
 * Routing priority:
 * 1. `_stonesBranch` set → versioning worktree: `stones/{_stonesBranch}/objects/{nestedPath}`
 * 2. Builtin ids (_builtin/*, supervisor, user) → `packages/@ooc/builtins/<id>` in the repo or World node_modules
 * 3. Canonical (default): `stones/main/objects/{nestedPath}`
 *
 * `nestedPath` translates "/" in objectId into `children/` segments.
 */
export function stoneDir(ref: StoneObjectRef): string {
  if (ref._stonesBranch != null) {
    // session worktree（branch `session-<sid>`）物理落 `flows/<sid>`——
    // 与 sessionWorktreePath 对齐。tracked stone 与运行时数据现在**同落 `objects/<id>/`**
    // （objectDir 续案：flows/<sid>/objects/<id>），由 main 根 .gitignore 黑名单区分
    // tracked（self.md/…）vs untracked（.flow.json/threads//state.json）。
    // 其他 _stonesBranch（metaprog 去除后理论不再有，防御保留）仍走 `stones/<branch>/`。
    if (ref._stonesBranch.startsWith(SESSION_BRANCH_PREFIX)) {
      const sid = ref._stonesBranch.slice(SESSION_BRANCH_PREFIX.length);
      return join(
        ref.baseDir,
        "flows",
        sid,
        STONE_OBJECTS_SUBDIR,
        ...nestedObjectPath(ref.objectId),
      );
    }
    return join(
      ref.baseDir,
      "stones",
      ref._stonesBranch,
      STONE_OBJECTS_SUBDIR,
      ...nestedObjectPath(ref.objectId),
    );
  }
  // `_builtin/<type>` 前缀 = 框架 class 的显式寻址（class 磁盘读实际走 resolveBuiltinDir
  // 指向框架包；此处 world packages 路径为兼容残留）。bare builtin id（supervisor）不再
  // 特殊解析——它现在是 objects/ 下由 class 实例化的普通 object（见 instantiate-classes）。
  if (ref.objectId.startsWith("_builtin/")) {
    const builtinType = ref.objectId.slice("_builtin/".length);
    return join(ref.baseDir, "packages", "@ooc", "builtins", builtinType);
  }
  // canonical = main 分支 worktree（用户拍板：保留 stone git 分支设计，
  // main = canonical）。等价 _stonesBranch="main"；对象 bootstrap 即落 stones/main/objects/。
  // 取代旧的扁平 stones/<id>/ 默认（声明但 bootstrap 未落实，三套布局分叉的根之一）。
  return join(
    ref.baseDir,
    "stones",
    STONES_MAIN_BRANCH,
    STONE_OBJECTS_SUBDIR,
    ...nestedObjectPath(ref.objectId),
  );
}

/**
 * Resolve an existing stone directory（移除 deprecated packages/ 第3路）。
 *
 * Priority:
 *   1. Canonical:   stones/main/objects/<id>/         (canonical / flat)
 *   2. Versioning:  stones/<branch>/objects/<id>/     (git worktree, session)
 *
 * If none exist, returns the canonical path (caller handles ENOENT).
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

  // deprecated `<world>/packages/<id>/` layout fallback 已移除（该布局无活跃使用）。
  return canonical;
}
