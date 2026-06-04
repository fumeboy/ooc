/**
 * WindowManager — 替代旧 FormManager 的统一 ContextWindow 操作入口。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 职责：
 * - 持有 thread.contextWindows，封装所有增删改查
 * - 提供与 LLM 5 原语对齐的方法：
 *   - openCommandExec：在 parent window 下创建 method_exec sub-window；当 args 完整且不引入
 *     新协议知识时，会立刻提交 form（具体行为由各 command 自己控制）
 *   - openTypedWindow：创建非 form 的 window（do_window / todo_window 等）
 *   - refine：累积 method_exec 的 args 并重算 commandPaths
 *   - submit：执行 command；成功自动移除 form；失败保留 result
 *   - close：触发 type 的 onClose，级联关闭子 window
 * - 维护 knowledge path 引用计数（knowledgeRefCount），保证多 window 共享 path 时不被提前释放
 *
 * 不负责：
 * - command 自身的 exec 实现（由各 root/X.ts 与 windows/X.ts 中的 entry.exec 提供）
 * - knowledge entries 的具体内容（由 collectExecutableKnowledgeEntries 派生）
 * - 持久化（由 src/persistable/thread-json.ts 处理）
 *
 * 使用模式：
 *   const mgr = WindowManager.fromThread(thread);
 *   const formId = await mgr.openCommandExec(...);
 *   thread.contextWindows = mgr.toData();
 */

import type { ThreadContext } from "../../../thinkable/context.js";
import { hashArgs, diffArgs, type FormChangeEvent, type Intent, type IntentCache, type MethodCallSchema, type MethodArgSpec } from "../../../thinkable/context/intent.js";
import type { ObjectRegistry } from "./registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type MethodExecWindow,
  type ContextWindow,
  type ObjectType,
} from "./types.js";
import type { ObjectMethod } from "./command-types.js";
import {
  writeRuntimeObjectState,
  deleteRuntimeObject,
  readContextRegistry,
  writeContextRegistry,
  type ContextMember,
  type ContextRegistry,
  type ContextParams,
  writeThreadContext,
  type ThreadContextEntry,
  createFlowObject,
} from "../../../persistable/index.js";
import type { FlowObjectRef, ThreadPersistenceRef } from "../../../persistable/common.js";

/**
 * 用 entry.intent() 计算 commandPaths；空 args 时退化为 [command]。
 *
 * intent() 返回的是 sub-intents（不含方法名自身）；我们把方法名作为首元素再追加
 * sub-intent name，构成完整 commandPaths 列表。
 */
function computeMethodPaths(
  entry: ObjectMethod,
  command: string,
  args: Record<string, unknown>,
): string[] {
  let derived: string[];
  try {
    const subIntents = entry.intent(args);
    derived = [command, ...subIntents.map((i) => i.name)];
  } catch {
    derived = [command];
  }
  return derived.length > 0 ? derived : [command];
}

/**
 * 从 entry.onFormChange() 派生"knowledge path keys"。
 *
 * 旧设计：entry.knowledge(args, status) 返回 Record<string, string>，Object.keys() 即
 *   knowledge path 集合（用于 auto-submit guard 和 commandKnowledgePaths 引用计数）。
 * 新设计：entry.onFormChange() 返回 GuidanceWindow[]，其 title 即原 knowledge key。
 */
function deriveKnowledgeKeys(
  entry: ObjectMethod,
  form: MethodExecWindow,
  args: Record<string, unknown>,
): string[] {
  if (!entry.onFormChange) return [];
  const change: FormChangeEvent = {
    kind: "args_refined",
    added: Object.keys(args),
    removed: [],
    changed: [],
    args,
  };
  const defaultIntent: Intent = { name: form.command };
  const intents = [defaultIntent, ...entry.intent(args)];
  try {
    const windows = entry.onFormChange(change, { form, intents }) ?? [];
    return windows.map((w) => w.title);
  } catch {
    return [];
  }
}

/** 比较两个 string[] 集合是否相等（顺序无关）。 */
function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  for (const v of a) if (!setB.has(v)) return false;
  return true;
}

