/**
 * WindowManager — 替代旧 FormManager 的统一 ContextWindow 操作入口。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 职责：
 * - 持有 thread.contextWindows，封装所有增删改查
 * - 提供与 LLM 5 原语对齐的方法：
 *   - openMethodExec：在 parent window 下创建 method_exec sub-window；当 onFormChange 返回
 *     quick_exec_submit 时会立刻提交 form；若方法未声明 onFormChange 则直接 exec 不创建 form
 *   - openTypedWindow：创建非 form 的 window（do_window / todo_window 等）
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
import { hashArgs, diffArgs, type FormChangeEvent, type Intent, type IntentCache, type MethodCallSchema, type MethodArgSpec } from "../../../thinkable/context/intent.js";
import type { ObjectRegistry } from "./registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  isNonPersistedWindow,
  type MethodExecWindow,
  type ContextWindow,
} from "./types.js";
import type { ObjectMethod, MethodExecutionContext } from "./method-types.js";
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
import type { FlowObjectRef, ThreadPersistenceRef } from "../../../persistable/common.js";

/**
 * 从 parent 上查找它注册到的 ObjectMethod。
 *
 * parent_window_id 决定查哪个 window 的 methods：
 * - "root" → root 注册到 object registry 的 methods（来自 windows/root/index.ts）
 * - 其他 → 该 window 的 type definition.methods
 *
 * 2026-05-28 ooc-6 Object Unification：现在通过 registry.lookupMethod 公共 API 检索。
 * 2026-06-04 Phase E：改为 WindowManager 私有方法，使用实例持有的 registry。
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

  private constructor(registry: ObjectRegistry) {
    this.registry = registry;
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

  // ── P4 schema + fill_state helpers ──

  /**
   * Build fill_state for a form given its schema and accumulated args.
   * Fail-soft: validation errors are marked in fill_state but don't block refine.
   */
  private buildFillState(
    schema: MethodCallSchema | undefined,
    args: Record<string, unknown>,
    existingFill?: MethodExecWindow["fill"],
  ): MethodExecWindow["fill"] | undefined {
    if (!schema) return undefined;
    const fill: NonNullable<MethodExecWindow["fill"]> = {};
    for (const [argName, spec] of Object.entries(schema.args)) {
      const hasValue = argName in args && args[argName] !== undefined && args[argName] !== null && args[argName] !== "";
      const prev = existingFill?.[argName];
      if (!hasValue) {
        // Missing — but check default
        if (spec.default !== undefined) {
          fill[argName] = {
            status: "provided",
            value: spec.default,
            source: "default",
            refinedAt: prev?.refinedAt ?? Date.now(),
          };
        } else {
          fill[argName] = {
            status: "missing",
            source: prev?.source ?? "initial",
            refinedAt: prev?.refinedAt,
          };
        }
        continue;
      }
      // Has value — validate
      const value = args[argName];
      const error = this.validateArgValue(spec, value);
      if (error) {
        fill[argName] = {
          status: "invalid",
          value,
          error,
          source: prev?.source === "initial" ? "refine" : prev?.source ?? "refine",
          refinedAt: Date.now(),
        };
      } else {
        fill[argName] = {
          status: "provided",
          value,
          source: prev?.source === "initial" ? "refine" : prev?.source ?? "refine",
          refinedAt: prev?.refinedAt ?? Date.now(),
        };
      }
    }
    return fill;
  }

  private validateArgValue(spec: MethodArgSpec, value: unknown): string | undefined {
    if (spec.enum && !spec.enum.includes(value as any)) {
      return spec.validation?.customMessage ?? `值必须是: ${spec.enum.join(", ")}`;
    }
    if (spec.type === "string" && typeof value !== "string") {
      return spec.validation?.customMessage ?? "需要字符串类型";
    }
    if (spec.type === "number" && typeof value !== "number") {
      return spec.validation?.customMessage ?? "需要数字类型";
    }
    if (spec.type === "boolean" && typeof value !== "boolean") {
      return spec.validation?.customMessage ?? "需要布尔类型";
    }
    if (spec.type === "array" && !Array.isArray(value)) {
      return spec.validation?.customMessage ?? "需要数组类型";
    }
    if (spec.type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
      return spec.validation?.customMessage ?? "需要对象类型";
    }
    const v = spec.validation;
    if (v && typeof value === "string") {
      if (v.minLength !== undefined && value.length < v.minLength) {
        return v.customMessage ?? `至少 ${v.minLength} 个字符`;
      }
      if (v.maxLength !== undefined && value.length > v.maxLength) {
        return v.customMessage ?? `最多 ${v.maxLength} 个字符`;
      }
      if (v.pattern) {
        try {
          if (!new RegExp(v.pattern).test(value)) {
            return v.customMessage ?? `格式不匹配: ${v.pattern}`;
          }
        } catch {
          // Invalid regex — skip
        }
      }
    }
    if (v && typeof value === "number") {
      if (v.minimum !== undefined && value < v.minimum) {
        return v.customMessage ?? `不能小于 ${v.minimum}`;
      }
      if (v.maximum !== undefined && value > v.maximum) {
        return v.customMessage ?? `不能大于 ${v.maximum}`;
      }
    }
    return undefined;
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
    // Start with previous intents (if any) so status_changed/intent_changed events
    // carry the current intents to onFormChange.
    const cache: IntentCache | undefined = (thread as any).intentCache;
    const prevIntents = cache?.get(form.id)?.intents ?? [defaultIntent];

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
      result = entry.onFormChange(change, { form, intents: prevIntents });
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

    // sharing 守门（plan §do_window.move）：
    if (parent.sharing) {
      const isCloseOnRef = parent.sharing.kind === "ref" && opts.method === "close";
      if (!isCloseOnRef) {
        const reason =
          parent.sharing.kind === "ref"
            ? `window ${parent.id} 是只读 ref（owner 在 thread "${parent.sharing.ownerThreadId}"），不允许执行命令 "${opts.method}"。仅可 close 释放本地 ref 引用。`
            : `window ${parent.id} 已借出给 thread "${parent.sharing.borrowerThreadId}"，等其归还后才能执行命令。`;
        throw new Error(`openMethodExec: ${reason}`);
      }
    }

    const objectEntry = this.lookupMethodEntry(parent, opts.method);
    const windowEntry = objectEntry
      ? undefined
      : this.registry.lookupWindowMethod(parent, opts.method);
    if (!objectEntry && !windowEntry) {
      throw new Error(
        `openMethodExec: method "${opts.method}" not registered on window "${parent.type}" (id=${parent.id})`,
      );
    }
    const entry = (objectEntry ?? windowEntry) as ObjectMethod;

    const args = opts.args ?? {};

    // Fast path: method has no onFormChange → no form, exec directly.
    if (!entry.onFormChange) {
      const result = await this.execDirect(entry, parent, opts.thread, args);
      return { autoSubmitted: true, directResult: result };
    }

    // Form path: create a MethodExecWindow, run initial onFormChange, maybe auto-submit.
    const formId = generateWindowId("method_exec");

    const form: MethodExecWindow = {
      id: formId,
      type: "method_exec",
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
    this.writeContextObjectForWindow(opts.thread, form).catch(() => {});

    // schema/fill
    const methodResolved = this.registry.lookupMethodEntry(parent, opts.method);
    if (methodResolved?.entry.schema) {
      form.schema = methodResolved.entry.schema;
      form.fill = this.buildFillState(form.schema, form.accumulatedArgs);
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
   */
  private async execDirect(
    entry: ObjectMethod,
    parent: ContextWindow,
    thread: ThreadContext,
    args: Record<string, unknown>,
  ): Promise<string | undefined> {
    const ownerFlowObjectRef = this.registry.isBuiltinFeatureType(parent.type)
      ? undefined
      : this.runtimeObjectRefForWindow(thread, parent);
    const ownerThreadRef = this.threadPersistRefFromThread(thread);
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
    let result: string | undefined;
    let isError = false;
    try {
      const raw = await entry.exec(ctx);
      if (raw && typeof raw === "object" && "ok" in raw) {
        if (raw.ok) {
          if ("window" in raw && raw.window) {
            const win = raw.window as ContextWindow;
            this.insertTypedWindow(win, thread);
            result = `Constructed ${win.type} window ${win.id}`;
          } else {
            result = (raw as { ok: true; result?: string }).result;
          }
        } else {
          result = (raw as { ok: false; error: string }).error;
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
   * 创建非 form 的 typed window（do_window / todo_window 等）。
   */
  insertTypedWindow(window: ContextWindow, thread?: ThreadContext): string {
    if (this.windows.has(window.id)) {
      throw new Error(`insertTypedWindow: window id "${window.id}" already exists`);
    }
    this.windows.set(window.id, window);
    this.recordKnowledgeRefs(window);
    if (thread) {
      this.writeContextObjectForWindow(thread, window).catch(() => {});
    }
    return window.id;
  }

  /**
   * 累积 method_exec form 的 args 并重算 tip/intents。
   *
   * Round 13: 允许 status="open" 或 status="failed" 上调 refine。
   * If onFormChange returns quick_exec_submit after the refine, auto-submits.
   */
  refine(formId: string, args: Record<string, unknown>): boolean {
    const form = this.windows.get(formId);
    if (!form || form.type !== "method_exec") return false;
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
      next.fill = this.buildFillState(form.schema, nextArgs, form.fill);
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
        // Auto-submit: fire and forget (async), caller reads back result from form.
        this.submit(formId, threadRef).catch(() => {});
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
    if (!form || form.type !== "method_exec") {
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
        `submit: method "${form.method}" not registered on parent window type "${parent.type}"`,
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
      const ownerFlowObjectRef = this.registry.isBuiltinFeatureType(parent.type)
        ? undefined
        : this.runtimeObjectRefForWindow(thread, parent);
      const ownerThreadRef = this.threadPersistRefFromThread(thread);
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
            if ("window" in raw && raw.window) {
              // Constructor outcome: mount the returned window.
              const win = raw.window as ContextWindow;
              this.insertTypedWindow(win, thread);
              result = `Constructed ${win.type} window ${win.id}`;
            } else {
              result = (raw as { ok: true; result?: string }).result;
            }
          } else {
            result = (raw as { ok: false; error: string }).error;
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

    const def = this.registry.getObjectDefinition(window.type);
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
    if (!form || form.type !== "method_exec") return;
    this.windows.set(formId, { ...form, status: "failed", result });
  }

  // ---- 内部 helper ----

  private persistRefFromThread(thread: ThreadContext): import("../../../persistable/common.js").FlowObjectRef | undefined {
    if (!thread.persistence) return undefined;
    return {
      baseDir: thread.persistence.baseDir,
      sessionId: thread.persistence.sessionId,
      objectId: thread.persistence.objectId,
    };
  }

  private async writeContextObjectForWindow(thread: ThreadContext, window: ContextWindow): Promise<void> {
    return this.persistObjectAfterChange(thread, window);
  }

  private async persistObjectAfterChange(thread: ThreadContext, window: ContextWindow): Promise<void> {
    if (window.id === ROOT_WINDOW_ID) return;
    if (isNonPersistedWindow(window)) return;
    const tref = this.threadPersistRefFromThread(thread);
    if (!tref) return;

    if (this.registry.isBuiltinFeatureType(window.type)) {
      await this.writeThreadContextSnapshot(thread).catch((e) => {
        console.warn(`[WindowManager] writeThreadContext failed for ${window.id}: ${(e as Error).message}`);
      });
      return;
    }

    const ref = this.runtimeObjectRefForWindow(thread, window);
    if (!ref) return;
    try {
      await createFlowObject(ref, { class: window.type });
    } catch (e) {
      console.warn(`[WindowManager] createFlowObject failed for ${window.id}: ${(e as Error).message}`);
    }
    try {
      await writeRuntimeObjectState(ref, window);
    } catch (e) {
      console.warn(`[WindowManager] writeRuntimeObjectState failed for ${window.id}: ${(e as Error).message}`);
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
      console.warn(`[WindowManager] update registry failed for ${window.id}: ${(e as Error).message}`);
    }

    await this.writeThreadContextSnapshot(thread).catch((e) => {
      console.warn(`[WindowManager] writeThreadContext failed for ${window.id}: ${(e as Error).message}`);
    });
  }

  private async writeThreadContextSnapshot(thread: ThreadContext): Promise<void> {
    const tref = this.threadPersistRefFromThread(thread);
    if (!tref) return;
    const entries = buildThreadContextEntries(this.windows.values(), this.registry);
    await writeThreadContext(tref, entries);
  }

  private async deleteContextObjectForWindow(thread: ThreadContext, window: ContextWindow): Promise<void> {
    const ref = this.persistRefFromThread(thread);
    if (!ref) return;
    if (window.id === ROOT_WINDOW_ID) return;
    if (this.registry.isBuiltinFeatureType(window.type)) {
      await this.writeThreadContextSnapshot(thread).catch((e) => {
        console.warn(
          `[WindowManager] writeThreadContext failed during delete for ${window.id}: ${(e as Error).message}`,
        );
      });
      return;
    }
    await this.removeFromRuntimeAndRegistryForWindow(thread, window);
    await this.writeThreadContextSnapshot(thread).catch((e) => {
      console.warn(
        `[WindowManager] writeThreadContext failed during delete for ${window.id}: ${(e as Error).message}`,
      );
    });
  }

  private threadPersistRefFromThread(thread: ThreadContext): ThreadPersistenceRef | undefined {
    if (!thread.persistence) return undefined;
    return {
      baseDir: thread.persistence.baseDir,
      sessionId: thread.persistence.sessionId,
      objectId: thread.persistence.objectId,
      threadId: thread.persistence.threadId,
    };
  }

  private runtimeObjectRefForWindow(thread: ThreadContext, window: ContextWindow): FlowObjectRef | undefined {
    if (!thread.persistence) return undefined;
    return {
      baseDir: thread.persistence.baseDir,
      sessionId: thread.persistence.sessionId,
      objectId: window.id,
    };
  }

  private async removeFromRuntimeAndRegistryForWindow(thread: ThreadContext, window: ContextWindow): Promise<void> {
    const tref = this.threadPersistRefFromThread(thread);
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
      console.warn(`[WindowManager] remove from registry failed for ${window.id}: ${(e as Error).message}`);
    }
    const ref = this.runtimeObjectRefForWindow(thread, window);
    if (!ref) return;
    try {
      await deleteRuntimeObject(ref);
    } catch (e) {
      console.warn(`[WindowManager] deleteRuntimeObject failed for ${window.id}: ${(e as Error).message}`);
    }
  }

  private requireParent(parentId: string): ContextWindow {
    if (parentId === ROOT_WINDOW_ID) {
      const rootInTable = this.windows.get(ROOT_WINDOW_ID);
      if (rootInTable) return rootInTable;
      return {
        id: ROOT_WINDOW_ID,
        type: "root",
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
      this.deleteContextObjectForWindow(thread, window).catch(() => {});
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
      this.writeContextObjectForWindow(thread, window).catch(() => {});
    }
  }

  public reportStateEdit(ref: FlowObjectRef): Promise<void> {
    const window = this.windows.get(ref.objectId);
    if (!window) return Promise.resolve();
    if (this.registry.isBuiltinFeatureType(window.type)) return Promise.resolve();
    return writeRuntimeObjectState(ref, window);
  }

  public reportContextEdit(thread: ThreadContext): Promise<void> {
    return this.writeThreadContextSnapshot(thread);
  }
}

function isLegacyErrorResult(result: string): boolean {
  return /^\[[\w_.-]+\]/.test(result.trimStart());
}

/** 把 window 关联的所有 knowledge path 抽出来，用于引用计数。 */
function collectKnowledgePathsOf(window: ContextWindow): string[] {
  if (window.type === "method_exec") {
    return [
      ...(window.methodKnowledgePaths ?? []),
      ...(window.loadedKnowledgePaths ?? []),
      ...(window.windowKnowledgePaths ?? []),
    ];
  }
  return window.windowKnowledgePaths ?? [];
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
