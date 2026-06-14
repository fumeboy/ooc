/**
 * WindowManager — 替代旧 FormManager 的统一 ContextWindow 操作入口。
 *
 * 职责：
 * - 持有 thread.contextWindows，封装所有增删改查
 * - 提供与 LLM 5 原语对齐的方法：
 *   - openMethodExec：在 parent window 下创建 method_exec sub-window；当 onFormChange 返回
 *     quick_exec_submit 时会立刻提交 form；若方法未声明 onFormChange 则直接 exec 不创建 form
 *   - openTypedWindow：创建非 form 的 window（talk_window / todo_window 等）
 *   - refine：累积 method_exec 的 args，调用 onFormChange 重算 tip/intents，可自动 submit
 *   - submit：执行 method；成功自动移除 form；失败保留 result
 *   - close：触发 type 的 onClose，级联关闭子 window
 * - 维护 knowledge path 引用计数（knowledgeRefCount），保证多 window 共享 path 时不被提前释放
 *
 * 不负责：
 * - method 自身的 exec 实现（由各 root/X.ts 与 windows/X.ts 中的 entry.exec 提供）
 * - 持久化（由 src/persistable/thread-json.ts 处理）
 *
 * 使用模式：
 *   const mgr = WindowManager.fromThread(thread);
 *   const formId = await mgr.openMethodExec(...);
 *   thread.contextWindows = mgr.toData();
 */

import type { ThreadContext } from "../../../thinkable/context.js";
import { hashArgs, diffArgs, type FormChangeEvent, type Intent, type IntentCache } from "@ooc/core/_shared/types/intent.js";
import { buildFillState } from "./schema-fill.js";
import type { ObjectRegistry } from "./registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type MethodExecWindow,
  type ContextWindow,
} from "./types.js";
import type { ObjectMethod, MethodExecutionContext } from "./method-types.js";
import type { FlowObjectRef, ThreadPersistenceRef } from "../../../persistable/common.js";
import { WindowPersistence, threadPersistRef, runtimeObjectRef } from "./window-persistence.js";

/**
 * 从 parent 上查找它注册到的 ObjectMethod。
 *
 * parent_window_id 决定查哪个 window 的 methods：
 * - "root" → root 注册到 object registry 的 methods（来自 windows/root/index.ts）
 * - 其他 → 该 window 的 type definition.methods
 *
 * WindowManager 私有方法，使用实例持有的 registry，通过 registry.lookupMethod 检索。
 */

export class WindowManager {
  private windows: Map<string, ContextWindow> = new Map();
  /** knowledge path → 当前持有它的 window id 集合；用于引用计数。 */
  private knowledgeRefs: Map<string, Set<string>> = new Map();
  /**
   * Reference to the owning thread. Stored so sync methods (refine) can
   * write to thread.intentCache without requiring a thread parameter.
   * Manager is per-thread (fromThread factory), so this is safe.
   */
  private threadRef: ThreadContext | undefined;
  /**
   * ObjectRegistry instance used for method lookup, type definition access,
   * and builtin feature checks. Passed in at construction time.
   */
  readonly registry: ObjectRegistry;
  /** 持久化职责（state.json / thread-context.json / context-registry）的委托。 */
  private readonly persistence: WindowPersistence;

  private constructor(registry: ObjectRegistry) {
    this.registry = registry;
    this.persistence = new WindowPersistence(registry, this.windows);
  }

  /** 从 thread.contextWindows 装载状态。 */
  static fromThread(thread: ThreadContext, registry: ObjectRegistry): WindowManager {
    const mgr = new WindowManager(registry);
    mgr.threadRef = thread;
    for (const window of (thread.contextWindows ?? []) as ContextWindow[]) {
      mgr.windows.set(window.id, window);
      mgr.recordKnowledgeRefs(window);
    }
    return mgr;
  }

  /** Look up a method on the given object's type through the registry. */
  private lookupMethodEntry(
    self: ContextWindow,
    command: string,
  ): ObjectMethod | undefined {
    return this.registry.lookupMethod(self, command);
  }

  /** Get the thread reference. */
  private getThread(): ThreadContext | undefined {
    return this.threadRef;
  }

