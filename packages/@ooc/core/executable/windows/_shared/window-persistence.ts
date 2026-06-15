/**
 * WindowPersistence —— object 实例（`OocObjectInstance`）的持久化职责（Wave 4 对象模型）。
 *
 * **data 与 win 分离落盘**（object-model 核心 4）：
 * - `inst.data`（业务数据，object 维度，跨线程共享）→ 每个独立 object 的 `state.json`。
 *   优先走 class 自定义 `resolvePersistable(inst.class).save/load`，否则系统默认 JSON 序列化。
 * - `inst.win`（投影态，thread 维度）+ 身份信封（id/class/title/status/createdAt/parentObjectId）
 *   → 整个 thread 的 `thread-context.json`。inline 项即「信封 + win」，data 不重复落盘。
 *   builtin-feature class（无独立 state.json）整窗 inline（含 data）。
 *
 * 与承重墙 `WindowManager` 的接线：manager.fromThread(thread, registry, hooks)；本类经
 * `WindowPersistence.hooksFor(thread)` 产出 `{ reportDataEdit, reportContextEdit }` 注回。
 * 地基缺省 no-op，故墙内自洽。
 *
 * 所有 IO 失败 fail-soft（observeWarn，不抛），写盘不阻塞 LLM think loop。
 */
import type { ThreadContext } from "../../../thinkable/context.js";
import { ROOT_WINDOW_ID } from "../../../_shared/types/context-window.js";
import type { OocObjectInstance } from "../../../runtime/ooc-class.js";
import type { ObjectRegistry } from "../../../runtime/object-registry.js";
import type {
  FlowObjectRef,
  ThreadPersistenceRef,
} from "../../../persistable/common.js";
import type { PersistableContext } from "../../../persistable/contract.js";
import {
  writeRuntimeObjectState,
  readRuntimeObjectState,
  deleteRuntimeObject,
  writeThreadContext,
  readThreadContext,
  createFlowObject,
  objectDir,
  type ThreadContextEntry,
} from "../../../persistable/index.js";
import { observeWarn } from "../../../observable/log-aggregator.js";

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
function persistableCtx(ref: FlowObjectRef): PersistableContext {
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

export class WindowPersistence {
  constructor(
    private readonly registry: ObjectRegistry,
    /** live 引用 manager 的实例表；snapshot 时取最新全量。 */
    private readonly instances: Map<string, OocObjectInstance>,
  ) {}

  // ── data 落盘（state.json；object 维度）──────────────────────────────────

  /**
   * 把某实例的 `inst.data` 刷到它的 `state.json`。
   * 优先 class 自定义 `resolvePersistable(class).save`，否则系统默认（writeRuntimeObjectState）。
   * builtin-feature class 无独立 state（data 随 thread-context inline），跳过。
   */
  async saveData(thread: ThreadContext, instance: OocObjectInstance): Promise<void> {
    if (instance.id === ROOT_WINDOW_ID) return;
    if (isTransientInstance(instance)) return;
    if (this.registry.isBuiltinFeatureType(instance.class)) return;
    const ref = runtimeObjectRef(thread, instance);
    if (!ref) return;
    try {
      await createFlowObject(ref, { class: instance.class });
    } catch (e) {
      observeWarn(
        "WindowPersistence.createFlowObject",
        `[WindowPersistence] createFlowObject failed for ${instance.id}: ${(e as Error).message}`,
      );
    }
    const custom = this.registry.resolvePersistable(instance.class);
    try {
      if (custom) {
        await custom.save(persistableCtx(ref), instance.data);
      } else {
        // 系统默认：把 data 写进 state.json（包成最小信封以复用既有读写器；
        // writeRuntimeObjectState 仍声明 ContextWindow 入参——data-only 信封 cast 落盘）。
        await writeRuntimeObjectState(
          ref,
          { id: instance.id, class: instance.class, data: instance.data } as unknown as Parameters<typeof writeRuntimeObjectState>[1],
        );
      }
    } catch (e) {
      observeWarn(
        "WindowPersistence.saveData",
        `[WindowPersistence] saveData failed for ${instance.id}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * 读回某独立 object 的 `inst.data`（state.json）。
   * 优先 class 自定义 `resolvePersistable(class).load`，否则系统默认。
   * 读不到（从未落盘）返回 undefined。
   */
  async loadData(
    ref: FlowObjectRef,
    classId: string,
  ): Promise<unknown | undefined> {
    const custom = this.registry.resolvePersistable(classId);
    try {
      if (custom) {
        return await custom.load(persistableCtx(ref));
      }
      const raw = await readRuntimeObjectState(ref);
      if (!raw) return undefined;
      // 系统默认信封 `{ data }`；旧布局可能整窗即 data，宽松回退。
      return (raw as { data?: unknown }).data ?? raw;
    } catch (e) {
      observeWarn(
        "WindowPersistence.loadData",
        `[WindowPersistence] loadData failed for ${ref.objectId}: ${(e as Error).message}`,
      );
      return undefined;
    }
  }

  // ── win + 信封落盘（thread-context.json；thread 维度）─────────────────────

  /** 把当前 thread 全量实例（信封 + win）刷到 thread-context.json。 */
  async writeThreadContextSnapshot(thread: ThreadContext): Promise<void> {
    const tref = threadPersistRef(thread);
    if (!tref) return;
    const entries = this.buildEntries();
    await writeThreadContext(tref, entries);
  }

  /**
   * 把内存实例数组序列化成 thread-context.json entry。
   * - root 跳过
   * - builtin-feature class → 整窗 inline（含 data；无独立 state.json）
   * - 否则（独立 object）→ inline「信封 + win，剥 data」（data 在 state.json）
   */
  private buildEntries(): ThreadContextEntry[] {
    const entries: ThreadContextEntry[] = [];
    for (const inst of this.instances.values()) {
      if (inst.id === ROOT_WINDOW_ID) continue;
      if (isTransientInstance(inst)) continue;
      if (this.registry.isBuiltinFeatureType(inst.class)) {
        entries.push(inst as unknown as ThreadContextEntry);
      } else {
        const { data: _drop, ...envelope } = inst;
        entries.push(envelope as unknown as ThreadContextEntry);
      }
    }
    return entries;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** 实例新建/更新后整体落盘（data → state.json，信封+win → thread-context.json）。 */
  async persistInstance(thread: ThreadContext, instance: OocObjectInstance): Promise<void> {
    if (instance.id === ROOT_WINDOW_ID) return;
    await this.saveData(thread, instance);
    await this.writeThreadContextSnapshot(thread).catch((e) => {
      observeWarn(
        "WindowPersistence.persistInstance",
        `[WindowPersistence] writeThreadContext failed for ${instance.id}: ${(e as Error).message}`,
      );
    });
  }

  /** 实例移除：删 state.json + 刷 thread-context.json。 */
  async unpersistInstance(thread: ThreadContext, instance: OocObjectInstance): Promise<void> {
    if (instance.id === ROOT_WINDOW_ID) return;
    if (!this.registry.isBuiltinFeatureType(instance.class)) {
      const ref = runtimeObjectRef(thread, instance);
      if (ref) {
        try {
          await deleteRuntimeObject(ref);
        } catch (e) {
          observeWarn(
            "WindowPersistence.deleteRuntimeObject",
            `[WindowPersistence] deleteRuntimeObject failed for ${instance.id}: ${(e as Error).message}`,
          );
        }
      }
    }
    await this.writeThreadContextSnapshot(thread).catch((e) => {
      observeWarn(
        "WindowPersistence.unpersistInstance",
        `[WindowPersistence] writeThreadContext failed during delete for ${instance.id}: ${(e as Error).message}`,
      );
    });
  }

  // ── 承重墙 hooks 适配 ─────────────────────────────────────────────────────

  /**
   * 产出注回 `WindowManager.fromThread(thread, registry, hooks)` 的 hooks。
   * - reportDataEdit(objectId)：某实例 data 改变后刷它的 state.json。
   * - reportContextEdit()：thread context 改变后刷 thread-context.json。
   */
  hooksFor(thread: ThreadContext): {
    reportDataEdit: (objectId: string) => Promise<void>;
    reportContextEdit: () => Promise<void>;
  } {
    return {
      reportDataEdit: async (objectId: string) => {
        const inst = this.instances.get(objectId);
        if (!inst) return;
        await this.saveData(thread, inst);
      },
      reportContextEdit: async () => {
        await this.writeThreadContextSnapshot(thread);
      },
    };
  }
}
