/**
 * 单对象 data 持久化 —— **core 框架**（object-model 核心 4/7：data 与 win 分离落盘）。
 *
 * 这是「系统默认持久化 + class 自定义 persistable」的通用编织点，适用于**任何** object 实例
 * （file/search/process/plan/…，以及 thread 容器里的独立子窗）：
 * - `inst.data`（业务数据，object 维度，跨线程共享）→ 该 object 的 `data.json`（裸 Data）。
 *   优先 `registry.resolvePersistable(class).save/load`，否则系统默认 JSON 序列化。
 *
 * thread 容器（thread.json / thread-context.json / inbox / hydrate）的**逻辑**不在此——那是
 * thread builtin 自己的标准 `persistable.save`/`load` 实现；本模块只提供它与 manager 复用的通用 data IO。
 *
 * 所有 IO 失败 fail-soft（observeWarn，不抛），写盘不阻塞 LLM think loop。
 */
import type { ThreadContext } from "../_shared/types/thread.js";
import { ROOT_WINDOW_ID, objectDataOf, classOf } from "../_shared/types/context-window.js";
import { getSessionObjectTable } from "../runtime/session-object-table.js";
import type { OocObjectRef } from "../runtime/ooc-class.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import { objectDir, type FlowObjectRef, type ThreadPersistenceRef } from "./common.js";
import type { PersistableContext } from "./contract.js";
import { writeRuntimeObjectData } from "./flow-runtime-object.js";
import { createFlowObject } from "./flow-object.js";
import { observeWarn } from "../observable/log-aggregator.js";

/** 从 thread.persistence 构造 ThreadPersistenceRef（含 threadId）。 */
export function threadPersistRef(thread: ThreadContext): ThreadPersistenceRef | undefined {
  if (!thread.persistence) return undefined;
  return {
    baseDir: thread.persistence.baseDir,
    sessionId: thread.persistence.sessionId,
    objectId: thread.persistence.objectId,
    threadId: thread.persistence.threadId,
  };
}

/** 构造指向某实例自身 flow object 的 FlowObjectRef（objectId=instance.id）。 */
export function runtimeObjectRef(
  thread: ThreadContext,
  instance: OocObjectRef,
): FlowObjectRef | undefined {
  if (!thread.persistence) return undefined;
  return {
    baseDir: thread.persistence.baseDir,
    sessionId: thread.persistence.sessionId,
    objectId: instance.id,
  };
}

/** PersistableContext for an instance —— 自定义 save/load 的定位三元组 + 默认序列化目录。 */
export function persistableCtx(ref: FlowObjectRef): PersistableContext {
  return {
    baseDir: ref.baseDir,
    objectId: ref.objectId,
    sessionId: ref.sessionId,
    dir: objectDir(ref),
  };
}

/**
 * 非持久化实例 —— self 门面 / member / peer / creator 等每轮 init 幂等重注入的实例。
 * 它们由确定性重建、无独立 data.json；落盘只会变成死 _ref 刷屏，写盘端统一剔除。
 * 约定标记：`win.transient === true`（init.ts 注入时设）。
 */
export function isTransientInstance(instance: OocObjectRef): boolean {
  return (instance.win as { transient?: unknown } | undefined)?.transient === true;
}

/**
 * 把某实例的 `inst.data` 刷到它的 `data.json`（裸 Data）。
 * 优先 class 自定义 `resolvePersistable(class).save`，否则系统默认（writeRuntimeObjectData）。
 * inline（运行态自有窗，data 随 thread-context inline）/ transient / root 跳过。
 */
export async function saveObjectData(
  registry: ObjectRegistry,
  thread: ThreadContext,
  instance: OocObjectRef,
): Promise<void> {
  if (instance.id === ROOT_WINDOW_ID) return;
  if (isTransientInstance(instance)) return;
  if (registry.isInlinePersisted(classOf(instance))) return;
  const ref = runtimeObjectRef(thread, instance);
  if (!ref) return;
  try {
    await createFlowObject(ref, { class: classOf(instance) });
  } catch (e) {
    observeWarn(
      "object-data.createFlowObject",
      `[object-data] createFlowObject failed for ${instance.id}: ${(e as Error).message}`,
    );
  }
  const custom = registry.resolvePersistable(classOf(instance));
  const table = getSessionObjectTable(thread);
  try {
    if (custom?.save) {
      await custom.save(persistableCtx(ref), objectDataOf(instance, table));
    } else {
      await writeRuntimeObjectData(
        ref,
        objectDataOf(instance, table) as Record<string, unknown>,
      );
    }
  } catch (e) {
    observeWarn(
      "object-data.saveObjectData",
      `[object-data] saveObjectData failed for ${instance.id}: ${(e as Error).message}`,
    );
  }
}
