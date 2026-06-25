/**
 * 路径与 id 工具 + persistable 内部 ref 类型 —— 纯类型 + 纯函数。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md` 核心 8（children 命名空间）。
 *
 * **关于 ref 类型的设计反思**：
 * - 真正的对象引用是 `OocObjectRef`（id + class 足矣）—— OOC 哲学下"引用"指向对象身份。
 * - 此处的 `FlowObjectRef` / `StoneObjectRef` / `ThreadPersistenceRef` 是 **persistable 内部
 *   的路径定位元组**（(baseDir, sessionId?, objectId, threadId?, _stonesBranch?)），不是 OO
 *   语义的对象引用——是文件 IO 子系统的"path 参数"，留在此处作为 persistable 内部约定。
 * - 长期可改 plain positional args，但当前调用面太广，保留 ref 形态降低改造面。
 */

/** stone 分支 ref —— 一个 stone 的 (worldDir, branch) 组合（branch 缺省 = main）。 */
export interface StoneBranch {
  worldDir: string;
  branch?: string;
}

/** 指向某 stone 内某 object 的 path 元组（stone scope = 长期身份层）。 */
export interface StoneObjectRef {
  baseDir: string;
  objectId: string;
  /** 非缺省 = 经 git worktree branch 寻址（如 session-<sid>）；缺省 = stones/main。 */
  _stonesBranch?: string;
}

/** 指向某 flow（session）内某 object 的 path 元组。 */
export interface FlowObjectRef {
  baseDir: string;
  sessionId: string;
  objectId: string;
}

/** 指向某 thread 实例的 path 元组（flow 内 thread）。 */
export interface ThreadPersistenceRef extends FlowObjectRef {
  threadId: string;
}

/**
 * stone / flow 目录用来分隔嵌套子对象的 marker 子目录名（命名空间从属，见对象模型核心 8）。
 *
 * 物理布局示例（stone 与 flow 形态对齐）：
 *   objectId = "parent/child" → stones/parent/children/child/
 */
export const CHILDREN_SUBDIR = "children";

/** 兼容旧名（persistable 内部使用）。 */
export const STONE_CHILDREN_SUBDIR = CHILDREN_SUBDIR;

/**
 * 把 "/" 分隔的 objectId 翻译成 children/ 嵌套的物理 path segments。
 *
 *   "a"       → ["a"]
 *   "a/b"     → ["a", "children", "b"]
 *   "a/b/c"   → ["a", "children", "b", "children", "c"]
 */
export function nestedObjectPath(objectId: string): string[] {
  const segments = objectId.split("/").filter(Boolean);
  return segments.flatMap((seg, i) => (i === 0 ? [seg] : [CHILDREN_SUBDIR, seg]));
}

/** 判断一个 objectId 是否指向 Builtin Object（运行时自带、Agent 不可改写）。 */
export function isBuiltinObjectId(objectId: string): boolean {
  return objectId.startsWith("_builtin/");
}

/**
 * 系统级 builtin object id 白名单 —— 一些不带 `_builtin/` 前缀的特殊 id（如 `user`,
 * `supervisor`）也是 builtin。
 *
 * 注意：当前 `supervisor` / `user` 已实例化为 stone 下的普通 object，不在此白名单。
 * 保留空集是为 persistable 内部 resolveStoneDir / stoneDir 的旧分支兜底。
 */
export const BUILTIN_OBJECT_IDS: ReadonlySet<string> = new Set<string>();

/** 序列化 JSON 的统一格式：两空格缩进 + 末尾换行。 */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 从 ThreadPersistenceRef 派生 StoneObjectRef（剥去 sessionId/threadId，保留 baseDir/objectId）。
 *
 * thread 寻址进 stone 层时使用（例如读 self.md / readable.md）；
 * 不带 `_stonesBranch` ⇒ 默认 stones/main。
 */
export function deriveStoneFromThread(ref: { baseDir: string; objectId: string }): StoneObjectRef {
  return { baseDir: ref.baseDir, objectId: ref.objectId };
}
