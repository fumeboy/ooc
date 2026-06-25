/**
 * thread WindowManager —— thread builtin 私有运行时 facade。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md` 核心 5/10 + E.thread。
 *
 * **职责**：把「在一条 thread 上执行 tool 原语（exec / close / wait）」串起来。封装：
 * - **解析**：从 thread.contextWindows 找窗 → 经 ClassRegistry 解析 class 的 method/lifecycle
 * - **执行**：构造 ctx → dispatch 到 method exec / window method exec
 * - **生命周期**：close 移除窗（refcount 减 1）→ refcount 归 0 触发 class.unactive
 * - **实例化**：method 调 `runtime.instantiate({class,args})` → 经 class.construct 造新对象、
 *   登记进 session 对象表 + 挂进 thread.contextWindows + 触发 class.active
 *
 * **为什么归 thread builtin**：`contextWindows` 是 thread 形状特有；refcount = "扫本 session 全部
 * thread 看 contextWindows 引用此 object 的个数"，只有 thread 形状的对象 contributes refcount。
 * 故 WindowManager 是 thread 的私有运行时，不是 core 通用机制。core 只出 ClassRegistry /
 * ObjectInsRegistry 泛型 seam。
 */
import type { OocObjectInstance, OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import {
  type ObjectInsRegistry,
  getSessionRegistry,
  iterateSessionObjectTable as _iter,
} from "@ooc/core/runtime/object-registry.js";
import { makeSelfProxy, makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
import {
  type ExecutableContext,
  type ObjectMethod,
  type ObjectMethodResult,
  type ObjectMethodIntents,
  type RuntimeHandle,
  type WindowMethod,
  type ReadableContext,
  normalizeMethodResult,
  THREAD_CLASS_ID,
} from "@ooc/core/types/index.js";
import type { ThreadContext } from "../types.js";

/** 一条 thread 的运行时 facade —— 实现 RuntimeHandle，注入到 method ctx。 */
export class WindowManager implements RuntimeHandle {
  private readonly thread: ThreadContext;
  private readonly registry: ObjectInsRegistry;
  /** dataEdit 通知（thinkloop 注入持久化挂钩）。 */
  private readonly onDataEdit?: () => Promise<void> | void;
  /** worldDir —— 落盘根目录，方法 ctx 透传。 */
  private readonly worldDir: string;

  constructor(
    thread: ThreadContext,
    registry: ObjectInsRegistry,
    opts: { onDataEdit?: () => Promise<void> | void; worldDir?: string } = {},
  ) {
    this.thread = thread;
    this.registry = registry;
    this.onDataEdit = opts.onDataEdit;
    this.worldDir = opts.worldDir ?? "";
  }

  /** 从 thread 派生 WindowManager —— 取该 thread 所在 session 的 ObjectInsRegistry。 */
  static fromThread(
    thread: ThreadContext,
    opts: { onDataEdit?: () => Promise<void> | void; worldDir?: string } = {},
  ): WindowManager {
    return new WindowManager(thread, getSessionRegistry(thread.sessionId), opts);
  }

  /** 找窗（按 ref.id 在 contextWindows 数组里）。 */
  findWindow(windowId: string): OocObjectRef | undefined {
    return this.thread.contextWindows.find((w) => w.id === windowId);
  }

  /** 取窗所引用对象的业务 data（经 session 表按 ref.id 解析）。 */
  private objectDataOf(ref: OocObjectRef): unknown {
    return this.registry.getObject(ref.id)?.data;
  }

  /**
   * **exec 原语**：在一个 window 上调一条 method（按名分派 object method 或 window method）。
   *
   * 优先 object method（改 data / 副作用），其次 window method（改投影 win）。
   */
  async exec(
    windowId: string,
    methodName: string,
    args: Record<string, unknown> = {},
  ): Promise<ObjectMethodResult> {
    const ref = this.findWindow(windowId);
    if (!ref) throw new Error(`[exec] window not found: ${windowId}`);
    const objectMethod = this.registry.resolveObjectMethod(ref.class, methodName);
    if (objectMethod) {
      return await this.execObjectMethod(ref, objectMethod, args);
    }
    const windowMethod = this.registry.resolveWindowMethod(ref.class, ref.class, methodName);
    if (windowMethod) {
      await this.execWindowMethod(ref, windowMethod, args);
      return {};
    }
    throw new Error(`[exec] method not found on class ${ref.class}: ${methodName}`);
  }

  /** 跑一条 object method —— 改业务 data、可副作用。 */
  private async execObjectMethod(
    ref: OocObjectRef,
    method: ObjectMethod,
    args: Record<string, unknown>,
  ): Promise<ObjectMethodResult> {
    const instance = this.registry.getObject(ref.id);
    const data = instance?.data ?? {};
    const ctx: ExecutableContext = {
      object: { id: ref.id, class: ref.class },
      runtime: this,
      reportDataEdit: async () => {
        if (this.onDataEdit) await this.onDataEdit();
      },
      args,
      dir: "",
      worldDir: this.worldDir,
      sessionId: this.thread.sessionId,
    };
    const self = makeSelfProxy(data as object, ref.id, this);
    const raw = await method.exec(ctx, self, args);
    return normalizeMethodResult(raw);
  }

  /** 跑一条 window method —— 只动投影 win、返回新 win，写回 ref.data。 */
  private async execWindowMethod(
    ref: OocObjectRef,
    method: WindowMethod,
    args: Record<string, unknown>,
  ): Promise<void> {
    const data = this.objectDataOf(ref) ?? {};
    const ctx: ReadableContext = { object: { id: ref.id, class: ref.class } };
    const self = makeReadonlySelfProxy(data as object);
    const newWin = await method.exec(ctx, self, ref.data, args);
    ref.data = newWin;
  }

  /**
   * **close 原语**：移除一个窗（refcount 减 1）；归 0 触发 class.unactive。
   */
  async close(windowId: string): Promise<void> {
    const ref = this.findWindow(windowId);
    if (!ref) throw new Error(`[close] window not found: ${windowId}`);
    if (ref.closable === false) {
      throw new Error(`[close] window ${windowId} is not closable (structural)`);
    }
    const objectId = ref.id;
    this.thread.contextWindows = this.thread.contextWindows.filter((w) => w.id !== windowId);
    if (this.refcountInSession(objectId) === 0) {
      await this.dispatchUnactive(objectId);
    }
  }

  /**
   * **wait 原语**：让 thread 进入 waiting；scheduler 据 messages/events 增长唤醒。
   */
  wait(windowId: string): void {
    const ref = this.findWindow(windowId);
    if (!ref) throw new Error(`[wait] window not found: ${windowId}`);
    this.thread.status = "waiting";
  }

  // ─────────────────────── RuntimeHandle 实现 ───────────────────────

  /**
   * 实例化一个新对象 —— 经 class.construct 造初始 data → 登记 session 表 → 挂进 thread.contextWindows
   * → 触发 class.active。
   */
  async instantiate(spec: {
    class: string;
    childId?: string;
    args?: Record<string, unknown>;
  }): Promise<OocObjectRef> {
    const ctor = this.registry.resolveConstructor(spec.class);
    if (!ctor) throw new Error(`[instantiate] class ${spec.class} has no constructor`);
    const id =
      spec.childId ??
      `${spec.class}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const data = await ctor.exec(
      {
        sessionId: this.thread.sessionId,
        worldDir: this.worldDir,
        dir: "",
        runtime: this,
        args: spec.args ?? {},
      },
      spec.args ?? {},
    );
    const instance: OocObjectInstance = { id, class: spec.class, data };
    const firstReference = this.refcountInSession(id) === 0;
    this.registry.setObject(instance);
    const ref: OocObjectRef = { id, class: spec.class, createdAt: Date.now() };
    this.thread.contextWindows.push(ref);
    if (firstReference) await this.dispatchActive(id);
    return ref;
  }

  /** 经当前 thread 调一个对象的 method（self.methods.foo 自调通道）。 */
  async callMethod(
    objectId: string,
    methodName: string,
    args: Record<string, unknown> = {},
  ): Promise<string | undefined> {
    const ref = this.findWindow(objectId);
    if (!ref) return undefined;
    const result = await this.exec(objectId, methodName, args);
    return result.message;
  }

  /** runRoute —— 不执行 exec、只算 intents。method_exec form refine 用。 */
  async runRoute(
    targetObjectId: string,
    methodName: string,
    args: Record<string, unknown>,
  ): Promise<ObjectMethodIntents | undefined> {
    const ref = this.findWindow(targetObjectId);
    if (!ref) return undefined;
    const m = this.registry.resolveObjectMethod(ref.class, methodName);
    if (!m?.route) return undefined;
    const data = this.objectDataOf(ref) ?? {};
    const ctx: ExecutableContext = {
      object: { id: ref.id, class: ref.class },
      runtime: this,
      reportDataEdit: async () => {},
      args,
      dir: "",
      worldDir: this.worldDir,
      sessionId: this.thread.sessionId,
    };
    return m.route(ctx, makeSelfProxy(data as object, ref.id, this), args);
  }

  // ─────────────────────── refcount / 生命周期 ───────────────────────

  /**
   * 扫本 session 全部 thread，数 objectId 在 contextWindows 里的引用次数。
   *
   * 只有 thread 形状对象 contributes refcount——故这是 thread builtin 的私有算法。
   */
  private refcountInSession(objectId: string): number {
    let count = 0;
    _iter(this.thread.sessionId, (inst) => {
      if (inst.class !== THREAD_CLASS_ID) return;
      const t = inst.data as ThreadContext;
      for (const w of t.contextWindows) {
        if (w.id === objectId) count++;
      }
    });
    return count;
  }

  private async dispatchActive(objectId: string): Promise<void> {
    const inst = this.registry.getObject(objectId);
    if (!inst) return;
    const hook = this.registry.resolveActive(inst.class);
    if (!hook) return;
    await hook.exec(
      {
        sessionId: this.thread.sessionId,
        worldDir: this.worldDir,
        dir: "",
        args: {},
        targetId: objectId,
        reportDataEdit: async () => {
          if (this.onDataEdit) await this.onDataEdit();
        },
      },
      inst.data,
    );
  }

  private async dispatchUnactive(objectId: string): Promise<void> {
    const inst = this.registry.getObject(objectId);
    if (!inst) return;
    const hook = this.registry.resolveUnactive(inst.class);
    if (!hook) return;
    const result = await hook.exec(
      {
        sessionId: this.thread.sessionId,
        worldDir: this.worldDir,
        dir: "",
        args: {},
        targetId: objectId,
        reportDataEdit: async () => {
          if (this.onDataEdit) await this.onDataEdit();
        },
      },
      inst.data,
    );
    if (result && typeof result === "object" && "delete" in result && result.delete === true) {
      this.registry.removeObject(objectId);
    }
  }
}
