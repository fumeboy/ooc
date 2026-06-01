/**
 * WindowManager — 替代旧 FormManager 的统一 ContextWindow 操作入口。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 职责：
 * - 持有 thread.contextWindows，封装所有增删改查
 * - 提供与 LLM 5 原语对齐的方法：
 *   - openCommandExec：在 parent window 下创建 command_exec sub-window；当 args 完整且不引入
 *     新协议知识时，会立刻提交 form（具体行为由各 command 自己控制）
 *   - openTypedWindow：创建非 form 的 window（do_window / todo_window 等）
 *   - refine：累积 command_exec 的 args 并重算 commandPaths
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
import { getWindowTypeDefinition } from "./registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type CommandExecWindow,
  type ContextWindow,
  type WindowType,
} from "./types.js";
import type { CommandTableEntry } from "./command-types.js";
import { writeContextObject, deleteContextObject } from "../../../persistable/flow-context.js";
import {
  writeRuntimeObjectState,
  deleteRuntimeObject,
  readContextRegistry,
  writeContextRegistry,
  type ContextMember,
  type ContextRegistry,
  type ContextParams,
} from "../../../persistable/index.js";
import type { FlowObjectRef, ThreadPersistenceRef } from "../../../persistable/common.js";

/**
 * 用 entry.match() 直接计算 commandPaths；空 args 派生不出来时退化为 [command]。
 *
 * Step 2 重构后这个 helper 接收 entry 而不是 command 名 —— 修复了 Step 1 的 bug：
 * 之前 deriveCommandPaths 只查 ROOT_COMMANDS 表，导致 do_window/talk_window 等
 * 非 root 窗口上的 command（如 say.wait / continue.wait）无法被识别。
 */
