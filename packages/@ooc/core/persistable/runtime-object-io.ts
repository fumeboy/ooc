/**
 * 运行对象的 seam 持久化 —— core 框架，**泛型按 class 派发、零 builtin value import、零 thread 专属**。
 *
 * 一个「运行对象」（自带 persistence ref 的 flow 对象，当前即 thread 容器）的落盘/读回，经 registry
 * 泛型 seam `resolvePersistable(class).save/load` 派发到该 class 自己的 persistable 实现——**持久化逻辑
 * 归各 class（thread → saveThread/loadThread），core 只按 class 分派**。thread 去特权化（issue
 * 2026-06-23-thread-deprivileging P1）：core 不再具名 import thread 的持久化实现。
 *
 * - `saveObject(obj)`：读 `obj.class` 派发——对象**自带 class 标识**（`OocObjectInstance{id,class,data}`
 *   同构），core 无需被告知"这是 thread"。
 * - `loadObject(classId, ref, threadId)`：按**显式 classId** 派发——hydrate 一个对象前必须知道目标 class。
 *
 * `THREAD_CLASS_ID` 等是 core 常量；调用方传它不构成 builtin import。未注册 **fail-loud**（不静默 no-op）。
 * 返回类型 `ThreadContext` 仅 type-only（运行时擦除）——逻辑零行在 core。
 */
import { builtinRegistry } from "../runtime/object-registry.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import { threadDir } from "./common.js";
import type { FlowObjectRef, ThreadPersistenceRef } from "./common.js";
import type { PersistableContext } from "./contract.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";

/** 运行对象持久化 ctx —— 通用 PersistableContext + flow 对象二级寻址 threadId（缺省类不读它）。 */
type ObjectIoCtx = PersistableContext & { threadId?: string };

function ctxOf(ref: ThreadPersistenceRef): ObjectIoCtx {
  return {
    baseDir: ref.baseDir,
    objectId: ref.objectId,
    sessionId: ref.sessionId,
    threadId: ref.threadId,
    dir: threadDir(ref),
  };
}

function persistableOrThrow(classId: string, registry: ObjectRegistry) {
  const m = registry.resolvePersistable(classId);
  if (!m?.save || !m?.load) {
    throw new Error(
      `[runtime-object-io] ${classId} 的 persistable.save/load 未注册——须先 register-builtins。`,
    );
  }
  return m;
}

/**
 * 经 seam 落盘一个自带 persistence ref 的运行对象（**按 `obj.class` 泛型派发**）。
 * 无 persistence 静默跳过（纯内存模式）。
 */
export async function saveObject(
  obj: { class: string; persistence?: ThreadPersistenceRef },
  registry: ObjectRegistry = builtinRegistry,
): Promise<void> {
  if (!obj.persistence) return;
  await persistableOrThrow(obj.class, registry).save!(ctxOf(obj.persistence), obj);
}

/**
 * 经 seam hydrate 一个运行对象（**按显式 `classId` 派发**；`ref`+`threadId` 二级寻址）。
 * 当前仅 thread 容器走此路；返回 `ThreadContext` 为 type-only 标注，逻辑由 class 的 load 实现产出。
 */
export async function loadObject(
  classId: string,
  ref: FlowObjectRef,
  threadId: string,
  registry: ObjectRegistry = builtinRegistry,
): Promise<ThreadContext | undefined> {
  const out = await persistableOrThrow(classId, registry).load!(ctxOf({ ...ref, threadId }));
  return out as ThreadContext | undefined;
}
