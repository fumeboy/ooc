import { join } from "node:path";
import type { FlowObjectRef, ThreadPersistenceRef } from "./types";

/** flow object 目录及其元数据文件路径。 */
export interface FlowObjectPaths {
  /** `flows/{sessionId}` 目录。 */
  sessionDir: string;
  /** `flows/{sessionId}/objects/{objectId}` 目录。 */
  objectDir: string;
  /** flow object 元数据文件 `.flow.json`。 */
  flowMetadataFile: string;
  /** flow object 下的 `threads/` 目录。 */
  threadsDir: string;
}

/** 单个线程的所有持久化文件路径。 */
export interface ThreadPaths extends FlowObjectPaths {
  /** `threads/{threadId}` 目录。 */
  threadDir: string;
  /** `threads/{threadId}/thread.json` 文件。 */
  threadFile: string;
  /** `threads/{threadId}/debug` 目录。 */
  debugDir: string;
  /** LLM 输入 debug 文件。 */
  llmInputFile: string;
  /** LLM 输出 debug 文件。 */
  llmOutputFile: string;
}

/** 计算 flow object 级别的目录与文件路径，纯函数。 */
export function flowObjectPaths(ref: FlowObjectRef): FlowObjectPaths {
  const sessionDir = join(ref.baseDir, "flows", ref.sessionId);
  const objectDir = join(sessionDir, "objects", ref.objectId);
  return {
    sessionDir,
    objectDir,
    flowMetadataFile: join(objectDir, ".flow.json"),
    threadsDir: join(objectDir, "threads")
  };
}

/** 计算线程级别的所有路径，纯函数。 */
export function threadPaths(ref: ThreadPersistenceRef): ThreadPaths {
  const flow = flowObjectPaths(ref);
  const threadDir = join(flow.threadsDir, ref.threadId);
  const debugDir = join(threadDir, "debug");
  return {
    ...flow,
    threadDir,
    threadFile: join(threadDir, "thread.json"),
    debugDir,
    llmInputFile: join(debugDir, "llm.input.json"),
    llmOutputFile: join(debugDir, "llm.output.json")
  };
}
