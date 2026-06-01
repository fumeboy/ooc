import { join } from "node:path";

/**
 * 标识磁盘上的单个 flow object 目录。
 *
 * 路径形态（2026-06-01 bun workspace 迁移，移除 objects/ 中间层）：
 *   objectId="a"       → `{baseDir}/flows/{sessionId}/a`
 *   objectId="a/b"     → `{baseDir}/flows/{sessionId}/a/children/b`
 *   objectId="a/b/c"   → `{baseDir}/flows/{sessionId}/a/children/b/children/c`
 */
export interface FlowObjectRef {
  /** 包含 `flows/` 和 `packages/` 的 workspace 根目录。 */
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
 *   → packages/parent/children/child
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
 * 与 packageDir / objectDir 共用，避免双份逻辑。
 */
export function nestedObjectPath(objectId: string, childrenSubdir: string = STONE_CHILDREN_SUBDIR): string[] {
  const segments = objectId.split("/").filter(Boolean);
  return segments.flatMap((seg, i) => (i === 0 ? [seg] : [childrenSubdir, seg]));
}

/**
 * 计算 flow object 目录绝对路径。objectId 中的 "/" 被翻译为 children/ 嵌套
 * （与 packageDir 对称；详见 nestedObjectPath）。
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
 * 标识磁盘上的单个 object package（原 stone 对象）。
 *
 * 路径形态：`{baseDir}/packages/{objectId}`
 *
 * objectId 支持 "/" 编码嵌套层级：第 N 段（N≥2）会被插入 `STONE_CHILDREN_SUBDIR`
 * 作为父子边界。形态：`packages/<a>/children/<b>/children/<c>`。
 */
export interface StoneObjectRef {
  /** 包含 `packages/` 的 workspace 根目录。 */
  baseDir: string;
  /** `packages/` 下的 object 目录名。 */
  objectId: string;
  /**
   * Internal: when set, stoneDir() routes to a worktree path
   * `stones/{_stonesBranch}/objects/{objectId}/` instead of `packages/`.
   * Used by the metaprog versioning system during writes.
   */
  _stonesBranch?: string;
}

/**
 * 计算 object package 目录绝对路径。
 *
 * objectId 中的 "/" 被翻译为 children/ 嵌套，与 workspace glob
 * `packages/**\/children/**` 精确匹配。
 *
 * Special case: objectId 以 "_builtin/" 开头的内置对象 → 解析到
 * `packages/@ooc/builtins/<type>/` 源包路径（而非 `packages/_builtin/children/<type>/`）。
 */
export function packageDir(ref: StoneObjectRef): string {
  if (ref.objectId.startsWith("_builtin/")) {
    const builtinType = ref.objectId.slice("_builtin/".length);
    return join(ref.baseDir, "packages", "@ooc", "builtins", builtinType);
  }
  return join(
    ref.baseDir,
    "packages",
    ...nestedObjectPath(ref.objectId),
  );
}

/**
 * @deprecated Use packageDir instead (2026-06-01 bun workspace migration).
 * Alias preserved for backward compatibility during codebase refactor.
 *
 * Routing logic:
 * - If `ref._stonesBranch` is explicitly set (any value, including "main") →
 *   route to the versioning worktree path `stones/{_stonesBranch}/objects/{objectId}/`.
 *   This is used by the metaprog versioning system for writes that need git tracking.
 * - If `ref._stonesBranch` is undefined → route to `packages/{objectId}/` for runtime reads.
 *   After successful merges, changes are synced from stones/main/objects/ to packages/.
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
  return packageDir(ref);
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