  /** 导出为 thread.contextWindows 用的 flat 数组。 */
  toData(): ContextWindow[] {
    return Array.from(this.windows.values());
  }

  /** 列出所有 window 的浅拷贝。 */
  list(): ContextWindow[] {
    return Array.from(this.windows.values());
  }

  /** 取指定 window；不存在返回 undefined。 */
  get(id: string): ContextWindow | undefined {
    return this.windows.get(id);
  }

  /** 列出指定 parent 下的直接子 window。 */
  childrenOf(parentId: string): ContextWindow[] {
    return this.list().filter((w) => w.parentWindowId === parentId);
  }

  // ── onFormChange dispatch helper ──

  /**
   * Call onFormChange on the method entry and apply the returned MethodExecuteForm
   * to the given MethodExecWindow: sets form.tip, updates intents in cache, returns
   * the intents and quick_exec_submit flag.
   *
   * Safe to call even if entry has no onFormChange (returns defaults).
   */
  private applyFormChange(
    entry: ObjectMethod,
    change: FormChangeEvent,
    form: MethodExecWindow,
    thread: ThreadContext,
  ): { intents: Intent[]; quickExecSubmit: boolean } {
    const defaultIntent: Intent = { name: form.method };
    const cache: IntentCache | undefined = (thread as any).intentCache;

    if (!entry.onFormChange) {
      const intents = [defaultIntent];
      cache?.set(form.id, {
        argsHash: hashArgs(form.accumulatedArgs),
        status: form.status,
        intents,
      });
      return { intents, quickExecSubmit: false };
    }

    let result: ReturnType<NonNullable<ObjectMethod["onFormChange"]>> | undefined;
    try {
      result = entry.onFormChange(change, { args: form.accumulatedArgs });
    } catch {
      result = { intents: [defaultIntent] };
    }
    const resolved = result ?? { intents: [defaultIntent] };
    const intents: Intent[] = resolved.intents.length > 0 ? resolved.intents : [defaultIntent];
    // Ensure method name is first
    if (!intents.some((i) => i.name === form.method)) {
      intents.unshift(defaultIntent);
    }
    form.tip = resolved.tip;
    form.intentPaths = intents.map((i) => i.name);
    cache?.set(form.id, {
      argsHash: hashArgs(form.accumulatedArgs),
      status: form.status,
      intents,
    });
    return { intents, quickExecSubmit: !!resolved.quick_exec_submit };
  }

  // ── End helpers ──

