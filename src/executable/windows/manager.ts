/**
 * WindowManager — 替代旧 FormManager 的统一 ContextWindow 操作入口。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 职责：
 * - 持有 thread.contextWindows，封装所有增删改查
 * - 提供与 LLM 5 原语对齐的方法：
 *   - openCommandExec：在 parent window 下创建 command_exec sub-window；处理 C 规则自动 submit
 *   - openTypedWindow：创建非 form 的 window（do_window / todo_window 等）
 *   - refine：累积 command_exec 的 args 并重算 commandPaths
 *   - submit：执行 command；成功自动移除 form；失败保留 result
 *   - close：触发 type 的 onClose，级联关闭子 window
 * - 维护 knowledge path 引用计数（knowledgeRefCount），保证多 window 共享 path 时不被提前释放
 *
 * 不负责：
 * - command 自身的 exec 实现（由 src/executable/commands/index.ts:executeCommand 处理）
 * - knowledge entries 的具体内容（由 collectExecutableKnowledgeEntries 派生）
 * - 持久化（由 src/persistable/thread-json.ts 处理）
 *
 * 使用模式：
 *   const mgr = WindowManager.fromThread(thread);
 *   const formId = await mgr.openCommandExec(...);
 *   thread.contextWindows = mgr.toData();
 */

import type { ThreadContext } from "../../thinkable/context.js";
import { deriveCommandPaths, executeCommand } from "../commands/index.js";
import { getWindowTypeDefinition } from "./registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type CommandExecWindow,
  type ContextWindow,
  type WindowType,
} from "./types.js";

/** 为 command_exec form 计算 commandPaths；空 args 派生不出来时退化为 [command]。 */
function computeCommandPaths(command: string, args: Record<string, unknown>): string[] {
  const derived = deriveCommandPaths(command, args);
  return derived.length > 0 ? derived : [command];
}

/** 比较两个 string[] 集合是否相等（顺序无关）。 */
function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  for (const v of a) if (!setB.has(v)) return false;
  return true;
}

/**
 * 从 parent command（root 上挂的 command）查找它注册到的 CommandTableEntry。
 *
 * parent_window_id 决定查哪个 window 的 commands：
 * - "root" → COMMAND_TABLE
 * - 其他 → 该 window 的 type definition.commands
 */
function lookupCommandEntry(
  parentWindow: ContextWindow,
  command: string,
): import("../commands/types.js").CommandTableEntry | undefined {
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
   * - C 规则：args 非空且 baseline-vs-next 的 commandPaths / knowledge-keys 全等 → 自动 submit
   *
   * 返回 { formId, autoSubmitted, submitResult }
   * - autoSubmitted=true 表示 C 规则触发；submitResult 是 command.exec 的返回值
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
    const baselinePaths = computeCommandPaths(opts.command, baselineArgs);
    const baselineKnowledgeKeys = entry.knowledge
      ? Object.keys(entry.knowledge(baselineArgs, "open"))
      : [];

    const args = opts.args ?? {};
    const commandPaths = computeCommandPaths(opts.command, args);

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

    // C 规则判定（spec § C 规则的判定算法）：仅当 args 非空 + paths 集合不变 + knowledge keys 不变
    if (Object.keys(args).length > 0) {
      const nextKnowledgeKeys = entry.knowledge
        ? Object.keys(entry.knowledge(args, "open"))
        : [];
      if (
        setEqual(baselinePaths, commandPaths) &&
        setEqual(baselineKnowledgeKeys, nextKnowledgeKeys)
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
    const nextArgs = { ...form.accumulatedArgs, ...args };
    const nextPaths = computeCommandPaths(form.command, nextArgs);
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

    const executing: CommandExecWindow = { ...form, status: "executing" };
    this.windows.set(formId, executing);

    let result: string | undefined;
    let isError = false;
    try {
      result = await executeCommand(form.command, {
        thread,
        form: undefined, // 旧 form 类型已废弃；commands 不应再依赖它（do/todo 改造后通过 ctx 拿 args）
        args: form.accumulatedArgs,
      });
    } catch (err) {
      result = `[command-error] ${(err as Error).message}`;
      isError = true;
    }
    if (typeof result === "string" && isErrorResult(result)) {
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
 * 判定 command 返回的 result 字符串是否表达失败。
 *
 * 与 ActiveForm 时代的 form-status knowledge 提示保持兼容：
 * 凡是 command 返回的、用作"please refine 提示"的字符串，都视为失败结果保留。
 */
function isErrorResult(result: string): boolean {
  const head = result.slice(0, 64);
  return (
    head.startsWith("[command-error]") ||
    head.startsWith("[error]") ||
    head.startsWith("[program") || // [program.shell] 缺少 / [program] 未知 language
    head.includes("缺少") ||
    head.includes("失败") ||
    /^\[\w+]\s*未知/.test(head)
  );
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
