import { join } from "node:path";

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
