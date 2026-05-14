/**
 * ContextWindow 抽象 — 取代旧的 ActiveForm + thread.windows + pinnedKnowledge 三套并列概念。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 核心思想：
 * - 一个 thread 持有一组 ContextWindow（flat 数组，层级通过 parentWindowId 表达）
 * - 每个 window 都是"持续占 context 的实体"，对 LLM 而言行为一致：通过 5 原语 open / refine /
 *   submit / close / wait 与之交互
 * - 各 window type 通过 WindowRegistry（registry.ts）声明自身注册的 command、关闭副作用与渲染规则
 *
 * Step 1 实现的 window type（见 spec § 迁移节奏 Step 1）：
 * - root         — 每个 thread 隐含的根 window；注册全局 command（约等于今天 commands/ 目录）
 * - command_exec — 调用某 command 时的临时 sub-window，承载 args 累积与 knowledge 渐进激活
 *                  对应旧 ActiveForm 概念
 * - do           — fork 子线程后产生的对话窗口；transcript 是 inbox/outbox 在该子线程视角的视图
 * - todo         — 由 root.todo command 直建（C 规则总是命中），表示一条可见待办
 *
 * Step 2 才会引入：talk / program / file / knowledge — 当前不在 union 中，避免假装已实现。
 */

/** Window 类型枚举；新增类型必须同步在 WINDOW_REGISTRY 中注册。 */
export type WindowType = "root" | "command_exec" | "do" | "todo";

/**
 * Window 状态值汇总。
 *
 * - command_exec：open → executing → executed
 *   - 成功后系统自动从 contextWindows 移除（spec § submit 段）
 *   - 失败则保留 executed + result（错误信息），等 LLM 显式 close
 * - do：running → archived（被 close 时切到 archived，对应 B=ii archive 语义）
 * - todo：open → done（被 close 时切到 done）
 * - root：仅 active；与 thread 同生命周期，不能被关闭
 */
export type WindowStatus = "open" | "executing" | "executed" | "running" | "archived" | "done" | "active";

/**
 * 所有 ContextWindow 共享的字段。
 *
 * - id：全局唯一稳定 ID（root 固定为 "root"，其它类型用 generateWindowId）
 * - parentWindowId：command_exec 必有 parent；其它类型不显式挂 parent 时默认在 root 下
 * - title：所有 window 强制必填（spec § ContextWindow 抽象）
 * - windowKnowledgePaths：本 window 自身关联的 knowledge path（用于 close 时释放引用计数）
 */
export interface BaseContextWindow {
  id: string;
  type: WindowType;
  parentWindowId?: string;
  title: string;
  status: WindowStatus;
  createdAt: number;
  windowKnowledgePaths?: string[];
}

/**
 * Root window — 每个 thread 隐含一个，固定 id="root"，title=thread 自身的标题。
 *
 * 不可被 LLM 显式 open / close。注册的 command 集合 = 今天 src/executable/commands 目录全集。
 */
export interface RootWindow extends BaseContextWindow {
  type: "root";
  status: "active";
}

/**
 * Command exec form — 调用某 command 时的临时 sub-window。
 *
 * 替代旧 ActiveForm 概念；字段与 ActiveForm 一一对应：
 * - command          ← 旧 form.command
 * - description      ← 旧 form.description
 * - accumulatedArgs  ← 旧 form.accumulatedArgs
 * - commandPaths     ← 旧 form.commandPaths（match() 派生）
 * - loadedKnowledgePaths ← 旧 form.loadedKnowledgePaths
 * - status           ← 旧 form.status（open/executing/executed）
 * - result           ← 旧 form.result
 * - commandKnowledgePaths ← 旧 form.commandKnowledgePaths
 *
 * parentWindowId 是该 command 注册到的 window 的 id（root 命令时 = "root"；
 *    do_window 上的 continue 时 = 该 do_window 的 id）。
 */
export interface CommandExecWindow extends BaseContextWindow {
  type: "command_exec";
  parentWindowId: string;
  command: string;
  description: string;
  accumulatedArgs: Record<string, unknown>;
  commandPaths: string[];
  loadedKnowledgePaths: string[];
  commandKnowledgePaths?: string[];
  status: "open" | "executing" | "executed";
  result?: string;
}

/**
 * Do window — fork 子线程后在父线程下产生的对话窗口。
 *
 * - targetThreadId：fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
 * - 注册的 command（详见 windows/do.ts）：continue / wait / close
 * - close 语义（B=ii archive）：标记 child thread 为 archived 状态；对应 onClose hook
 * - 特殊子类：初始 creator do_window（id 派生自 thread.id，targetThreadId=creator），不可被 close
 */
export interface DoWindow extends BaseContextWindow {
  type: "do";
  targetThreadId: string;
  status: "running" | "archived";
  /** 标记为初始 creator do_window，不可被 LLM close（spec § 初始 creator 对话 window）。 */
  isCreatorWindow?: boolean;
}

/**
 * Todo window — 由 root.todo command 通过 C 规则直建。
 *
 * - content：待办正文（同时作为 title 来源；过长截断）
 * - onCommandPath：可选；命中这些 command path 时强提醒（替代旧 todo form 的 on_command_path）
 * - 没有 LLM 可调用的 command；只能被 close
 */
export interface TodoWindow extends BaseContextWindow {
  type: "todo";
  content: string;
  onCommandPath?: string[];
  status: "open" | "done";
}

/** 所有 ContextWindow 类型的 discriminated union。新增 type 后必须扩这里 + WINDOW_REGISTRY。 */
export type ContextWindow =
  | RootWindow
  | CommandExecWindow
  | DoWindow
  | TodoWindow;

/** Root window 的固定 id。 */
export const ROOT_WINDOW_ID = "root";

/** 生成 window id；前缀按类型区分，便于日志阅读。 */
export function generateWindowId(type: Exclude<WindowType, "root">): string {
  const prefix = ({
    command_exec: "f",
    do: "w_do",
    todo: "w_todo",
  } as const)[type];
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 派生稳定的 creator do_window id（spec § 初始 creator 对话 window）。 */
export function creatorWindowIdOf(threadId: string): string {
  return `w_creator_${threadId}`;
}

/** root thread 的 creator 约定值（spec § 初始 creator 对话 window，root thread 无父）。 */
export const SESSION_CREATOR_THREAD_ID = "__session__";
