/**
 * 单对象 data 持久化 —— **core 框架**（object-model 核心 4/7：data 与 win 分离落盘）。
 *
 * 这是「系统默认持久化 + class 自定义 persistable」的通用编织点，适用于**任何** object 实例
 * （file/search/process/plan/…，以及 thread 容器里的独立子窗）：
 * - `inst.data`（业务数据，object 维度，跨线程共享）→ 该 object 的 `state.json`。
 *   优先 `registry.resolvePersistable(class).save/load`，否则系统默认 JSON 序列化。
 *
 * thread 容器（thread.json / thread-context.json / inbox / hydrate）的**逻辑**不在此——那是
 * thread builtin 自己的标准 `persistable.save`/`load` 实现；本模块只提供它与 manager 复用的通用 data IO。
 *
 * 所有 IO 失败 fail-soft（observeWarn，不抛），写盘不阻塞 LLM think loop。
 */
import type { ThreadContext } from "../thinkable/context.js";
import { ROOT_WINDOW_ID } from "../_shared/types/context-window.js";
import type { OocObjectInstance } from "../runtime/ooc-class.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import { objectDir, type FlowObjectRef, type ThreadPersistenceRef } from "./common.js";
import type { PersistableContext } from "./contract.js";
import {
  writeRuntimeObjectState,
  readRuntimeObjectState,
} from "./flow-runtime-object.js";
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
  instance: OocObjectInstance,
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
 * 它们由确定性重建、无独立 state.json；落盘只会变成死 _ref 刷屏，写盘端统一剔除。
 * 约定标记：`win.transient === true`（init.ts 注入时设）。
 */
export function isTransientInstance(instance: OocObjectInstance): boolean {
  return (instance.win as { transient?: unknown } | undefined)?.transient === true;
}

/**
 * 把某实例的 `inst.data` 刷到它的 `state.json`。
 * 优先 class 自定义 `resolvePersistable(class).save`，否则系统默认（writeRuntimeObjectState）。
 * inline（运行态自有窗，data 随 thread-context inline）/ transient / root 跳过。
 */
export async function saveObjectData(
  registry: ObjectRegistry,
  thread: ThreadContext,
  instance: OocObjectInstance,
): Promise<void> {
  if (instance.id === ROOT_WINDOW_ID) return;
  if (isTransientInstance(instance)) return;
  if (registry.isInlinePersisted(instance.class)) return;
  const ref = runtimeObjectRef(thread, instance);
  if (!ref) return;
  try {
    await createFlowObject(ref, { class: instance.class });
  } catch (e) {
    observeWarn(
      "object-data.createFlowObject",
      `[object-data] createFlowObject failed for ${instance.id}: ${(e as Error).message}`,
    );
  }
  const custom = registry.resolvePersistable(instance.class);
  try {
    if (custom?.save) {
      await custom.save(persistableCtx(ref), instance.data);
    } else {
      await writeRuntimeObjectState(
        ref,
        { id: instance.id, class: instance.class, data: instance.data } as unknown as Parameters<typeof writeRuntimeObjectState>[1],
      );
    }
  } catch (e) {
    observeWarn(
      "object-data.saveObjectData",
      `[object-data] saveObjectData failed for ${instance.id}: ${(e as Error).message}`,
    );
  }
}

/**
 * 读回某独立 object 的 `inst.data`（state.json）。
 * 优先 class 自定义 `resolvePersistable(class).load`，否则系统默认。
 * 读不到（从未落盘）返回 undefined。
 */
export async function loadObjectData(
  registry: ObjectRegistry,
  ref: FlowObjectRef,
  classId: string,
): Promise<unknown | undefined> {
  const custom = registry.resolvePersistable(classId);
  try {
    if (custom?.load) {
      return await custom.load(persistableCtx(ref));
    }
    const raw = await readRuntimeObjectState(ref);
    if (!raw) return undefined;
    return (raw as { data?: unknown }).data ?? raw;
  } catch (e) {
    observeWarn(
      "object-data.loadObjectData",
      `[object-data] loadObjectData failed for ${ref.objectId}: ${(e as Error).message}`,
    );
    return undefined;
  }
}