function computeCommandPaths(
  entry: CommandTableEntry,
  command: string,
  args: Record<string, unknown>,
): string[] {
  let derived: string[];
  try {
    derived = entry.match(args);
  } catch {
    derived = [command];
  }
  return derived.length > 0 ? derived : [command];
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
 * 从 parent command（root 上挂的 command）查找它注册到的 CommandTableEntry。
 *
 * parent_window_id 决定查哪个 window 的 commands：
 * - "root" → root 注册到 WINDOW_REGISTRY 的 commands（来自 windows/root/index.ts）
 * - 其他 → 该 window 的 type definition.commands
 */
function lookupCommandEntry(
  parentWindow: ContextWindow,
  command: string,
): CommandTableEntry | undefined {
  const def = getWindowTypeDefinition(parentWindow.type);
  return def.commands[command];
}

export class WindowManager {
  private windows: Map<string, ContextWindow> = new Map();
  /** knowledge path → 当前持有它的 window id 集合；用于引用计数。 */
  private knowledgeRefs: Map<string, Set<string>> = new Map();

  /** 从 thread.contextWindows 装载状态。 */
  static fromThread(thread: ThreadContext): WindowManager {
    const mgr = new WindowManager();
    for (const window of thread.contextWindows ?? []) {
      mgr.windows.set(window.id, window);
      mgr.recordKnowledgeRefs(window);
    }
    return mgr;
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

  /**
   * 在 parent_window_id 下打开一个 command_exec sub-window。
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
  async openCommandExec(opts: {
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
        throw new Error(`openCommandExec: ${reason}`);
      }
    }

    const entry = lookupCommandEntry(parent, opts.command);
    if (!entry) {
      throw new Error(
        `openCommandExec: command "${opts.command}" not registered on window "${parent.type}" (id=${parent.id})`,
      );
    }

    const formId = generateWindowId("command_exec");
    const baselineArgs: Record<string, unknown> = {};
    const baselinePaths = computeCommandPaths(entry, opts.command, baselineArgs);
    const baselineKnowledgeKeys = entry.knowledge
      ? Object.keys(entry.knowledge(baselineArgs, "open"))
      : [];

    const args = opts.args ?? {};
    const commandPaths = computeCommandPaths(entry, opts.command, args);

    const form: CommandExecWindow = {
      id: formId,
      type: "command_exec",
      parentWindowId: parentId,
      title: opts.title,
      status: "open",
      createdAt: Date.now(),
      command: opts.command,
      description: opts.description ?? opts.title,
      accumulatedArgs: { ...args },
      commandPaths,
      loadedKnowledgePaths: [],
      commandKnowledgePaths: entry.knowledge
        ? Object.keys(entry.knowledge(args, "open"))
        : [],
    };
    this.windows.set(formId, form);
    this.recordKnowledgeRefs(form);
    // 2026-05-28 ooc-6 Phase 5: 双写到 context/ 目录
    this.writeContextObjectForWindow(opts.thread, form).catch(() => {});

    // auto-submit 判定：
    // - args 非空（无 args 等价于 LLM 想观察 form 状态再决定，不应直接提交）—— 但
    //   parent 是 command_exec 时除外（refine/submit 是 atomic 命令，无需观察）
    // - next commandPaths ⊇ baseline（新 path 由 LLM 显式给出，不算"surprise"）
    // - next knowledge keys ⊆ baseline（command 自己不引入新协议知识，LLM 已知所有规则）
    const isMetaForm = parent.type === "command_exec";
    if (Object.keys(args).length > 0 || isMetaForm) {
      const nextKnowledgeKeys = entry.knowledge
        ? Object.keys(entry.knowledge(args, "open"))
        : [];
      if (
        setSubset(baselinePaths, commandPaths) &&
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
   * 累积 command_exec form 的 args 并重算 commandPaths。
   *
   * Round 13: 允许 status="open" 或 status="failed" 上调 refine。
   * - open: 累积 args, 状态保持 open（原行为）
   * - failed: 累积 args + 清旧 result + 状态切回 open（"复活"路径，新增）
   *
   * executing / success / 其它状态返回 false（success 已被自动移除, 理论不会触发）。
   */
  refine(formId: string, args: Record<string, unknown>): boolean {
    const form = this.windows.get(formId);
    if (!form || form.type !== "command_exec") return false;
    if (form.status !== "open" && form.status !== "failed") return false;
    const parent = this.requireParent(form.parentWindowId);
    const entry = lookupCommandEntry(parent, form.command);
    if (!entry) return false;
    const nextArgs = { ...form.accumulatedArgs, ...args };
    const nextPaths = computeCommandPaths(entry, form.command, nextArgs);
    // failed → open 复活: 清 result, 把 status 切回 "open"。
    // open → open: 仅累积 args / 重算 paths。
    const next: CommandExecWindow = {
      ...form,
      status: "open",
      result: undefined,
      accumulatedArgs: nextArgs,
      commandPaths: nextPaths,
    };
    this.windows.set(formId, next);
    return true;
  }

  /**
   * 提交 command_exec form：跑 command.exec → 写 result。
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
    if (!form || form.type !== "command_exec") {
      throw new Error(`submit: form "${formId}" not found or not a command_exec window`);
    }
    if (form.status !== "open") {
      throw new Error(`submit: form "${formId}" status is ${form.status}, expected "open"`);
    }

    const parent = this.requireParent(form.parentWindowId);
    const entry = lookupCommandEntry(parent, form.command);
    if (!entry) {
      throw new Error(
        `submit: command "${form.command}" not registered on parent window type "${parent.type}"`,
      );
    }

    const executing: CommandExecWindow = { ...form, status: "executing" };
    this.windows.set(formId, executing);

    let result: string | undefined;
    let isError = false;
    try {
      const ctx: import("./command-types.js").CommandExecutionContext = {
        thread,
        form: executing,
        parentWindow: parent,
        manager: this,
        args: form.accumulatedArgs,
      };
      const raw = await entry.exec(ctx);
      // 三种返回形态：CommandExecOutcome / string / undefined
      // - outcome：显式 ok 标志，最权威
      // - undefined：成功无 result
      // - string：兼容旧约定——以 [<name>]/[command-error]/[error] 为前缀视为错误
      if (raw && typeof raw === "object" && "ok" in raw) {
        if (raw.ok) {
          result = raw.result;
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
      this.removeWindow(formId, thread);
      return result;
    }

    // 失败：保留 failed + result；LLM 可 refine 修正后重 submit（首选）, 或 close 放弃
    const failed: CommandExecWindow = { ...executing, status: "failed", result };
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

    const def = getWindowTypeDefinition(window.type);
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
    if (!form || form.type !== "command_exec") return;
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
    const ref = this.persistRefFromThread(thread);
    if (!ref) return;
    // 跳过 root window（root 是隐含的，不属于任何 object 的 context）
    if (window.id === ROOT_WINDOW_ID) return;
    try {
      await writeContextObject(ref, ref.objectId, window);
    } catch (e) {
      console.warn(`[WindowManager] writeContextObject failed for ${window.id}: ${(e as Error).message}`);
    }
    // ooc-6 P5'.1：在保留嵌套写的同时，并行写"扁平 runtime object" + 更新
    // thread context registry。读路径切换（P5'.2）后，嵌套写就可以下线。
    await this.writeRuntimeAndRegistryForWindow(thread, window);
  }

  private async deleteContextObjectForWindow(thread: ThreadContext, window: ContextWindow): Promise<void> {
    const ref = this.persistRefFromThread(thread);
    if (!ref) return;
    if (window.id === ROOT_WINDOW_ID) return;
    try {
      await deleteContextObject(ref, ref.objectId, window.id);
    } catch (e) {
      console.warn(`[WindowManager] deleteContextObject failed for ${window.id}: ${(e as Error).message}`);
    }
    // ooc-6 P5'.1：从 thread registry 摘除该 member；按引用计数决定是否删扁平 object 目录。
    await this.removeFromRuntimeAndRegistryForWindow(thread, window);
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
   * P5'.1 写：扁平 runtime object state.json + thread context.json registry upsert。
   *
   * 新增成员 → push 到 registry.members 末尾（order = 当前长度）。
   * 已存在成员 → 不重排，保留 params；若 view 字段需要刷新，应走 dedicated API。
   */
  private async writeRuntimeAndRegistryForWindow(thread: ThreadContext, window: ContextWindow): Promise<void> {
    const ref = this.runtimeObjectRefForWindow(thread, window);
    const tref = this.threadPersistRefFromThread(thread);
    if (!ref || !tref) return;
    if (window.id === ROOT_WINDOW_ID) return;
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
        // 已存在：仅在 params 真正变化时才更新写盘（fast-path 短路减少 IO）
        const merged: ContextParams = mergeContextParams(cur.params, params);
        if (paramsEqual(cur.params, merged)) return;
        const members = reg.members.slice();
        members[idx] = { objectId: cur.objectId, params: merged };
        next = { version: 1, members };
      } else {
        const member: ContextMember = {
          objectId: window.id,
          params: { ...params, order: reg.members.length },
        };
        next = { version: 1, members: [...reg.members, member] };
      }
      await writeContextRegistry(tref, next);
    } catch (e) {
      console.warn(`[WindowManager] update registry failed for ${window.id}: ${(e as Error).message}`);
    }
  }

  /**
   * P5'.1 删：从 thread registry 摘除成员；
   * 若该 object 不再被本 session 内任意 thread 引用，则 rm -rf 扁平 object 目录。
   *
   * **当前简化**：跨 thread 引用计数实现留给 P5'.2/.3 阶段（届时读路径切到 registry）。
   * 此处 P5'.1 dual-write 期内只移除当前 thread 的 member，不做物理删除——避免
   * 在迁移过渡期把还被嵌套布局依赖的目录提前清掉。物理删除沿用嵌套 deleteContextObject
   * 的语义。
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
    // 扁平目录的物理删除：dual-write 期内只删与本 thread 同 owner 的目录，
    // 由 deleteRuntimeObject 处理（与嵌套 deleteContextObject 同时调用，互不相干）。
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
 * 新代码应改用 CommandExecOutcome（显式 ok 标志），避免依赖此启发式。
 */
function isLegacyErrorResult(result: string): boolean {
  return /^\[[\w_.-]+\]/.test(result.trimStart());
}

/** 把 window 关联的所有 knowledge path 抽出来，用于引用计数。 */
function collectKnowledgePathsOf(window: ContextWindow): string[] {
  if (window.type === "command_exec") {
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
    _decayMeta?: { lastTouchedAt: number; idleRounds: number } | null;
    parentWindowId?: string;
  };
  const params: ContextParams = {};
  if (typeof w.compressLevel === "number") params.compressLevel = w.compressLevel;
  if (w._decayMeta !== undefined) params.decayMeta = w._decayMeta ?? null;
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
