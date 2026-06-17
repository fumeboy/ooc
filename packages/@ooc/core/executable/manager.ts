/**
 * WindowManager — thread 持有的 object 实例（`OocObjectInstance`）的统一操作入口，
 * 兼 `RuntimeHandle` 实现（Wave 4 对象模型重构后的承重墙枢纽）。
 *
 * 职责：
 * - 持有 thread.contextWindows（`OocObjectInstance[]`），封装增删改查。
 * - 实现 `RuntimeHandle`：
 *   - instantiate(classId, args) = registry 查 construct → `construct.exec(ctx, args)=>Data`
 *     → 包成 `OocObjectInstance`（runtime 分配 id/title/status/createdAt）→ push 进
 *     thread.contextWindows → 返回新 id；construct 失败 throw（不建实例）。
 *   - close(objectId) = 从 thread 移除该实例。
 * - object method dispatch（三参）：`exec(ctx, self=instance.data, args)`。
 * - window method dispatch（四参）：`exec(ctx, self=instance.data, before_win=instance.win, args)`
 *   → 把返回的新 win 不可变 upsert 回 instance.win。
 *
 * **不负责**（Wave 4 后由各 leaf 模块 re-home）：
 * - 持久化（save/load）—— persist leaf 经 reportDataEdit/reportContextEdit 回调挂接。
 * - method 自身实现（各 class 的 executable/readable 模块提供）。
 *
 * 使用模式：
 *   const mgr = WindowManager.fromThread(thread, registry);
 *   const id = await mgr.instantiate("example", { message: "hi" });
 *   const result = await mgr.execObjectMethod(id, "bump", {}, thread);
 *   thread.contextWindows = mgr.toData();
 */

import type { ThreadContext } from "../_shared/types/thread.js";
import type { OocObjectInstance } from "../runtime/ooc-class.js";
import { normalizeMethodOutcome } from "../_shared/types/method.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type WindowStatus,
} from "../_shared/types/context-window.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import type {
  ExecutableContext,
  ConstructorContext,
  RuntimeHandle,
} from "./contract.js";
import type { ReadableContext } from "../readable/contract.js";

/** 可选的持久化回调（persist leaf 在构造时挂接；缺省 no-op，使墙内自洽）。 */
export interface WindowManagerHooks {
  /** 某实例的 data 改变后强制刷盘（object method 副作用后）。 */
  reportDataEdit?: (objectId: string) => Promise<void>;
  /** 整个 thread context 改变后强制刷盘。 */
  reportContextEdit?: () => Promise<void>;
}

export class WindowManager implements RuntimeHandle {
  /** instance id → instance 信封。 */
  private instances: Map<string, OocObjectInstance> = new Map();
  /** 拥有本 manager 的 thread（per-thread；fromThread 工厂建立）。 */
  private threadRef: ThreadContext | undefined;
  /** method/constructor lookup + 继承解析。 */
  readonly registry: ObjectRegistry;
  /** 持久化回调（缺省 no-op；attachPersistence 可后挂 persist leaf 的刷盘回调）。 */
  private hooks: WindowManagerHooks;

  private constructor(registry: ObjectRegistry, hooks: WindowManagerHooks = {}) {
    this.registry = registry;
    this.hooks = hooks;
  }

  /**
   * 接线 persist leaf 的刷盘回调（eager 持久化）。
   *
   * persist leaf 的 `WindowPersistence` 须与本 manager 共享**同一份 live `instances` Map**——
   * 其 reportContextEdit / reportDataEdit 直接序列化这份 map（不依赖调用方 toData() 回写时序），
   * 故只能从 manager 内部挂接（manager.instances 私有）。动态 import 避免 wall→persist 静态依赖。
   *
   * 已显式传入 hooks（如测试）时不覆盖。
   */
  async attachPersistence(thread: ThreadContext): Promise<void> {
    if (this.hooks.reportContextEdit || this.hooks.reportDataEdit) return;
    const { WindowPersistence } = await import("../persistable/window-persistence.js");
    const wp = new WindowPersistence(this.registry, this.instances);
    this.hooks = wp.hooksFor(thread);
  }

