import { join } from "node:path";
import { STONES_MAIN_BRANCH } from "./stone-bootstrap";

/**
 * 标识磁盘上的单个 flow object 目录。
 *
 * 路径形态：`{baseDir}/flows/{sessionId}/objects/{objectId}`
 */
export interface FlowObjectRef {
  /** 包含 `flows/` 的根目录。 */
  baseDir: string;
  /** `flows/` 下的 session 目录名。 */
  sessionId: string;
  /** `flows/{sessionId}/objects/` 下的 object 目录名。 */
  objectId: string;
  /**
   * 当前 server 实例绑定的 stones-branch，用于派生 StoneObjectRef 时承接（U2）。
   * 缺省时下游 stoneDir() 回退到 "main"。
   */
  stonesBranch?: string;
}

/**
 * 标识 flow object 内的单个线程持久化位置。
 *
 * 路径形态：`{baseDir}/flows/{sessionId}/objects/{objectId}/threads/{threadId}`
 */
export interface ThreadPersistenceRef extends FlowObjectRef {
  /** `threads/` 下的线程目录名。 */
  threadId: string;
}

/** 计算 flow object 目录绝对路径。 */
export function objectDir(ref: FlowObjectRef): string {
  return join(ref.baseDir, "flows", ref.sessionId, "objects", ref.objectId);
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
 * 标识磁盘上的单个 stone 对象。
 *
 * 路径形态：`{baseDir}/stones/{stonesBranch}/objects/{objectId}`
 *
 * `stonesBranch` 是 server 实例启动时绑定的 git 分支（默认 "main"，可通过
 * `--stones-branch` 切换至 worktree 分支用于元编程沙箱，详见 U2/U4 设计）。
 *
 * `objects/` 中间层（2026-05-21 引入）：把 stone 对象从分支根挪到 `objects/`
 * 子目录，让 `stones/{branch}/` 根本身可以承载 world-level stone 资源（注册表、
 * 共享数据、PR-Issue 索引等），与 per-Object 内容物物理分离。
 */
export interface StoneObjectRef {
  /** 包含 `stones/` 的根目录。 */
  baseDir: string;
  /** `stones/{stonesBranch}/objects/` 下的 object 目录名。 */
  objectId: string;
  /**
   * 落到 `stones/{stonesBranch}/objects/` 下；缺省时 stoneDir() 用 "main"。
   * U4 元编程沙箱会显式传 worktree 分支名。
   */
  stonesBranch?: string;
}

/** stones/{branch}/objects/ 子目录名。集中常量便于其它模块（recovery / listStones / scope 判定）复用。 */
export const STONE_OBJECTS_SUBDIR = "objects";

/** 计算 stone 目录绝对路径。stonesBranch 缺省时回退到 main。 */
export function stoneDir(ref: StoneObjectRef): string {
  return join(ref.baseDir, "stones", ref.stonesBranch ?? STONES_MAIN_BRANCH, STONE_OBJECTS_SUBDIR, ref.objectId);
}

/**
 * 从 ThreadPersistenceRef 派生 StoneObjectRef，便于 program/server 模块复用。
 * stonesBranch 透传——thread 在哪个 server 实例上跑就属于哪个 branch。
 */
export function deriveStoneFromThread(threadRef: ThreadPersistenceRef): StoneObjectRef {
  return {
    baseDir: threadRef.baseDir,
    objectId: threadRef.objectId,
    stonesBranch: threadRef.stonesBranch,
  };
}
