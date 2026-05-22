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
   * - root.do submit → openTypedWindow("do", ...) 产出 do_window
   * - root.todo submit → openTypedWindow("todo", ...)
   * - 也用于 thread init 注入 creator do_window（parentWindowId 仍为 root）
   *
   * 返回新 window 的 id；调用方按需在 init 里追加 type 特有字段。
   */
  insertTypedWindow(window: ContextWindow): string {
    if (this.windows.has(window.id)) {
      throw new Error(`insertTypedWindow: window id "${window.id}" already exists`);
    }
    this.windows.set(window.id, window);
    this.recordKnowledgeRefs(window);
    return window.id;
  }

  /**
   * 累积 command_exec form 的 args 并重算 commandPaths。
   *
   * 仅 status="open" 的 command_exec 可被 refine。
   * 返回 false 表示 form 不存在或不在 open 状态。
   */
  refine(formId: string, args: Record<string, unknown>): boolean {
    const form = this.windows.get(formId);
    if (!form || form.type !== "command_exec" || form.status !== "open") {
      return false;
    }
    const parent = this.requireParent(form.parentWindowId);
    const entry = lookupCommandEntry(parent, form.command);
    if (!entry) return false;
    const nextArgs = { ...form.accumulatedArgs, ...args };
    const nextPaths = computeCommandPaths(entry, form.command, nextArgs);
    const next: CommandExecWindow = {
      ...form,
      accumulatedArgs: nextArgs,
      commandPaths: nextPaths,
    };
    this.windows.set(formId, next);
    return true;
  }

  /**
   * 提交 command_exec form：跑 command.exec → 写 result。
   *
   * 状态过渡：open → executing → executed
   * 成功时：自动从 contextWindows 移除（spec § submit 段）
   * 失败时：保留 executed 状态 + result 含错误，等 LLM 显式 close
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
      this.removeWindow(formId);
      return result;
    }

    // 失败：保留 executed + result，等 LLM 显式 close
    const failed: CommandExecWindow = { ...executing, status: "executed", result };
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

    this.removeWindow(windowId);
    return true;
  }

  /** 仅供 command 实现使用：把 form 的 result 字段写入并保留 executed 状态（成功时不调用——会自动移除）。 */
  markExecuted(formId: string, result: string): void {
    const form = this.windows.get(formId);
    if (!form || form.type !== "command_exec") return;
    this.windows.set(formId, { ...form, status: "executed", result });
  }

  // ---- 内部 helper ----

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

  private removeWindow(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) return;
    this.releaseKnowledgeRefs(window);
    this.windows.delete(windowId);
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