  /** 从 thread.contextWindows 装载实例。 */
  static fromThread(
    thread: ThreadContext,
    registry: ObjectRegistry,
    hooks: WindowManagerHooks = {},
  ): WindowManager {
    const mgr = new WindowManager(registry, hooks);
    mgr.threadRef = thread;
    for (const inst of thread.contextWindows ?? []) {
      mgr.instances.set(inst.id, inst);
    }
    return mgr;
  }

  // ── 查询 ──

  /** 导出为 thread.contextWindows 用的 flat 数组。 */
  toData(): OocObjectInstance[] {
    return Array.from(this.instances.values());
  }

  list(): OocObjectInstance[] {
    return Array.from(this.instances.values());
  }

  get(id: string): OocObjectInstance | undefined {
    return this.instances.get(id);
  }

  childrenOf(parentObjectId: string): OocObjectInstance[] {
    return this.list().filter((i) => i.parentObjectId === parentObjectId);
  }

  // ── RuntimeHandle：instantiate / close ──

  /**
   * 调某 class 的 construct 造新实例、挂进当前 thread；返回新实例 id。
   *
   * registry 查 construct → `construct.exec(ctx, args)=>Data` → 包成 `OocObjectInstance`
   * （runtime 分配 id/title/status/createdAt；title 缺省取 args.title 或 classId，status="open"）
   * → push 进 thread.contextWindows。construct 失败 throw（不建实例）。
   */
  async instantiate(
    classId: string,
    args: Record<string, unknown> = {},
  ): Promise<string> {
    const ctor = this.registry.resolveConstructor(classId);
    if (!ctor) {
      throw new Error(
        `instantiate: class "${classId}" has no constructor registered (单例 class 无法 instantiate)`,
      );
    }
    const ctorCtx: ConstructorContext = {
      thread: this.threadRef,
      runtime: this,
      args,
    };
    const data = await ctor.exec(ctorCtx, args);

    const id = generateWindowId(classId);
    const title =
      typeof args.title === "string" && args.title.length > 0
        ? args.title
        : classId;
    const instance: OocObjectInstance = {
      id,
      class: classId,
      title,
      status: "open",
      createdAt: Date.now(),
      data,
    };
    this.instances.set(id, instance);
    await this.hooks.reportContextEdit?.();
    return id;
  }

  /**
   * 委托调当前 thread 内某 object 的 object method（RuntimeHandle.callMethod）。
   *
   * = execObjectMethod 的薄封装：thread 取自本 manager 的 threadRef（method 跑在该 thread
   * 的 thinkloop 内）。无 threadRef 时抛错（callMethod 必须在已绑 thread 的 manager 上调）。
   */
  async callMethod(
    objectId: string,
    methodName: string,
    args: Record<string, unknown> = {},
  ): Promise<string | undefined> {
    if (!this.threadRef) {
      throw new Error(
        `callMethod(${objectId}, ${methodName}): manager 未绑定 thread（须经 fromThread 构造）`,
      );
    }
    return this.execObjectMethod(objectId, methodName, args, this.threadRef);
  }

  /**
   * 经一个 talk-like 会话窗把 msg 派给对端（RuntimeHandle.say）。
   *
   * 复用 talk object method `say`：委托 execObjectMethod(windowId, "say", { msg })。
   * 目标窗须为 talk-like（creator / peer / fork）；其 say 自分流 peer 磁盘 / fork 内存派送。
   */
  async say(windowId: string, msg: string): Promise<string | undefined> {
    if (!this.threadRef) {
      throw new Error(`say(${windowId}): manager 未绑定 thread（须经 fromThread 构造）`);
    }
    return this.execObjectMethod(windowId, "say", { msg }, this.threadRef);
  }