  /**
   * 在 parent_window_id 下打开一个 method_exec sub-window。
   *
   * - parent_window_id 缺省 = ROOT_WINDOW_ID
   * - 若方法未声明 onFormChange：跳过 form 创建，直接 exec 并返回结果（无 formId）
   * - 若方法声明了 onFormChange：创建 form，触发初始 status_changed(open)，
   *   若返回 quick_exec_submit=true 则自动 submit
   *
   * 返回 { formId?, autoSubmitted, directResult? }
   * - 无 onFormChange 时 formId 为空，directResult 是 exec 返回值
   * - autoSubmitted=true 表示 open 已经直接提交 form；submitResult 是 method.exec 的返回值
   *
   * 注意：本方法不直接 mutate thread；调用方负责 thread.contextWindows = mgr.toData()
   */
  async openMethodExec(opts: {
    thread: ThreadContext;
    parentWindowId?: string;
    method: string;
    title: string;
    description?: string;
    args?: Record<string, unknown>;
  }): Promise<{ formId?: string; autoSubmitted: boolean; submitResult?: string; directResult?: string }> {
    const parentId = opts.parentWindowId ?? ROOT_WINDOW_ID;
    const parent = this.requireParent(parentId);

    // sharing 守门（talk_window.share）：readonly-ref 只读引用 / mutable-ref shadow 都不能调 object method。
    if (parent.sharing) {
      const isCloseOnRef = parent.sharing.kind === "readonly-ref" && opts.method === "close";
      if (!isCloseOnRef) {
        const reason =
          parent.sharing.kind === "readonly-ref"
            ? `window ${parent.id} 是只读引用 readonly-ref（owner 在 thread "${parent.sharing.ownerThreadId}"），不允许执行命令 "${opts.method}"。仅可 close 释放本地引用。`
            : `window ${parent.id} 已 move 给 thread "${parent.sharing.borrowerThreadId}"，等其归还后才能执行命令。`;
        throw new Error(`openMethodExec: ${reason}`);
      }
    }

    const objectEntry = this.lookupMethodEntry(parent, opts.method);
    const windowEntry = objectEntry
      ? undefined
      : this.registry.lookupWindowMethod(parent, opts.method);
    if (!objectEntry && !windowEntry) {
      throw new Error(
        `openMethodExec: method "${opts.method}" not registered on window "${parent.class}" (id=${parent.id})`,
      );
    }
    const entry = (objectEntry ?? windowEntry) as ObjectMethod;

    const args = opts.args ?? {};

    // Fast path: method has no onFormChange → no form, exec directly.
    if (!entry.onFormChange) {
      const result = await this.execDirect(entry, parent, opts.thread, args, windowEntry);
      return { autoSubmitted: true, directResult: result };
    }

    // Form path: create a MethodExecWindow, run initial onFormChange, maybe auto-submit.
    const formId = generateWindowId("method_exec");

    const form: MethodExecWindow = {
      id: formId,
      class: "method_exec",
      parentWindowId: parentId,
      title: opts.title,
      status: "open",
      createdAt: Date.now(),
      method: opts.method,
      description: opts.description ?? entry.description ?? opts.title,
      accumulatedArgs: { ...args },
      intentPaths: [opts.method],
      loadedKnowledgePaths: [],
      methodKnowledgePaths: [],
    };
    this.windows.set(formId, form);
    this.recordKnowledgeRefs(form);
    this.persistence.persistWindow(opts.thread, form).catch((e) => console.warn(`[WindowManager] persist form failed: ${(e as Error).message}`));

    // schema/fill
    const methodResolved = this.registry.lookupMethodEntry(parent, opts.method);
    if (methodResolved?.entry.schema) {
      form.schema = methodResolved.entry.schema;
      form.fill = buildFillState(form.schema, form.accumulatedArgs);
    }

    // Initial onFormChange: status_changed to "open"
    const { quickExecSubmit } = this.applyFormChange(
      entry,
      { kind: "status_changed", from: "open", to: "open" },
      form,
      opts.thread,
    );

    if (quickExecSubmit) {
      const submitResult = await this.submit(formId, opts.thread);
      return { formId, autoSubmitted: true, submitResult };
    }

    return { formId, autoSubmitted: false };
  }

  /**
   * Direct exec path for methods without onFormChange. Builds the exec context and
   * invokes entry.exec, handling MethodOutcome / string / undefined returns.
   * Does NOT create a form window.
   *
   * windowEntry 非空时按 WindowMethod 语义执行：ctx 额外带 windowState，
   * 成功把返回的新 state 写回 parent window；失败直接 throw（无 form 可留痕，fail-loud）。
   */
  private async execDirect(
    entry: ObjectMethod,
    parent: ContextWindow,
    thread: ThreadContext,
    args: Record<string, unknown>,
    windowEntry?: import("../../../_shared/types/window-method.js").WindowMethod,
  ): Promise<string | undefined> {
    const ownerFlowObjectRef = this.registry.isBuiltinFeatureType(parent.class)
      ? undefined
      : runtimeObjectRef(thread, parent);
    const ownerThreadRef = threadPersistRef(thread);
    const ctx: MethodExecutionContext = {
      thread,
      self: parent,
      manager: this,
      args,
      ownerFlowObjectRef,
      ownerThreadRef,
      reportStateEdit: ownerFlowObjectRef
        ? () => this.reportStateEdit(ownerFlowObjectRef)
        : () => Promise.resolve(),
      reportContextEdit: ownerThreadRef
        ? () => this.reportContextEdit(thread)
        : () => Promise.resolve(),
    };
    if (windowEntry) {
      const windowState =
        (parent as { state?: import("../../../_shared/types/window-state.js").WindowDisplayState })
          .state ?? {};
      const outcome = await windowEntry.exec({ ...ctx, windowState });
      if (!outcome.ok) {
        throw new Error(outcome.error);
      }
      this.upsertWindow({ ...parent, state: outcome.state }, thread);
      return outcome.result;
    }
    let result: string | undefined;
    let isError = false;
    try {
      const raw = await entry.exec(ctx);
      if (raw && typeof raw === "object" && "ok" in raw) {
        if (raw.ok) {
          if (raw.window) {
            const win = raw.window as ContextWindow;
            this.insertTypedWindow(win, thread);
            result = `Constructed ${win.class} window ${win.id}`;
          } else {
            result = raw.result;
          }
        } else {
          result = raw.error ?? "method failed";
          isError = true;
        }
      } else {
        result = raw as string | undefined;
        if (typeof result === "string" && isLegacyErrorResult(result)) {
          isError = true;
        }
      }
    } catch (err) {
      result = `[method-error] ${(err as Error).message}`;
      isError = true;
    }
    if (isError) {
      throw new Error(result ?? "method failed");
    }
    return result;
  }

