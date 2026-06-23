/**
 * thread.json 的 **path 原语 + 对外 API**（thread builtin 自有；core 不再持有 thread 序列化入口）。
 *
 * `writeThread`/`readThread` 是 thread builtin 暴露给 runtime 引擎（thinkloop/scheduler/worker/
 * resume/service）的稳定 API。thread 怎么落盘（thread.json strip 规则 / thread-context 窗状态
 * inline vs `_ref` / inbox / hydrate）是 thread builtin 的逻辑，实现在 `./thread-persist`。
 *
 * 退潮（object-model 核心 7）：原 `core/persistable/thread-json.ts` 是「core 壳 dispatch → builtin
 * 逻辑」的 indirection（registry.resolvePersistable(THREAD_CLASS_ID).save/load）。该 dispatch 壳已塌掉
 * ——thread 的落盘就是 thread 自己的事，`writeThread`/`readThread` 直接调本 builtin 的 `saveThread`/
 * `loadThread`，core 生产代码改为直接 import 本模块。
 */
import { join } from "node:path";
import {
  threadDir,
  type FlowObjectRef,
  type ThreadPersistenceRef,
} from "@ooc/core/persistable/common.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import { saveThread, loadThread, type ThreadPersistableContext } from "./thread-persist.js";

/** 单个线程的 `thread.json` 绝对路径（path 原语）。 */
export function threadFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "thread.json");
}

/**
 * 把线程上下文持久化（thread.json + thread-context.json + inbox）。
 * 直接调 thread builtin 的标准 `saveThread`；线程未携带 persistence ref 时由实现侧静默跳过。
 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  const p = thread.persistence;
  const ctx: ThreadPersistableContext = p
    ? { baseDir: p.baseDir, objectId: p.objectId, sessionId: p.sessionId, threadId: p.threadId, dir: threadDir(p) }
    : { baseDir: "", objectId: "", dir: "" };
  await saveThread(ctx, thread);
}

/** 从磁盘恢复线程上下文（直接调 thread builtin 的标准 `loadThread`），并把 persistence ref 重新挂上。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string,
): Promise<ThreadContext | undefined> {
  const refWithThread: ThreadPersistenceRef = { ...ref, threadId };
  const ctx: ThreadPersistableContext = {
    baseDir: ref.baseDir,
    objectId: ref.objectId,
    sessionId: ref.sessionId,
    threadId,
    dir: threadDir(refWithThread),
  };
  return (await loadThread(ctx)) as ThreadContext | undefined;
}