  /** 关闭/卸载一个对象实例（从 thread 移除）。 */
  async close(objectId: string): Promise<void> {
    if (objectId === ROOT_WINDOW_ID) return;
    if (!this.instances.has(objectId)) return;
    // 级联关闭子实例。
    for (const child of this.childrenOf(objectId)) {
      await this.close(child.id);
    }
    this.instances.delete(objectId);
    await this.hooks.reportContextEdit?.();
  }

  // ── 直接挂载一个已构造好的实例（loader 注入 self/member 实例等用）。 ──
  upsert(instance: OocObjectInstance): void {
    this.instances.set(instance.id, instance);
  }

  // ── object method dispatch（三参）──

  /**
   * 执行一个 object method：`exec(ctx, self=instance.data, args)`。
   *
   * - ctx 组装为 ExecutableContext{ thread, object:{id,class}, runtime:this, args,
   *   reportDataEdit, reportContextEdit }。
   * - method 可改 self（data）、可副作用；返回结果文本（或 undefined）。
   * - 改 data 后经 reportDataEdit 回调刷盘（缺省 no-op）。
   */
  async execObjectMethod(
    objectId: string,
    methodName: string,
    args: Record<string, unknown>,
    thread: ThreadContext,
  ): Promise<string | undefined> {
    const instance = this.requireInstance(objectId);
    const method = this.registry.resolveObjectMethod(instance.class, methodName);
    if (!method) {
      throw new Error(
        `execObjectMethod: object method "${methodName}" not registered on class "${instance.class}" (id=${objectId})`,
      );
    }
    const ctx: ExecutableContext = {
      thread,
      object: { id: instance.id, class: instance.class },
      runtime: this,
      args,
      reportDataEdit: () => this.hooks.reportDataEdit?.(objectId) ?? Promise.resolve(),
      reportContextEdit: () => this.hooks.reportContextEdit?.() ?? Promise.resolve(),
    };
    const result = await method.exec(ctx, instance.data, args);
    // method 可能就地改了 instance.data（self 即 instance.data 引用）；刷盘。
    await this.hooks.reportDataEdit?.(objectId);
    // exec 返回形态规范化（ObjectMethodResult / 裸 string / void）→ 取面向 LLM 的结果文本。
    const outcome = normalizeMethodOutcome(result);
    return outcome.error ?? outcome.result;
  }

  // ── window method dispatch（四参）──

  /**
   * 执行一个 window method：`exec(ctx, self=instance.data, before_win=instance.win, args)=>新 win`。
   *
   * - ctx 组装为 ReadableContext{ thread, object:{id,class} }（读侧；不携带改业务数据能力）。
   * - 把返回的新 win 不可变 upsert 回 instance.win（spread 新实例对象，不原地改）。
   * - 返回新的 win。
   */
  async execWindowMethod(
    objectId: string,
    methodName: string,
    args: Record<string, unknown>,
    thread: ThreadContext,
  ): Promise<unknown> {
    const instance = this.requireInstance(objectId);
    const method = this.registry.resolveWindowMethod(instance.class, methodName);
    if (!method) {
      throw new Error(
        `execWindowMethod: window method "${methodName}" not registered on class "${instance.class}" (id=${objectId})`,
      );
    }
    const ctx: ReadableContext = {
      thread,
      object: { id: instance.id, class: instance.class },
    };
    const nextWin = await method.exec(ctx, instance.data, instance.win, args);
    // 不可变 upsert：spread 新实例对象写回 win。
    this.instances.set(objectId, { ...instance, win: nextWin });
    await this.hooks.reportContextEdit?.();
    return nextWin;
  }

  /** 设置某实例的信封 status（不可变 upsert）。 */
  setStatus(objectId: string, status: WindowStatus): void {
    const instance = this.instances.get(objectId);
    if (!instance) return;
    this.instances.set(objectId, { ...instance, status });
  }

  // ── 内部 helper ──

  private requireInstance(objectId: string): OocObjectInstance {
    const instance = this.instances.get(objectId);
    if (!instance) {
      throw new Error(`WindowManager: object instance "${objectId}" not found`);
    }
    return instance;
  }
}