  /**
   * 创建非 form 的 typed window（talk_window / todo_window 等）。
   */
  insertTypedWindow(window: ContextWindow, thread?: ThreadContext): string {
    if (this.windows.has(window.id)) {
      throw new Error(`insertTypedWindow: window id "${window.id}" already exists`);
    }
    this.windows.set(window.id, window);
    this.recordKnowledgeRefs(window);
    if (thread) {
      this.persistence.persistWindow(thread, window).catch((e) => console.warn(`[WindowManager] persist window failed: ${(e as Error).message}`));
    }
    return window.id;
  }

  /**
   * 累积 method_exec form 的 args 并重算 tip/intents。
   *
   * 允许 status="open" 或 status="failed" 上调 refine。
   * If onFormChange returns quick_exec_submit after the refine, auto-submits (awaited;
   * caller reads back the form for the submit outcome — success 时 form 已移除，
   * failed 时 form.result 带错误)。
   */
  async refine(formId: string, args: Record<string, unknown>): Promise<boolean> {
    const form = this.windows.get(formId);
    if (!form || form.class !== "method_exec") return false;
    if (form.status !== "open" && form.status !== "failed") return false;
    const parent = this.requireParent(form.parentWindowId);
    const entry = this.lookupMethodEntry(parent, form.method);
    if (!entry) return false;
    if (!entry.onFormChange) return false;

    const prevArgs = { ...form.accumulatedArgs };
    const nextArgs = { ...form.accumulatedArgs, ...args };
    const { added, removed, changed } = diffArgs(prevArgs, nextArgs);
    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      return true;
    }

    const next: MethodExecWindow = {
      ...form,
      status: "open",
      result: undefined,
      accumulatedArgs: nextArgs,
    };

    if (form.schema) {
      next.fill = buildFillState(form.schema, nextArgs, form.fill);
      next.schema = form.schema;
    }

    this.windows.set(formId, next);

    const threadRef = this.getThread();
    if (threadRef) {
      const { quickExecSubmit } = this.applyFormChange(
        entry,
        { kind: "args_refined", added, removed, changed, args: nextArgs },
        next,
        threadRef,
      );

      // Unload stale derived windows bound to this form (e.g., knowledge windows from triggers)
      const cache: IntentCache | undefined = (threadRef as any).intentCache;
      const newIntents = cache?.get(form.id)?.intents ?? [];
      const newIntentNames = new Set(newIntents.map((i) => i.name));
      if (threadRef.contextWindows) {
        threadRef.contextWindows = threadRef.contextWindows.filter((w) => {
          if (w.boundFormId !== form.id) return true;
          if (w.provenance?.kind === "explicit") return true;
          const sourceIntent = w.provenance?.reason?.sourceId;
          if (!sourceIntent) return true;
          return newIntentNames.has(sourceIntent);
        });
        for (const [id, w] of this.windows) {
          if (w.boundFormId === form.id && !threadRef.contextWindows.find((tw) => tw.id === id)) {
            this.windows.delete(id);
          }
        }
      }

      if (quickExecSubmit) {
        // Auto-submit（awaited，失败响亮）：method 业务失败由 submit 落 failed form；
        // 协议级错误（form 丢失等）原样抛出。
        await this.submit(formId, threadRef);
      }
    }

