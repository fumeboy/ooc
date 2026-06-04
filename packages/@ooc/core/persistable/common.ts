import { join } from "node:path";
import { readdir } from "node:fs/promises";

/**
 * 标识磁盘上的单个 flow object 目录。
 *
 * 路径形态（2026-06-01 bun workspace 迁移，移除 objects/ 中间层）：
 *   objectId="a"       → `{baseDir}/flows/{sessionId}/a`
 *   objectId="a/b"     → `{baseDir}/flows/{sessionId}/a/children/b`
 *   objectId="a/b/c"   → `{baseDir}/flows/{sessionId}/a/children/b/children/c`
 */
export interface FlowObjectRef {
  /** 包含 `flows/` 和 `stones/` 的 workspace 根目录。 */
  baseDir: string;
  /** `flows/` 下的 session 目录名。 */
  sessionId: string;
  /** `flows/{sessionId}/` 下的 object 目录名。逻辑 id；嵌套 segment 由 children/ 物理隔开。 */
  objectId: string;
}

/**
 * 标识 flow object 内的单个线程持久化位置。
 *
 * 路径形态：`{objectDir(ref)}/threads/{threadId}`
 */
export interface ThreadPersistenceRef extends FlowObjectRef {
  /** `threads/` 下的线程目录名。 */
  threadId: string;
}

/**
 * stone / flow 目录用来分隔嵌套子 Agent 的 marker 子目录名（B-tree 协议，2026-05-26
 * 起 stone；2026-05-27 起 flow 对齐）。
 *
 * 物理布局示例（stone 与 flow 形态对齐）：
 *   objectId = "parent/child"
 *   → stones/parent/children/child
 *   → flows/<sid>/parent/children/child
 *
 * 详见 meta/object.doc.ts:thinkable.children.knowledge.patches.domain_axis。
 */
export const STONE_CHILDREN_SUBDIR = "children";

/**
 * @deprecated Removed in bun workspace migration (2026-06-01).
 * Previously "objects" intermediate dir between stones/<branch>/ and objectId path.
 * No longer needed — objects resolve directly under packages/.
 */
export const STONE_OBJECTS_SUBDIR = "objects";

/**
 * 把 "/" 分隔的 objectId 翻译成 children/ 嵌套的物理 path segments。
 *
 * 例：
 *   "a"       → ["a"]
 *   "a/b"     → ["a", "children", "b"]
 *   "a/b/c"   → ["a", "children", "b", "children", "c"]
 *
 * 与 stoneDir / objectDir 共用，避免双份逻辑。
 */
export function nestedObjectPath(objectId: string, childrenSubdir: string = STONE_CHILDREN_SUBDIR): string[] {
  const segments = objectId.split("/").filter(Boolean);
  return segments.flatMap((seg, i) => (i === 0 ? [seg] : [childrenSubdir, seg]));
}

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

/** 序列化 JSON 的统一格式：两空格缩进 + 末尾换行。 */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 标识磁盘上的单个 object stone 包。
 *
 * M2 (2026-06-03): canonical 路径是 `{baseDir}/stones/{objectId}（扁平布局）。
 * 嵌套 objectId（含 "/"）用 children/ marker 分隔。
 *
 * 兼容 fallback：若 stones/<id>/ 不存在时回落 packages/<id>/，并 console.warn。
 * 这种双路径过渡期至少一个 release。
 *
 * 特殊路由规则：
 * - `_stonesBranch` set → versioning worktree: stones/{_stonesBranch}/objects/{objectId}/（metaprog 版本化专用）
 * - _builtin/<type> → builtin 包（源码仓 packages/@ooc/builtins/<type>或 world-level builtins/<type>
 * - supervisor / user → 同上
 */
export interface StoneObjectRef {
  /** 包含 `stones/` 的 workspace 根目录。 */
  baseDir: string;
  /** `stones/` 下的 object 目录名。 */
  objectId: string;
  /**
   * Internal: when set, stoneDir() routes to a git versioning worktree path
   * `stones/{_stonesBranch}/objects/{objectId}/.
   * Used by the metaprog versioning system.
   */
  _stonesBranch?: string;
}

/** Builtin object IDs that route to packages/@ooc/builtins/<id> instead of stones/<id>. */
export const BUILTIN_OBJECT_IDS = new Set(["supervisor", "user"]);

/** 判断一个 objectId 是否指向 Builtin Object（运行时自带、Agent 不可改写）。 */
export function isBuiltinObjectId(objectId: string): boolean {
  if (objectId.startsWith("_builtin/")) return true;
  return BUILTIN_OBJECT_IDS.has(objectId);
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
      "objects",
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
  return join(
    ref.baseDir,
    "stones",
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
        const candidate = join(ref.baseDir, "stones", e.name, "objects", ...idSegments);
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

/**
 * 从 ThreadPersistenceRef 派生 StoneObjectRef，便于 program/server 模块复用。
 */
export function deriveStoneFromThread(threadRef: ThreadPersistenceRef): StoneObjectRef {
  return {
    baseDir: threadRef.baseDir,
    objectId: threadRef.objectId,
  };
}
