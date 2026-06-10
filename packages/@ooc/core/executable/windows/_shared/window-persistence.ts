/**
 * WindowPersistence —— 从 WindowManager 抽出的持久化职责。
 *
 * 落盘三件套：每个独立 flow object 的 `state.json`（writeRuntimeObjectState）、整个 thread 的
 * `thread-context.json`（writeThreadContext）、context-registry（成员 params）。manager 持有
 * 一个实例，把 window 增删后的落盘委托给它。
 *
 * 持有对 manager `windows` Map 的 **live 引用**，故 `writeThreadContextSnapshot` 总能拿到最新全量。
 * 所有 IO 失败 fail-soft（console.warn，不抛），写盘不阻塞 LLM think loop。
 */
import type { ThreadContext } from "../../../thinkable/context.js";
import { ROOT_WINDOW_ID, isNonPersistedWindow, type ContextWindow } from "./types.js";
import type { ObjectRegistry } from "./registry.js";
import type { FlowObjectRef, ThreadPersistenceRef } from "../../../persistable/common.js";
import {
  writeRuntimeObjectState,
  deleteRuntimeObject,
  readContextRegistry,
  writeContextRegistry,
  type ContextMember,
  type ContextRegistry,
  type ContextParams,
  writeThreadContext,
  buildThreadContextEntries,
  createFlowObject,
} from "../../../persistable/index.js";

/** 从 thread.persistence 构造 ThreadPersistenceRef（含 threadId）。manager form-ctx 注入与持久化共用。 */
export function threadPersistRef(thread: ThreadContext): ThreadPersistenceRef | undefined {
  if (!thread.persistence) return undefined;
  return {
    baseDir: thread.persistence.baseDir,
    sessionId: thread.persistence.sessionId,
    objectId: thread.persistence.objectId,
    threadId: thread.persistence.threadId,
  };
}

/** 构造指向某 window 自身 flow object 的 FlowObjectRef（objectId=window.id）。 */
export function runtimeObjectRef(thread: ThreadContext, window: ContextWindow): FlowObjectRef | undefined {
  if (!thread.persistence) return undefined;
  return {
    baseDir: thread.persistence.baseDir,
    sessionId: thread.persistence.sessionId,
    objectId: window.id,
  };
}

export class WindowPersistence {
  constructor(
    private readonly registry: ObjectRegistry,
    /** live 引用 manager 的 window 表；snapshot 时取最新全量。 */
    private readonly windows: Map<string, ContextWindow>,
  ) {}

  async persistWindow(thread: ThreadContext, window: ContextWindow): Promise<void> {
    if (window.id === ROOT_WINDOW_ID) return;
    if (isNonPersistedWindow(window)) return;
    const tref = threadPersistRef(thread);
    if (!tref) return;

    if (this.registry.isBuiltinFeatureType(window.type)) {
      await this.writeThreadContextSnapshot(thread).catch((e) => {
        console.warn(`[WindowPersistence] writeThreadContext failed for ${window.id}: ${(e as Error).message}`);
      });
      return;
    }

    const ref = runtimeObjectRef(thread, window);
    if (!ref) return;
    try {
      await createFlowObject(ref, { class: window.type });
    } catch (e) {
      console.warn(`[WindowPersistence] createFlowObject failed for ${window.id}: ${(e as Error).message}`);
    }
    try {
      await writeRuntimeObjectState(ref, window);
    } catch (e) {
      console.warn(`[WindowPersistence] writeRuntimeObjectState failed for ${window.id}: ${(e as Error).message}`);
      return;
    }
    try {
      const reg = await readContextRegistry(tref);
      const params = pickContextParams(window);
      const idx = reg.members.findIndex((m) => m.objectId === window.id);
      let next: ContextRegistry;
      if (idx >= 0) {
        const cur = reg.members[idx]!;
        const merged: ContextParams = mergeContextParams(cur.params, params);
        if (!paramsEqual(cur.params, merged)) {
          const members = reg.members.slice();
          members[idx] = { objectId: cur.objectId, params: merged };
          next = { version: 1, members };
          await writeContextRegistry(tref, next);
        }
      } else {
        const member: ContextMember = {
          objectId: window.id,
          params: { ...params, order: reg.members.length },
        };
        next = { version: 1, members: [...reg.members, member] };
        await writeContextRegistry(tref, next);
      }
    } catch (e) {
      console.warn(`[WindowPersistence] update registry failed for ${window.id}: ${(e as Error).message}`);
    }

    await this.writeThreadContextSnapshot(thread).catch((e) => {
      console.warn(`[WindowPersistence] writeThreadContext failed for ${window.id}: ${(e as Error).message}`);
    });
  }

