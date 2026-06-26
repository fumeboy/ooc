/**
 * thread ThreadRuntime —— thread builtin 私有运行时 facade。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md` 核心 5/10 + E.thread。
 *
 * **职责**：把「在一条 thread 上执行 tool 原语（exec / close / wait / open）」串起来。封装：
 * - **解析**：从 thread.contextWindows 找窗 → 经 ClassRegistry 解析 class 的 method/lifecycle
 * - **执行**：构造 ctx → dispatch 到 method exec / window method exec
 * - **生命周期**：close 移除窗（refcount 减 1）→ refcount 归 0 触发 class.unactive
 * - **实例化**：method 调 `runtime.instantiate({class,args})` → 经 class.construct 造新对象、
 *   登记进 session 对象表 + 挂进 thread.contextWindows + 触发 class.active
 *
 * **issue E**：refcount 计算 + GC 移到 core（refcount.ts / gc.ts），本 runtime 改 import
 * `computeRefcount` 公共算法，不再持私域 `refcountInSession`。`dispatchUnactive` 实现要
 * **幂等**：已 unactive 的 inst 再次调用静默跳过（防 close 即时 + GC pass2 重入）。
 *
 * **为什么 ThreadRuntime 仍归 thread builtin**：method dispatch / instantiate / close / open
 * 这些与 "tool 原语在 thread 上行使" 强耦合的编排逻辑专于 thread；core 通用 seam 是
 * computeRefcount / startSessionGc。
 */