    return true;
  }

  /**
   * 提交 method_exec form：跑 method.exec → 写 result。
   *
   * 状态过渡：open → executing → success | failed
   * 成功 (success) 时：自动从 contextWindows 移除
   * 失败 (failed) 时：保留 result 含错误；LLM 可 refine 修正后重 submit
   */
  async submit(formId: string, thread: ThreadContext): Promise<string | undefined> {
    const form = this.windows.get(formId);
    if (!form || form.class !== "method_exec") {
      throw new Error(`submit: form "${formId}" not found or not a method_exec window`);
    }
    if (form.status !== "open") {
      throw new Error(`submit: form "${formId}" status is ${form.status}, expected "open"`);
    }

    const parent = this.requireParent(form.parentWindowId);
    const resolved = this.registry.lookupMethodEntry(parent, form.method);
    const windowEntry = resolved
      ? undefined
      : this.registry.lookupWindowMethod(parent, form.method);
    if (!resolved && !windowEntry) {
      throw new Error(
        `submit: method "${form.method}" not registered on parent window type "${parent.class}"`,
      );
    }
    const entry = (resolved?.entry ?? windowEntry) as ObjectMethod;

    const executing: MethodExecWindow = { ...form, status: "executing" };
    this.windows.set(formId, executing);

    // Fire status_changed (open → executing)
    this.applyFormChange(
      entry,
      { kind: "status_changed", from: form.status, to: "executing" },
      executing,
      thread,
    );

    let result: string | undefined;
    let isError = false;
    try {
      const ownerFlowObjectRef = this.registry.isBuiltinFeatureType(parent.class)
        ? undefined
        : runtimeObjectRef(thread, parent);
      const ownerThreadRef = threadPersistRef(thread);
      const ctx: MethodExecutionContext = {
        thread,
        form: executing,
        self: parent,
        manager: this,
        args: form.accumulatedArgs,
        ownerFlowObjectRef,
        ownerThreadRef,
        reportStateEdit: ownerFlowObjectRef
          ? () => this.reportStateEdit(ownerFlowObjectRef)
          : () => Promise.resolve(),
        reportContextEdit: ownerThreadRef
          ? () => this.reportContextEdit(thread)
          : () => Promise.resolve(),
      };
      if (windowEntry) {
        const windowState =
          (parent as { state?: import("../../../_shared/types/window-state.js").WindowDisplayState })
            .state ?? {};
        const windowCtx: import("../../../_shared/types/window-method.js").WindowMethodExecutionContext =
          { ...ctx, windowState };
        const outcome = await windowEntry.exec(windowCtx);
        if (outcome.ok) {
          this.upsertWindow({ ...parent, state: outcome.state }, thread);
          result = outcome.result;
        } else {
          result = outcome.error;
          isError = true;
        }
      } else {
        const raw = await entry.exec(ctx);
        if (raw && typeof raw === "object" && "ok" in raw) {
          if (raw.ok) {
            if (raw.window) {
              // Constructor outcome: mount the returned window.
              const win = raw.window as ContextWindow;
              this.insertTypedWindow(win, thread);
              result = `Constructed ${win.class} window ${win.id}`;
            } else {
              result = raw.result;
            }
          } else {
            result = raw.error ?? "method failed";
            isError = true;
          }
        } else {
          result = raw as string | undefined;
          if (typeof result === "string" && isLegacyErrorResult(result)) {
            isError = true;
          }
        }
      }
    } catch (err) {
      result = `[method-error] ${(err as Error).message}`;
      isError = true;
    }

    if (!isError) {
      const successForm: MethodExecWindow = { ...executing, status: "success" };
      this.applyFormChange(
        entry,
        { kind: "status_changed", from: "executing", to: "success" },
        successForm,
        thread,
      );
      const cache: IntentCache | undefined = (thread as any).intentCache;
      cache?.delete(formId);

      this.removeWindow(formId, thread);
      return result;
    }

    const failed: MethodExecWindow = { ...executing, status: "failed", result };
    this.applyFormChange(
      entry,
      { kind: "status_changed", from: "executing", to: "failed" },
      failed,
      thread,
    );
    this.windows.set(formId, failed);
    return result;
  }

  /**
   * 关闭任意 window：触发 type 的 onClose hook，级联关闭所有 sub-window。
   */
  close(windowId: string, thread: ThreadContext): boolean {
    const window = this.windows.get(windowId);
    if (!window) return false;

    const def = this.registry.getObjectDefinition(window.class);
    if (def.onClose) {
      const allowed = def.onClose({ thread, window });
      if (allowed === false) return false;
    }

    const children = this.childrenOf(windowId);
    for (const child of children) {
      this.close(child.id, thread);
    }

    this.removeWindow(windowId, thread);
    return true;
  }

  /** 仅供 method 实现使用：把 form 的 result 字段写入并保留 failed 状态。 */
  setResultFailed(formId: string, result: string): void {
    const form = this.windows.get(formId);
    if (!form || form.class !== "method_exec") return;
    this.windows.set(formId, { ...form, status: "failed", result });
  }

  // ---- 内部 helper ----

  private requireParent(parentId: string): ContextWindow {
    if (parentId === ROOT_WINDOW_ID) {
      const rootInTable = this.windows.get(ROOT_WINDOW_ID);
      if (rootInTable) return rootInTable;
      return {
        id: ROOT_WINDOW_ID,
        class: "root",
        title: "root",
        status: "active",
        createdAt: 0,
      };
    }
    const parent = this.windows.get(parentId);
    if (!parent) {
      throw new Error(`requireParent: window "${parentId}" not found`);
    }
    return parent;
  }

  private recordKnowledgeRefs(window: ContextWindow): void {
    const paths = collectKnowledgePathsOf(window);
    for (const path of paths) {
      let set = this.knowledgeRefs.get(path);
      if (!set) {
        set = new Set();
        this.knowledgeRefs.set(path, set);
      }
      set.add(window.id);
    }
  }

  private releaseKnowledgeRefs(window: ContextWindow): void {
    const paths = collectKnowledgePathsOf(window);
    for (const path of paths) {
      const set = this.knowledgeRefs.get(path);
      if (!set) continue;
      set.delete(window.id);
      if (set.size === 0) this.knowledgeRefs.delete(path);
    }
  }

  private removeWindow(windowId: string, thread?: ThreadContext): void {
    const window = this.windows.get(windowId);
    if (!window) return;
    this.releaseKnowledgeRefs(window);
    this.windows.delete(windowId);
    if (thread) {
      this.persistence.unpersistWindow(thread, window).catch((e) => console.warn(`[WindowManager] delete-persist failed: ${(e as Error).message}`));
    }
  }

  removeWindowSilent(windowId: string): boolean {
    if (!this.windows.has(windowId)) return false;
    this.removeWindow(windowId);
    return true;
  }

  /** 公开版 insert/update：method 直接构造好 sharing 状态后写回 mgr。 */
  upsertWindow(window: ContextWindow, thread?: ThreadContext): void {
    this.windows.set(window.id, window);
    this.recordKnowledgeRefs(window);
    if (thread) {
      this.persistence.persistWindow(thread, window).catch((e) => console.warn(`[WindowManager] persist window failed: ${(e as Error).message}`));
    }
  }

  public reportStateEdit(ref: FlowObjectRef): Promise<void> {
    return this.persistence.reportStateEdit(ref);
  }

  public reportContextEdit(thread: ThreadContext): Promise<void> {
    return this.persistence.reportContextEdit(thread);
  }
}

function isLegacyErrorResult(result: string): boolean {
  return /^\[[\w_.-]+\]/.test(result.trimStart());
}

/** 把 window 关联的所有 knowledge path 抽出来，用于引用计数。 */
function collectKnowledgePathsOf(window: ContextWindow): string[] {
  if (window.class === "method_exec") {
    return [
      ...(window.methodKnowledgePaths ?? []),
      ...(window.loadedKnowledgePaths ?? []),
      ...(window.windowKnowledgePaths ?? []),
    ];
  }
  return window.windowKnowledgePaths ?? [];
}