  async writeThreadContextSnapshot(thread: ThreadContext): Promise<void> {
    const tref = threadPersistRef(thread);
    if (!tref) return;
    const entries = buildThreadContextEntries(this.windows.values(), this.registry);
    await writeThreadContext(tref, entries);
  }

  async unpersistWindow(thread: ThreadContext, window: ContextWindow): Promise<void> {
    if (!thread.persistence) return;
    if (window.id === ROOT_WINDOW_ID) return;
    if (this.registry.isBuiltinFeatureType(window.type)) {
      await this.writeThreadContextSnapshot(thread).catch((e) => {
        console.warn(
          `[WindowPersistence] writeThreadContext failed during delete for ${window.id}: ${(e as Error).message}`,
        );
      });
      return;
    }
    await this.removeFromRuntimeAndRegistry(thread, window);
    await this.writeThreadContextSnapshot(thread).catch((e) => {
      console.warn(
        `[WindowPersistence] writeThreadContext failed during delete for ${window.id}: ${(e as Error).message}`,
      );
    });
  }

  private async removeFromRuntimeAndRegistry(thread: ThreadContext, window: ContextWindow): Promise<void> {
    const tref = threadPersistRef(thread);
    if (!tref) return;
    if (window.id === ROOT_WINDOW_ID) return;
    try {
      const reg = await readContextRegistry(tref);
      const idx = reg.members.findIndex((m) => m.objectId === window.id);
      if (idx < 0) return;
      const members = reg.members.slice();
      members.splice(idx, 1);
      await writeContextRegistry(tref, { version: 1, members });
    } catch (e) {
      console.warn(`[WindowPersistence] remove from registry failed for ${window.id}: ${(e as Error).message}`);
    }
    const ref = runtimeObjectRef(thread, window);
    if (!ref) return;
    try {
      await deleteRuntimeObject(ref);
    } catch (e) {
      console.warn(`[WindowPersistence] deleteRuntimeObject failed for ${window.id}: ${(e as Error).message}`);
    }
  }

  /** 把某独立 flow object 当前内存态强制刷到它的 state.json（method 内 mutate 后调）。 */
  reportStateEdit(ref: FlowObjectRef): Promise<void> {
    const window = this.windows.get(ref.objectId);
    if (!window) return Promise.resolve();
    if (this.registry.isBuiltinFeatureType(window.type)) return Promise.resolve();
    return writeRuntimeObjectState(ref, window);
  }

  /** 把当前 thread 全量 windows 强制刷到 thread-context.json。 */
  reportContextEdit(thread: ThreadContext): Promise<void> {
    return this.writeThreadContextSnapshot(thread);
  }
}

function pickContextParams(window: ContextWindow): ContextParams {
  const w = window as ContextWindow & {
    compressLevel?: number;
    parentWindowId?: string;
  };
  const params: ContextParams = {};
  if (typeof w.compressLevel === "number") params.compressLevel = w.compressLevel;
  if (typeof w.parentWindowId === "string" && w.parentWindowId !== ROOT_WINDOW_ID) {
    params.parentObjectId = w.parentWindowId;
  }
  return params;
}

function mergeContextParams(cur: ContextParams, next: ContextParams): ContextParams {
  return {
    compressLevel: next.compressLevel ?? cur.compressLevel,
    decayMeta: next.decayMeta !== undefined ? next.decayMeta : cur.decayMeta,
    order: cur.order,
    parentObjectId: next.parentObjectId ?? cur.parentObjectId,
  };
}

function paramsEqual(a: ContextParams, b: ContextParams): boolean {
  if ((a.compressLevel ?? null) !== (b.compressLevel ?? null)) return false;
  if ((a.order ?? null) !== (b.order ?? null)) return false;
  if ((a.parentObjectId ?? null) !== (b.parentObjectId ?? null)) return false;
  const ad = a.decayMeta ?? null;
  const bd = b.decayMeta ?? null;
  if (ad === bd) return true;
  if (ad === null || bd === null) return false;
  return ad.lastTouchedAt === bd.lastTouchedAt && ad.idleRounds === bd.idleRounds;
}
