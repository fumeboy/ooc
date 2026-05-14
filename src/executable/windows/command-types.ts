/**
 * Command 相关类型 — 与 Window 抽象配套，但语义独立。
 *
 * - CommandTableEntry：单个 command 的完整定义（paths / match / knowledge / exec）
 * - CommandExecutionContext：command 的 exec 函数运行时入参
 * - CommandKnowledgeEntries：command.knowledge() 的返回 shape
 *
 * Window registry 中每种 type 的 \`commands\` map 由 CommandTableEntry 字典构成。
 *
 * Step 2 重构（spec 2026-05-14）后，本文件由 src/executable/commands/types.ts 移到
 * windows/ 目录下，以体现 "command 是 window 的能力" 这一从属关系。
 */

import type { ThreadContext } from "../../thinkable/context";
import type { CommandExecWindow, ContextWindow } from "./types";
import type { WindowManager } from "./manager";

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
   * 执行该 command 的入口；WindowManager.submit 在 form 状态切到 executing 后调用。
   *
   * Step 2 重构后所有 command（root + window-level）都必须提供 exec；不再有按名 fallback。
   */
  exec: (ctx: CommandExecutionContext) => Promise<string | undefined> | string | undefined;
}

/**
 * 命令执行上下文，由 WindowManager.submit 消费 form 后传入具体 command。
 *
 * 字段：
 * - thread：当前执行 command 的线程
 * - form：被 submit 消费的 form 自身（CommandExecWindow）
 * - parentWindow：command 注册到的 parent window；root command 时 parent.type="root"
 * - manager：当前调度的 WindowManager；command exec 必须通过它操作 contextWindows，
 *   不要直接 mutate thread.contextWindows——否则 manager 完成 entry.exec 后调用 toData() 会覆盖
 * - args：最终参数（form.accumulatedArgs）
 */
export interface CommandExecutionContext {
  thread?: ThreadContext;
  form?: CommandExecWindow;
  parentWindow?: ContextWindow;
  manager?: WindowManager;
  args: Record<string, unknown>;
}