/** 判断 a 是否是 b 的子集（用于 openCommandExec 中的 auto-submit knowledge keys 判定）。 */
function setSubset(a: string[], b: string[]): boolean {
  const setB = new Set(b);
  for (const v of a) if (!setB.has(v)) return false;
  return true;
}

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
    for (const window of thread.contextWindows ?? []) {
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
    // Basic type check (loose — don't be too strict since accumulatedArgs comes from LLM JSON)
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
    // Validation rules
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

  // ── P5: status change dispatch helper ──

  /**
   * Fire onFormChange({ kind: "status_changed" }) and update intentCache status.
   * Called by submit() at each lifecycle transition.
   */
  private fireStatusChanged(
    fromForm: MethodExecWindow,
    toForm: MethodExecWindow,
    thread: ThreadContext,
    parent: ContextWindow,
    methodEntry: ObjectMethod,
  ): void {
    const cache: IntentCache | undefined = (thread as any).intentCache;
    let intents: Intent[] = [{ name: toForm.command }];
    if (cache) {
      const existing = cache.get(toForm.id);
      if (existing?.intents) intents = existing.intents;
      cache.set(toForm.id, {
        argsHash: existing?.argsHash ?? hashArgs(toForm.accumulatedArgs),
        status: toForm.status,
        intents,
      });
    }
    if (methodEntry.onFormChange) {
      const guidance = methodEntry.onFormChange(
        { kind: "status_changed", from: fromForm.status, to: toForm.status },
        { form: toForm, intents },
      );
      if (guidance && guidance.length > 0 && thread.contextWindows) {
        thread.contextWindows.push(...guidance);
        for (const gw of guidance) {
          this.windows.set(gw.id, gw);
        }
      }
    }
  }

  // ── End P5 helpers ──

  // ── End P4 helpers ──

  /**
   * 在 parent_window_id 下打开一个 method_exec sub-window。
   *
   * - parent_window_id 缺省 = ROOT_WINDOW_ID
   * - 如 args 非空，立刻 apply 一次 refine（累积到 form 上）
   * - 当 args 非空、commandPaths / knowledge keys 都未引入新内容时，open 立刻提交 form
   *   （即"args 给齐 + 不引入新协议知识"⇒一步执行；具体由各 command 的 match/knowledge 控制）
   *
   * 返回 { formId, autoSubmitted, submitResult }
   * - autoSubmitted=true 表示 open 已经直接提交 form；submitResult 是 command.exec 的返回值
   *
   * 注意：本方法不直接 mutate thread；调用方负责 thread.contextWindows = mgr.toData()
   */
  async openMethodExec(opts: {
    thread: ThreadContext;
    parentWindowId?: string;
    command: string;
    title: string;
    description?: string;
    args?: Record<string, unknown>;
  }): Promise<{ formId: string; autoSubmitted: boolean; submitResult?: string }> {
    const parentId = opts.parentWindowId ?? ROOT_WINDOW_ID;
    const parent = this.requireParent(parentId);

    // sharing 守门（plan §do_window.move）：
    // - ref：只允许 close（释放本地 ref 引用）
    // - lent_out：所有命令拒绝（含 close），等归还后才能操作
    if (parent.sharing) {
      const isCloseOnRef = parent.sharing.kind === "ref" && opts.command === "close";
      if (!isCloseOnRef) {
        const reason =
          parent.sharing.kind === "ref"
            ? `window ${parent.id} 是只读 ref（owner 在 thread "${parent.sharing.ownerThreadId}"），不允许执行命令 "${opts.command}"。仅可 close 释放本地 ref 引用。`
            : `window ${parent.id} 已借出给 thread "${parent.sharing.borrowerThreadId}"，等其归还后才能执行命令。`;
        throw new Error(`openMethodExec: ${reason}`);
      }
    }

    const entry = this.lookupMethodEntry(parent, opts.command);
    if (!entry) {
      throw new Error(
        `openMethodExec: command "${opts.command}" not registered on window "${parent.type}" (id=${parent.id})`,
      );
    }

    const formId = generateWindowId("method_exec");
    const baselineArgs: Record<string, unknown> = {};
    const baselinePaths = computeMethodPaths(entry, opts.command, baselineArgs);

    const args = opts.args ?? {};
    const methodPaths = computeMethodPaths(entry, opts.command, args);

    // Stub form for deriveKnowledgeKeys (only needs id/command/accumulatedArgs)
    const stubForm = {
      id: formId,
      command: opts.command,
      accumulatedArgs: args,
      status: "open",
    } as MethodExecWindow;
    const baselineStubForm = {
      ...stubForm,
      accumulatedArgs: baselineArgs,
    } as MethodExecWindow;

    const baselineKnowledgeKeys = deriveKnowledgeKeys(entry, baselineStubForm, baselineArgs);

    const form: MethodExecWindow = {
      id: formId,
      type: "method_exec",
      parentWindowId: parentId,
      title: opts.title,
      status: "open",
      createdAt: Date.now(),
      command: opts.command,
      description: opts.description ?? opts.title,
      accumulatedArgs: { ...args },
      commandPaths: methodPaths,
      loadedKnowledgePaths: [],
      commandKnowledgePaths: deriveKnowledgeKeys(entry, stubForm, args),
    };
    this.windows.set(formId, form);
    this.recordKnowledgeRefs(form);
    // 2026-05-28 ooc-6 Phase 5: 双写到 context/ 目录
    this.writeContextObjectForWindow(opts.thread, form).catch(() => {});

    // ── P4 schema/fill + P5 intentCache write ──
    const methodResolved = this.registry.lookupMethodEntry(parent, opts.command);
    if (methodResolved?.entry.schema) {
      form.schema = methodResolved.entry.schema;
      form.fill = this.buildFillState(form.schema, form.accumulatedArgs);
    }
    // Write initial intent cache entry
    {
      const cache: IntentCache = ((opts.thread as any).intentCache ??= new Map());
      const defaultIntent: Intent = { name: opts.command };
      const extraIntents = methodResolved?.entry.intent(form.accumulatedArgs) ?? [];
      const intents = [defaultIntent, ...extraIntents];
      cache.set(formId, {
        argsHash: hashArgs(form.accumulatedArgs),
        status: form.status,
        intents,
      });
    }
    // ── End P4/P5 write ──

    // auto-submit 判定：
    // - args 非空（无 args 等价于 LLM 想观察 form 状态再决定，不应直接提交）—— 但
    //   parent 是 method_exec 时除外（refine/submit 是 atomic 命令，无需观察）
    // - next commandPaths ⊇ baseline（新 path 由 LLM 显式给出，不算"surprise"）
    // - next knowledge keys ⊆ baseline（command 自己不引入新协议知识，LLM 已知所有规则）
    const isMetaForm = parent.type === "method_exec";
    if (Object.keys(args).length > 0 || isMetaForm) {
      const nextKnowledgeKeys = deriveKnowledgeKeys(entry, form as any, args);
      if (
        setSubset(baselinePaths, methodPaths) &&
        setSubset(nextKnowledgeKeys, baselineKnowledgeKeys)
      ) {
        const submitResult = await this.submit(formId, opts.thread);
        return { formId, autoSubmitted: true, submitResult };
      }
    }

    return { formId, autoSubmitted: false };
  }

  /**
   * 创建非 form 的 typed window（do_window / todo_window 等）。
   *
   * 用于 command.exec 的副作用：
   * - root.do submit → insertTypedWindow(doWindow, thread) 产出 do_window
   * - root.todo submit → insertTypedWindow(todoWindow, thread)
   * - 也用于 thread init 注入 creator do_window（parentWindowId 仍为 root）
   *
   * thread 参数可选：提供时会异步写入 context/ 目录（2026-05-28 ooc-6 Phase 5）。
   *
   * 返回新 window 的 id；调用方按需在 init 里追加 type 特有字段。
   */
  insertTypedWindow(window: ContextWindow, thread?: ThreadContext): string {
    if (this.windows.has(window.id)) {
      throw new Error(`insertTypedWindow: window id "${window.id}" already exists`);
    }
    this.windows.set(window.id, window);
    this.recordKnowledgeRefs(window);
    // 2026-05-28 ooc-6 Phase 5: 双写到 context/ 目录
    if (thread) {
      this.writeContextObjectForWindow(thread, window).catch(() => {});
    }
    return window.id;
  }

  /**
   * 累积 method_exec form 的 args 并重算 commandPaths。
   *
   * Round 13: 允许 status="open" 或 status="failed" 上调 refine。
   * - open: 累积 args, 状态保持 open（原行为）
   * - failed: 累积 args + 清旧 result + 状态切回 open（"复活"路径，新增）
   *
   * executing / success / 其它状态返回 false（success 已被自动移除, 理论不会触发）。
   *
   * P4/P5: also recomputes fill_state, updates intentCache, dispatches onFormChange,
   * and unloads stale derived windows bound to this form.
   */
  refine(formId: string, args: Record<string, unknown>): boolean {
    const form = this.windows.get(formId);
    if (!form || form.type !== "method_exec") return false;
    if (form.status !== "open" && form.status !== "failed") return false;
    const parent = this.requireParent(form.parentWindowId);
    const entry = this.lookupMethodEntry(parent, form.command);
    if (!entry) return false;

    // Diff args first — no actual change means no cache invalidation
    const prevArgs = { ...form.accumulatedArgs };
    const nextArgs = { ...form.accumulatedArgs, ...args };
    const { added, removed, changed } = diffArgs(prevArgs, nextArgs);
    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      return true;
    }

    const nextPaths = computeMethodPaths(entry, form.command, nextArgs);
    // failed → open 复活: 清 result, 把 status 切回 "open"。
    // open → open: 仅累积 args / 重算 paths。
    const next: MethodExecWindow = {
      ...form,
      status: "open",
      result: undefined,
      accumulatedArgs: nextArgs,
      commandPaths: nextPaths,
    };

    // ── P4: recompute fill_state ──
    if (form.schema) {
      next.fill = this.buildFillState(form.schema, nextArgs, form.fill);
      next.schema = form.schema;
    }

    this.windows.set(formId, next);

    // ── P5: intentCache update + onFormChange dispatch ──
    const threadRef = this.getThread();
    const methodResolved = this.registry.lookupMethodEntry(parent, form.command);
    if (methodResolved && threadRef) {
      const cache: IntentCache = ((threadRef as any).intentCache ??= new Map());
      const oldEntry = cache.get(form.id);
      const newArgsHash = hashArgs(nextArgs);
      const defaultIntent: Intent = { name: form.command };
      const newIntents = [defaultIntent, ...methodResolved.entry.intent(nextArgs)];
      const intentsChanged =
        JSON.stringify(oldEntry?.intents ?? []) !== JSON.stringify(newIntents);

      // Fire onFormChange
      const guidanceWindows: ContextWindow[] = [];
      if (methodResolved.entry.onFormChange) {
        guidanceWindows.push(
          ...(methodResolved.entry.onFormChange(
            { kind: "args_refined", added, removed, changed, args: nextArgs },
            { form: next, intents: newIntents },
          ) ?? []),
        );
        if (intentsChanged) {
          guidanceWindows.push(
            ...(methodResolved.entry.onFormChange(
              { kind: "intent_changed", from: oldEntry?.intents ?? [], to: newIntents },
              { form: next, intents: newIntents },
            ) ?? []),
          );
        }
      }

      // Unload stale derived windows bound to this form
      const oldIntentNames = new Set((oldEntry?.intents ?? []).map((i) => i.name));
      const newIntentNames = new Set(newIntents.map((i) => i.name));
      if (threadRef.contextWindows) {
        threadRef.contextWindows = threadRef.contextWindows.filter((w) => {
          if (w.boundFormId !== form.id) return true;
          if (w.provenance?.kind === "explicit") return true;
          const sourceIntent = w.provenance?.reason?.sourceId;
          if (!sourceIntent) return true;
          return newIntentNames.has(sourceIntent);
        });
        // Sync manager windows from thread
        for (const [id, w] of this.windows) {
          if (w.boundFormId === form.id && !threadRef.contextWindows.find((tw) => tw.id === id)) {
            this.windows.delete(id);
          }
        }
        // Add new guidance windows
        if (guidanceWindows.length > 0) {
          threadRef.contextWindows.push(...guidanceWindows);
          for (const gw of guidanceWindows) {
            this.windows.set(gw.id, gw);
          }
        }
      }

      cache.set(form.id, {
        argsHash: newArgsHash,
        status: next.status,
        intents: newIntents,
      });
    }
    // ── End P5 ──

    return true;
  }

  /**
   * 提交 method_exec form：跑 command.exec → 写 result。
   *
   * 状态过渡：open → executing → success | failed (Round 13 升级；旧 "executed" 已废弃)
   * 成功 (success) 时：自动从 contextWindows 移除（spec § submit 段）
   * 失败 (failed) 时：保留 result 含错误；LLM 可 refine 修正后重 submit（首选）, 或 close 放弃。
   *
   * 失败判定：command.exec 抛异常 → 失败；result 字符串以 "[command-error]" / "[error]" /
   *           "缺少" / "失败" 开头时也视为失败（与旧 form-status 协议保持一致）。
   *
   * 返回 result 字符串（可能 undefined，例如 plan/end 等无 result 的 command）。
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
    const resolved = this.registry.lookupMethodEntry(parent, form.command);
    if (!resolved) {
      throw new Error(
        `submit: command "${form.command}" not registered on parent window type "${parent.type}"`,
      );
    }
    // P6.§3 + §7 (2026-06-02): 校验由 lookupMethodEntry 完成——它沿 parentClass 链
    // 向上找方法；找到则 declaringType 是命中类（可能是 parent.type 自己或祖先）。
    // 找不到（resolved === undefined）就在上面已经 fail-loud 抛错。这里不再做
    // declaringType !== parent.type 的严格相等校验，否则会反过来阻断 §7 设计的
    // 继承调用（如 supervisor 借 root 拿 talk/do/...）。
    const entry = resolved.entry;

    const executing: MethodExecWindow = { ...form, status: "executing" };
    this.windows.set(formId, executing);

    // P5: fire status_changed (open → executing) + update intentCache
    this.fireStatusChanged(form, executing, thread, parent, entry);

    let result: string | undefined;
    let isError = false;
    try {
      // P6.§8 (2026-06-02): compute helper refs so method bodies can fire-and-forget flush.
      // ownerFlowObjectRef is undefined for builtin features (no own state.json);
      // ownerThreadRef tracks the thread + object pair for thread-context.json writes.
      const ownerFlowObjectRef = this.registry.isBuiltinFeatureType(parent.type)
        ? undefined
        : this.runtimeObjectRefForWindow(thread, parent);
      const ownerThreadRef = this.threadPersistRefFromThread(thread);
      const ctx: import("./command-types.js").MethodExecutionContext = {
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
      const raw = await entry.exec(ctx);
      // 四种返回形态：MethodOutcome (constructor / regular / failed) / string / undefined
      // - outcome.ok=true && "object" in: P6 (ooc-6) constructor —— mount 新 ContextObject，
      //   走与 insertTypedWindow 相同的 in-memory + persistence 路径
      // - outcome.ok=true && "result" in: regular method 成功 + 可选 result 文本
      // - outcome.ok=false: 失败
      // - undefined：成功无 result
      // - string：兼容旧约定——以 [<name>]/[command-error]/[error] 为前缀视为错误
      if (raw && typeof raw === "object" && "ok" in raw) {
        if (raw.ok) {
          if ("object" in raw) {
            // Constructor outcome：把构造出的 ContextObject 挂到 manager 与 thread 上。
            // 走 insertTypedWindow 相同路径以保证 in-memory map + thread.contextWindows
            // + 持久化（writeContextObjectForWindow）三处一致。
            this.insertTypedWindow(raw.object, thread);
            result = `Constructed ${raw.object.type} window ${raw.object.id}`;
          } else {
            result = raw.result;
          }
        } else {
          result = raw.error;
          isError = true;
        }
      } else {
        result = raw;
        if (typeof result === "string" && isLegacyErrorResult(result)) {
          isError = true;
        }
      }
    } catch (err) {
      result = `[command-error] ${(err as Error).message}`;
      isError = true;
    }

    if (!isError) {
      // 成功：自动从 contextWindows 移除（spec § submit）
      // P5: fire status_changed (executing → success) + update intentCache
      const successForm: MethodExecWindow = { ...executing, status: "success" };
      this.fireStatusChanged(executing, successForm, thread, parent, entry);
      // Also remove the intentCache entry since form is gone
      const cache: IntentCache | undefined = (thread as any).intentCache;
      cache?.delete(formId);

      this.removeWindow(formId, thread);
      return result;
    }

    // 失败：保留 failed + result；LLM 可 refine 修正后重 submit（首选）, 或 close 放弃
    const failed: MethodExecWindow = { ...executing, status: "failed", result };
    // P5: fire status_changed (executing → failed) + update intentCache
    this.fireStatusChanged(executing, failed, thread, parent, entry);
    this.windows.set(formId, failed);
    return result;
  }

  /**
   * 关闭任意 window：触发 type 的 onClose hook，级联关闭所有 sub-window。
   *
   * 流程：
   * 1. lookup window；不存在返回 false
   * 2. 调用 type.onClose；返回 false 表示拒绝（如 creator do_window）→ 不删
   * 3. 递归关闭所有 parentWindowId === window.id 的子 window
   * 4. 从 windows 表移除并释放 knowledge 引用
   */
  close(windowId: string, thread: ThreadContext): boolean {
    const window = this.windows.get(windowId);
    if (!window) return false;

    const def = this.registry.getObjectDefinition(window.type);
    if (def.onClose) {
      const allowed = def.onClose({ thread, window });
      if (allowed === false) return false;
    }

    // 级联关闭子 window（先快照避免迭代时修改）
    const children = this.childrenOf(windowId);
    for (const child of children) {
      this.close(child.id, thread);
    }

    this.removeWindow(windowId, thread);
    return true;
  }

  /** 仅供 command 实现使用：把 form 的 result 字段写入并保留 failed 状态（成功时不调用——会自动移除）。 */
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
    // P6.§6 (2026-06-02): persistObjectAfterChange 是新的统一入口，按 isBuiltinFeature 分两条路径写盘。
    // writeContextObjectForWindow 保留为薄 wrapper：兼容外部 caller，下个 release 删。
    return this.persistObjectAfterChange(thread, window);
  }

  /**
   * P6.§6 (2026-06-02) — 统一持久化入口：根据 window.type 是否「Object 内置特性」分两路落盘。
   *
   * 内置特性 (isBuiltinFeature=true) — talk / do / todo / method_exec：
   *   - 不写 `flows/<sid>/<id>/` 目录、不写 .flow.json、不写 state.json
   *   - 完整 inline 写到所属 thread 的 `<oid>/threads/<tid>/context.json`
   *
   * 独立 flow object (isBuiltinFeature=false) — plan / program / file / ... / 各 stone runtime：
   *   - 写 `<wid>/.flow.json` + `<wid>/state.json`（state.json 已剥离 contextWindows）
   *   - 在所属 thread 的 `<oid>/threads/<tid>/context.json` 里以 ref 形态出现：
   *     `{ id, type, _ref: true, refObjectId }`
   *   - 同时维护旧的 contextRegistry（向后兼容；§6 暂保留双写路径）
   *
   * 不变量：state（object 维度）和 context（thread 维度）严格分文件。
   * state.json 只装 object 自身字段；contextWindows 一律落 context.json。
   */
  private async persistObjectAfterChange(thread: ThreadContext, window: ContextWindow): Promise<void> {
    if (window.id === ROOT_WINDOW_ID) return;
    const tref = this.threadPersistRefFromThread(thread);
    if (!tref) return;

    if (this.registry.isBuiltinFeatureType(window.type)) {
      // 路径 A：内置特性 —— 仅刷 thread context.json（含本 window 的 inline 状态）。
      await this.writeThreadContextSnapshot(thread).catch((e) => {
        console.warn(`[WindowManager] writeThreadContext failed for ${window.id}: ${(e as Error).message}`);
      });
      return;
    }

    // 路径 B：独立 flow object —— 写自己 dir 的 .flow.json + state.json，并把 ref 入 thread context.json。
    const ref = this.runtimeObjectRefForWindow(thread, window);
    if (!ref) return;
    try {
      // .flow.json：标记目录是 flow object 实例。
      // P6.§7 (2026-06-02): 写入 `class: window.type`，绑定方法继承链的载体；class 必须是已注册
      // ObjectType（registerObjectType 入口都已注册），未注册时 createFlowObject 会抛 ClassNotFoundError。
      await createFlowObject(ref, { class: window.type });
    } catch (e) {
      console.warn(`[WindowManager] createFlowObject failed for ${window.id}: ${(e as Error).message}`);
    }
    try {
      // state.json：object 自身字段（writeRuntimeObjectState 内部已 strip contextWindows）。
      await writeRuntimeObjectState(ref, window);
    } catch (e) {
      console.warn(`[WindowManager] writeRuntimeObjectState failed for ${window.id}: ${(e as Error).message}`);
      return;
    }
    // 旧 contextRegistry 双写（向后兼容；§6 暂留，后续可移除）。
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

    // thread context.json：增量后整段重写（含本 window 的 ref 项 + 其他 window 的 inline / ref）。
    await this.writeThreadContextSnapshot(thread).catch((e) => {
      console.warn(`[WindowManager] writeThreadContext failed for ${window.id}: ${(e as Error).message}`);
    });
  }

  /**
   * P6.§6: 把 manager 内存里属于该 thread 的 contextWindows 状态，序列化成
   * ThreadContextEntry[] 写到 `<oid>/threads/<tid>/context.json`。
   *
   * 序列化规则：
   *  - root window 跳过（不属于任何 thread 的可见 contextWindows）
   *  - isBuiltinFeature=true → 完整 inline（state 即 context）
   *  - isBuiltinFeature=false → ref 项 `{ id, type, _ref: true, refObjectId: window.id }`
   *
   * 注：当前 manager 的 windows 表是 thread-local 的（每个 manager 由
   * `WindowManager.fromThread(thread)` 构造），因此 `this.windows` 全量即为该 thread
   * 的 contextWindows 集合，无需额外按 thread 过滤。
   */
  private async writeThreadContextSnapshot(thread: ThreadContext): Promise<void> {
    const tref = this.threadPersistRefFromThread(thread);
    if (!tref) return;
    const entries: ThreadContextEntry[] = [];
    for (const window of this.windows.values()) {
      if (window.id === ROOT_WINDOW_ID) continue;
      if (this.registry.isBuiltinFeatureType(window.type)) {
        entries.push(window);
      } else {
        entries.push({
          id: window.id,
          type: window.type,
          _ref: true,
          refObjectId: window.id,
        });
      }
    }
    await writeThreadContext(tref, entries);
  }

  private async deleteContextObjectForWindow(thread: ThreadContext, window: ContextWindow): Promise<void> {
    const ref = this.persistRefFromThread(thread);
    if (!ref) return;
    if (window.id === ROOT_WINDOW_ID) return;
    // P6.§6: 内置特性没有独立 dir，删除时只需刷 thread context.json（已剥离该 entry）。
    if (this.registry.isBuiltinFeatureType(window.type)) {
      await this.writeThreadContextSnapshot(thread).catch((e) => {
        console.warn(
          `[WindowManager] writeThreadContext failed during delete for ${window.id}: ${(e as Error).message}`,
        );
      });
      return;
    }
    // 独立 flow object：从 registry 摘除 + rm -rf 扁平目录 + 刷 thread context.json（不再含本 ref）。
    await this.removeFromRuntimeAndRegistryForWindow(thread, window);
    await this.writeThreadContextSnapshot(thread).catch((e) => {
      console.warn(
        `[WindowManager] writeThreadContext failed during delete for ${window.id}: ${(e as Error).message}`,
      );
    });
  }

  /**
   * threadPersistRefFromThread — 从 thread.persistence 派生 ThreadPersistenceRef。
   *
   * thread.persistence 已经是 ThreadPersistenceRef 形态（含 threadId），但此处显式
   * 复制确保引用稳定（避免外部 mutate）。
   */
  private threadPersistRefFromThread(thread: ThreadContext): ThreadPersistenceRef | undefined {
    if (!thread.persistence) return undefined;
    return {
      baseDir: thread.persistence.baseDir,
      sessionId: thread.persistence.sessionId,
      objectId: thread.persistence.objectId,
      threadId: thread.persistence.threadId,
    };
  }

  /**
   * 计算 runtime object 的 FlowObjectRef —— window.id 直接做 objectId（扁平布局）。
   *
   * 与 thread.persistence.objectId 不同：那是 thread 所属的 object（parent owner），
   * 这里返回的是 window 自身作为独立 runtime object 的 ref。
   */
  private runtimeObjectRefForWindow(thread: ThreadContext, window: ContextWindow): FlowObjectRef | undefined {
    if (!thread.persistence) return undefined;
    return {
      baseDir: thread.persistence.baseDir,
      sessionId: thread.persistence.sessionId,
      objectId: window.id,
    };
  }

  /**
   * P5'.1 删：从 thread registry 摘除成员；
   * 若该 object 不再被本 session 内任意 thread 引用，则 rm -rf 扁平 object 目录。
   *
   * **当前简化**：跨 thread 引用计数尚未实装；本函数无条件 rm -rf 扁平 object 目录。
   * 一个 object 同时被多个 thread context 引用的场景出现后再补上 ref-count 扫描。
   */
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
    // 扁平目录的物理删除（P5'.3 起：嵌套 context/ 路径已下线，扁平目录是唯一持久化路径）。
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
      // root window 可能未显式 insert（root 是隐含 window）；提供一个虚拟 root view
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
    // 2026-05-28 ooc-6 Phase 5: 从 context/ 目录删除
    if (thread) {
      this.deleteContextObjectForWindow(thread, window).catch(() => {});
    }
  }

  /**
   * 公开版 removeWindow —— 不触发 onClose hook，仅释放 mgr 持有的状态。
   *
   * 适用于 do_window.move 等场景：command 自己已处理副作用，需要 mgr 同步移除 window。
   * 与 close() 的区别：close() 走 onClose hook + 级联子 window；本方法仅 raw remove。
   */
  removeWindowSilent(windowId: string): boolean {
    if (!this.windows.has(windowId)) return false;
    this.removeWindow(windowId);
    return true;
  }

  /** 公开版 insert/update：command 直接构造好 sharing 状态后写回 mgr。 */
  upsertWindow(window: ContextWindow, thread?: ThreadContext): void {
    this.windows.set(window.id, window);
    this.recordKnowledgeRefs(window);
    // 2026-05-28 ooc-6 Phase 5: 双写到 context/ 目录
    if (thread) {
      this.writeContextObjectForWindow(thread, window).catch(() => {});
    }
  }

  /**
   * P6.§8 (2026-06-02): Reports that the **object's self-fields** changed; flushes state.json.
   *
   * Used by method bodies that mutate an independent flow object's own fields and want to
   * persist the change without waiting for the next submit/upsert cycle. State is the
   * **object dimension** (cross-thread shared) — no thread parameter needed.
   *
   * No-op for builtin features (talk / do / todo / method_exec): they live entirely in the
   * thread's `thread-context.json` and have no own `state.json`. Callers operating on a
   * builtin feature should use `reportContextEdit` instead.
   *
   * Concurrency: writes go through the same per-(session, objectId) serial queue as
   * `writeRuntimeObjectState`, so concurrent reports for the same object are serialized.
   */
  public reportStateEdit(ref: FlowObjectRef): Promise<void> {
    const window = this.windows.get(ref.objectId);
    if (!window) return Promise.resolve();
    if (this.registry.isBuiltinFeatureType(window.type)) return Promise.resolve();
    return writeRuntimeObjectState(ref, window);
  }

  /**
   * P6.§8 (2026-06-02): Reports that the **thread's contextWindows** changed (builtin
   * feature inline state OR independent object refs); flushes thread-context.json.
   *
   * Used by method bodies that mutate the thread's view of contextWindows — e.g.
   * `method_exec.refine` accumulating args, `talk_window.say` appending a transcript entry,
   * or any inserted/removed independent flow object ref. Context is the **thread dimension**
   * (per-thread, contains inline builtin features + refs to independent objects).
   *
   * Takes the full ThreadContext rather than just a ref so we can reuse the in-memory
   * `this.windows` snapshot (same source of truth used by `writeThreadContextSnapshot`).
   */
  public reportContextEdit(thread: ThreadContext): Promise<void> {
    return this.writeThreadContextSnapshot(thread);
  }
}

