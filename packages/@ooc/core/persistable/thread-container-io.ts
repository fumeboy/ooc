/**
 * thread 容器持久化的 **seam 派发器**（core 框架，**零 thread builtin value import**）。
 *
 * core/app 引擎要「把一条 thread 容器落盘/读回」时调本模块——它经 registry 泛型 seam
 * `resolvePersistable(THREAD_CLASS_ID).save/load` 派发到 thread builtin 自己的 `saveThread`/`loadThread`：
 * **thread 自主持久化**——序列化逻辑（thread.json / thread-context.json / inbox / hydrate）归 thread，
 * core 只触发。`THREAD_CLASS_ID` / `threadDir` / registry 皆 core 物，故无 core→thread-builtin value 边；
 * builtin 的 save/load 经 `register-builtins` 注册、运行时解析（未注册 fail-loud，不静默 no-op）。
 *
 * 退潮：取代旧 `builtins/.../persistable/thread-json.ts` 的 `writeThread`/`readThread` adapter——那是
 * core 直 import thread builtin 具体实现的 blessed import，现收口为「core 经 seam 派发、thread 自实现」。
 */
import { builtinRegistry } from "../runtime/object-registry.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import { THREAD_CLASS_ID } from "../_shared/types/constants.js";
import { threadDir } from "./common.js";
import type { FlowObjectRef, ThreadPersistenceRef } from "./common.js";
import type { PersistableContext } from "./contract.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";

/** thread 容器持久化 ctx —— 通用 PersistableContext + thread 二级寻址 threadId。 */
type ThreadIoCtx = PersistableContext & { threadId?: string };

function ctxOf(ref: ThreadPersistenceRef): ThreadIoCtx {
  return {
    baseDir: ref.baseDir,
    objectId: ref.objectId,
    sessionId: ref.sessionId,
    threadId: ref.threadId,
    dir: threadDir(ref),
  };
}

function threadPersistable(registry: ObjectRegistry) {
  const m = registry.resolvePersistable(THREAD_CLASS_ID);
  if (!m?.save || !m?.load) {
    throw new Error(
      `[thread-container-io] ${THREAD_CLASS_ID} 的 persistable.save/load 未注册——须先 register-builtins。`,
    );
  }
  return m;
}

/** 经 seam 把 thread 容器整份落盘（thread 未携带 persistence ref 时静默跳过——纯内存模式）。 */
export async function writeThread(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<void> {
  if (!thread.persistence) return;
  await threadPersistable(registry).save!(ctxOf(thread.persistence), thread);
}

/** 经 seam 从盘 hydrate 一条 thread 容器（并由 thread 的 load 把 persistence ref 重新挂上）。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string,
  registry: ObjectRegistry = builtinRegistry,
): Promise<ThreadContext | undefined> {
  const out = await threadPersistable(registry).load!(ctxOf({ ...ref, threadId }));
  return out as ThreadContext | undefined;
}