import type { OocObjectInstance, OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import {
  type ObjectInsRegistry,
  getSessionRegistry,
} from "@ooc/core/runtime/object-registry.js";
import { computeRefcount } from "@ooc/core/runtime/refcount.js";
import { isSelfThreadWindow, threadWindowIdOf } from "@ooc/core/types/context-window.js";
import { makeSelfProxy, makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
import {
  type ExecutableContext,
  type ObjectGuideMethod,
  type ObjectMethod,
  type ObjectMethodResult,
  type ObjectMethodIntents,
  type RuntimeHandle,
  type WindowMethod,
  type ReadableContext,
  normalizeMethodResult,
} from "@ooc/core/types/index.js";
import type { ThreadContext } from "../types.js";

/** 一条 thread 的运行时 facade —— 实现 RuntimeHandle，注入到 method ctx。 */
export class ThreadRuntime implements RuntimeHandle {
  private readonly thread: ThreadContext;
  private readonly registry: ObjectInsRegistry;
  /** dataEdit 通知（thinkloop 注入持久化挂钩）。 */
  private readonly onDataEdit?: () => Promise<void> | void;
  /** worldDir —— 落盘根目录，方法 ctx 透传。 */
  private readonly worldDir: string;
  /**
   * 跨 session 唤醒钩子（worker.ts / thinkloop 注入）；缺席时 `scheduleSession` 静默 no-op + warn。
   * 见 `RuntimeHandle.scheduleSession` JSDoc 与 issue G。
   */
  private readonly wakeSession?: (sessionId: string) => void;
  /** 已 unactive 完毕的 inst 记录 —— dispatchUnactive 幂等护栏。 */
  private readonly unactiveDispatched = new Set<string>();

  constructor(
    thread: ThreadContext,
    registry: ObjectInsRegistry,
    opts: {
      onDataEdit?: () => Promise<void> | void;
      worldDir?: string;
      wakeSession?: (sessionId: string) => void;
    } = {},
  ) {
    this.thread = thread;
    this.registry = registry;
    this.onDataEdit = opts.onDataEdit;
    this.worldDir = opts.worldDir ?? "";
    this.wakeSession = opts.wakeSession;
  }

  /** 从 thread 派生 ThreadRuntime —— 取该 thread 所在 session 的 ObjectInsRegistry。 */
  static fromThread(
    thread: ThreadContext,
    opts: {
      onDataEdit?: () => Promise<void> | void;
      worldDir?: string;
      wakeSession?: (sessionId: string) => void;
    } = {},
  ): ThreadRuntime {
    return new ThreadRuntime(thread, getSessionRegistry(thread.sessionId), opts);
  }

  /** 找窗（按 ref.id 在 contextWindows 数组里）。 */
  findWindow(windowId: string): OocObjectRef | undefined {
    return this.thread.contextWindows.find((w) => w.id === windowId);
  }

  /**
   * 把 ref 解析为业务 data —— self-view ref（id 形如 `w_creator_<threadId>`，issue I）短路到
   * 当前 thread 自身 data；其它 ref 经 session 表按 ref.id 解析。
   *
   * 设计理由：self-view ref 是 thread 在自身 contextWindows 中"看自己"的入口；session 表里没
   * 一个 id=`w_creator_<threadId>` 的 inst（thread inst 的 id = threadId 本身）。
   * 短路避免空 data 退化破坏 readable / method 执行。
   */
  private objectDataOf(ref: OocObjectRef): unknown {
    if (isSelfThreadWindow(ref.id) && ref.id === threadWindowIdOf(this.thread.id)) {
      return this.thread;
    }
    return this.registry.getObject(ref.id)?.data;
  }

  /**
   * **exec 原语**：在一个 window 上调一条 method（按名分派 object method / guide method / window method）。
   *
   * 优先级：
   *   1. resolveObjectMethod 命中 → 单步 method 直执行（schema 校验由 method 自身/可选 wrapper 处理）。
   *   2. resolveObjectGuideMethod 命中 → 多步引导：先跑 guide.route 拿 ObjectMethodIntents：
   *      - `quickSubmit=true` → 直接 guide.exec。
   *      - 否则 → 自动 `instantiate(_builtin/agent/method_exec_form)` 把 form ref 返给 tool call。
   *   3. resolveWindowMethod 命中 → 改投影 win。
   *   4. 都不命中 → fail-loud。
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
    const guideMethod = this.registry.resolveObjectGuideMethod(ref.class, methodName);
    if (guideMethod) {
      return await this.execGuideMethod(ref, methodName, guideMethod, args);
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
    const data = this.objectDataOf(ref) ?? {};
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

  /**
   * 跑一条 **guide method** —— 多步引导：
   *   - 先跑 guide.route 拿 ObjectMethodIntents。
   *   - `quickSubmit=true` → 直接 guide.exec（与单步 method 等价）。
   *   - 否则 → 自动 `instantiate(_builtin/agent/method_exec_form, { targetObjectId, guideName,
   *     accumulatedArgs, currentTip, currentIntents })`，把 form ref 作为 refs 返给 tool call。
   */
  private async execGuideMethod(
    ref: OocObjectRef,
    guideName: string,
    guide: ObjectGuideMethod,
    args: Record<string, unknown>,
  ): Promise<ObjectMethodResult> {
    const data = this.objectDataOf(ref) ?? {};
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
    const intents = await guide.route(ctx, self, args);
    if (intents?.quickSubmit) {
      const raw = await guide.exec(ctx, self, args);
      return normalizeMethodResult(raw);
    }
    // 否则自动开 form，把 form ref 返给 tool call
    const formRef = await this.instantiate({
      class: "_builtin/agent/method_exec_form",
      args: {
        targetObjectId: ref.id,
        guideName,
        accumulatedArgs: args,
        currentTip: intents?.tip,
        currentIntents: intents?.intents,
      },
    });
    const tipPart = intents?.tip ? `（提示：${intents.tip}）` : "";
    return {
      message: `已开启表单 ${formRef.id}；继续用 refine 补参或 submit 提交${tipPart}`,
      refs: [formRef],
    };
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
    if (computeRefcount(this.thread.sessionId, objectId, this.registry) === 0) {
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

  /**
   * **open 原语**（issue E）：对目标 object 的某 method 开一张 `method_exec_form`，把
   * `want`（自然语言意图）写进 form data —— 不执行 method 本身。
   *
   * 行为：
   *   1. 解析目标 object 的 method/guide：
   *      - 命中 ObjectGuideMethod → 跑一次 guide.route 拿 currentTip / currentIntents（与
   *        `exec` 命中 guide 自动开 form 路径同构，区别仅在 quickSubmit 一律不生效——open 一律
   *        开 form，承载 want）。
   *      - 命中 ObjectMethod → tip/intents 留空（form 仍可用，引导 agent refine 后 submit）。
   *      - 都未命中 → fail-loud。
   *   2. instantiate `_builtin/agent/method_exec_form`，注入 `want`、`targetObjectId`、`guideName`
   *      （单步 method 时填 method name）、`currentTip` / `currentIntents`。
   *   3. 返回 form ref 给 tool call —— agent 下一轮在 form 上 refine / submit。
   */
  async open(
    objectId: string,
    methodName: string,
    want: string,
  ): Promise<ObjectMethodResult> {
    const ref = this.findWindow(objectId);
    if (!ref) throw new Error(`[open] window not found: ${objectId}`);

    let currentTip: string | undefined;
    let currentIntents: string[] | undefined;

    const guide = this.registry.resolveObjectGuideMethod(ref.class, methodName);
    if (guide) {
      // 跑一次 route 取初始 tip / intents（不行使 exec）
      const intents = await this.runRoute(objectId, methodName, {});
      currentTip = intents?.tip;
      currentIntents = intents?.intents;
    } else {
      const method = this.registry.resolveObjectMethod(ref.class, methodName);
      if (!method) {
        throw new Error(`[open] method not found on class ${ref.class}: ${methodName}`);
      }
    }

    const formRef = await this.instantiate({
      class: "_builtin/agent/method_exec_form",
      args: {
        targetObjectId: objectId,
        guideName: methodName,
        accumulatedArgs: {},
        currentTip,
        currentIntents,
        want,
      },
    });
    const tipPart = currentTip ? `（提示：${currentTip}）` : "";
    return {
      message: `已开启表单 ${formRef.id};want=${want}${tipPart}`,
      refs: [formRef],
    };
  }

  // ─────────────────────── RuntimeHandle 实现 ───────────────────────

  /**
   * **scheduleSession 信号**（issue G）：唤醒目标 sessionId 的 worker 处理已写盘的 inbox/事件。
   *
   * 仅唤醒、不传载荷：调用者（say / reply / talk-super append）必须**先**写盘对端数据，再调本
   * method 让 wakeSession 钩子转发到 worker.enqueueScheduler。tier-A 控制面 / 测试态 wakeSession
   * 未注入时静默 no-op + warn，不抛错（防 storybook 红）。
   */
  scheduleSession(sessionId: string): void {
    if (!this.wakeSession) {
      console.warn(
        "[ThreadRuntime] scheduleSession called without wakeSession hook (sid=%s)",
        sessionId,
      );
      return;
    }
    this.wakeSession(sessionId);
  }

  /**
   * 实例化一个新对象 —— 经 class.construct 造初始 data → 登记 session 表 → 挂进 thread.contextWindows
   * → 触发 class.active。
   *
   * `windowView`（issue J,可选）：调用方需要指定该窗的投影视角时经 args 透传,写入 ref.window_view；
   * 缺省 → ref 不写视角字段 → readable render 走 DEFAULT_WINDOW_VIEW 兜底。
   */
  async instantiate(spec: {
    class: string;
    childId?: string;
    args?: Record<string, unknown>;
    windowView?: string;
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
    const firstReference = computeRefcount(this.thread.sessionId, id, this.registry) === 0;
    this.registry.setObject(instance);
    const ref: OocObjectRef = { id, class: spec.class, createdAt: Date.now() };
    if (spec.windowView) ref.window_view = spec.windowView;
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

  /**
   * runRoute —— 不执行 exec、只算 intents。method_exec form 的 refine 用：
   * 解析目标 class 的 **guide method**（不是 object method——method 不再持 route），用累积参数刷新
   * tip / intents 写回 form data。找不到目标 / 目标不是 guide → 返回 undefined。
   */
  async runRoute(
    targetObjectId: string,
    guideName: string,
    args: Record<string, unknown>,
  ): Promise<ObjectMethodIntents | undefined> {
    const ref = this.findWindow(targetObjectId);
    if (!ref) return undefined;
    const g = this.registry.resolveObjectGuideMethod(ref.class, guideName);
    if (!g) return undefined;
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
    return await g.route(ctx, makeSelfProxy(data as object, ref.id, this), args);
  }

  /**
   * execGuide —— **直接**调目标 guide 的 `exec`（**跳过 route、不开 form**）。method_exec form 的
   * `submit` 用它落实累积参数；区别于 `callMethod`（走 exec dispatch 入口，guide 会被再次开 form 触发递归）。
   */
  async execGuide(
    targetObjectId: string,
    guideName: string,
    args: Record<string, unknown>,
  ): Promise<ObjectMethodResult | undefined> {
    const ref = this.findWindow(targetObjectId);
    if (!ref) return undefined;
    const g = this.registry.resolveObjectGuideMethod(ref.class, guideName);
    if (!g) return undefined;
    const data = this.objectDataOf(ref) ?? {};
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
    const raw = await g.exec(ctx, self, args);
    return normalizeMethodResult(raw);
  }

  // ─────────────────────── refcount / 生命周期 ───────────────────────

  /**
   * refcount 算法已迁入 `@ooc/core/runtime/refcount.ts:computeRefcount`（issue E）——本类直接
   * import 使用；不再持私域 `refcountInSession`。
   */

  private async dispatchActive(objectId: string): Promise<void> {
    const inst = this.registry.getObject(objectId);
    if (!inst) return;
    const hook = this.registry.resolveActive(inst.class);
    if (!hook) return;
    // 重新进入 active 视为重新激活——清掉幂等记录，让后续 unactive 仍可派发。
    this.unactiveDispatched.delete(objectId);
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

  /**
   * **dispatchUnactive 幂等**（issue E）：close 即时触发 + GC pass2 兜底可能并发到达同一 inst，
   * 已派发过的静默跳过，防重复 lifecycle 副作用。
   */
  async dispatchUnactive(objectId: string): Promise<void> {
    if (this.unactiveDispatched.has(objectId)) return;
    const inst = this.registry.getObject(objectId);
    if (!inst) {
      // inst 已被 GC pass1 移除 → 标记跳过，防外部再调
      this.unactiveDispatched.add(objectId);
      return;
    }
    const hook = this.registry.resolveUnactive(inst.class);
    if (!hook) {
      this.unactiveDispatched.add(objectId);
      return;
    }
    this.unactiveDispatched.add(objectId);
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