/**
 * 兼容判定：旧 command exec 用 string 返回失败信息，统一约定以 \`[<name>]\` 前缀开头。
 *
 * 凡 trim 后以 \`[\w_.]+\]\` 开头的字符串都视为失败：
 * - \`[command-error] ...\`            — manager catch 转抛异常时拼出的固定前缀
 * - \`[error] ...\`                    — 旧实现有几个地方手写了
 * - \`[<command 名>] ...\`             — root command / window-level command 失败约定
 * - \`[<window>.<command>] ...\`        — 比如 [do_window.continue] / [talk_window.say]
 *
 * 新代码应改用 MethodOutcome（显式 ok 标志），避免依赖此启发式。
 */
function isLegacyErrorResult(result: string): boolean {
  return /^\[[\w_.-]+\]/.test(result.trimStart());
}

/** 把 window 关联的所有 knowledge path 抽出来，用于引用计数。 */
function collectKnowledgePathsOf(window: ContextWindow): string[] {
  if (window.type === "method_exec") {
    return [
      ...(window.commandKnowledgePaths ?? []),
      ...(window.loadedKnowledgePaths ?? []),
      ...(window.windowKnowledgePaths ?? []),
    ];
  }
  return window.windowKnowledgePaths ?? [];
}

/**
 * 从 ContextWindow 抽 thread-level 视角参数（compressLevel / decayMeta / parentObjectId）。
 *
 * 这些字段在 P5'.4 之后会从 ContextWindow 物理迁出（仅留在 registry.params）；
 * 当前 P5'.1 dual-write 期，源仍然在 window 上，本函数只做单向投影。
 *
 * order 不在这里设置 —— 由 caller 决定（新增成员=members.length；已存在=保留旧值）。
 */
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

/** 合并 caller 给的新 params 到 cur 上（同字段覆盖；保留 cur.order）。 */
function mergeContextParams(cur: ContextParams, next: ContextParams): ContextParams {
  return {
    compressLevel: next.compressLevel ?? cur.compressLevel,
    decayMeta: next.decayMeta !== undefined ? next.decayMeta : cur.decayMeta,
    order: cur.order,
    parentObjectId: next.parentObjectId ?? cur.parentObjectId,
  };
}

/** 浅比较两个 ContextParams（短路 IO）。 */
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
