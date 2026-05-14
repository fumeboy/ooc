import type { ThreadContext } from "../../thinkable/context";
import type { CommandExecWindow, ContextWindow } from "../windows/types";
import type { WindowManager } from "../windows/manager";

/** 命令表条目（扁平结构，无嵌套子节点）。 */
export type CommandKnowledgeEntries = Record<string, string>;

export interface CommandTableEntry {
  /** 该 command 可能产出的所有 path 集合（用于反向索引建表 + 文档目录） */
  paths: string[];
  /**
   * 给定 args，返回此次激活的 path 子集（必含 command 自身名）。多条路径并行。
   *
   * 规则：
   * - 总是包含 bare command 名（如 "talk"）
   * - 各维度（wait、context、type 等）独立决定是否追加对应 path
   * - match 抛异常时退化为只返回 bare path
   */
  match: (args: Record<string, unknown>) => string[];
  /** 基于当前参数与 form 生命周期状态派生命令知识。 */
  knowledge?: (
    args: Record<string, unknown>,
    formStatus: CommandExecWindow["status"]
  ) => CommandKnowledgeEntries;
  /**
   * 执行该 command 的入口；优先于 root level 的 executeCommand by-name 派发。
   *
   * 当 entry.exec 存在时，WindowManager.submit 会直接调用它；否则回退到
   * src/executable/commands/index.ts:executeCommand（仅 root command 受此 fallback）。
   * 这样 do_window / talk_window / program_window 等非 root window 注册的 command
   * 也能在不污染 COMMAND_TABLE 的前提下被执行。
   */
  exec?: (ctx: CommandExecutionContext) => Promise<string | undefined> | string | undefined;
}

/**
 * 命令执行上下文，由 submit tool 消费 form 后传入具体 command。
 *
 * Step 1 重构（spec 2026-05-14）：
 * - 旧 ctx.form: ActiveForm 已废弃；如需访问 form 自身字段（accumulatedArgs / commandPaths 等），
 *   请使用 ctx.formWindow（CommandExecWindow 形态）
 * - 新增 ctx.parentWindow：command 注册到的 window 实例。root command 时 parent=root；
 *   do_window 上的 continue / wait / close command 可以用它取 targetThreadId
 */
export interface CommandExecutionContext {
  /** 当前执行 command 的线程；部分纯元数据 command 可以不依赖线程。 */
  thread?: ThreadContext;
  /**
   * 被 submit 消费的 form 自身（CommandExecWindow）。
   * 旧字段名 `form: ActiveForm` 已删除；调用方传 form 时统一使用本字段。
   */
  form?: CommandExecWindow;
  /**
   * command 注册到的 parent window（root / do_window / 等）。
   * 由 WindowManager.submit 在调用 command 前注入，便于 command 访问父 window 的特有字段。
   */
  parentWindow?: ContextWindow;
  /**
   * 当前调度本次 command 的 WindowManager。
   *
   * command 的 exec 实现**必须**通过此 manager 操作 contextWindows（如 insertTypedWindow），
   * 不要直接 mutate thread.contextWindows——否则 manager 完成 entry.exec 后调用 toData()
   * 会覆盖你的修改。
   */
  manager?: WindowManager;
  /** 最终参数，通常由 form.accumulatedArgs 与 submit 参数合并而来。 */
  args: Record<string, unknown>;
}
