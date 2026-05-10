/**
 * 命令表（Command Table）
 *
 * 每个 command 维护在同名文件中，目录结构即能力清单。
 * index 只负责聚合与通用查询，避免单个大表吞掉目录可读性。
 */

import { doCommand, executeDoCommand } from "./do.js";
import { endCommand, executeEndCommand } from "./end.js";
import { executePlanCommand, planCommand } from "./plan.js";
import { executeProgramCommand, programCommand } from "./program.js";
import { executeTalkCommand, talkCommand } from "./talk.js";
import { executeTodoCommand, todoCommand } from "./todo.js";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

/** 对外统一导出 command 层类型。 */
export type { CommandExecutionContext, CommandTableEntry } from "./types.js";

/**
 * 命令表定义（核心数据）
 *
 * 当前所有 command 都允许通过 open(type=command, command=X) 打开。
 */
export const COMMAND_TABLE: Record<string, CommandTableEntry> = {
  talk: talkCommand,
  do: doCommand,
  program: programCommand,
  plan: planCommand,
  todo: todoCommand,
  end: endCommand,
};

/**
 * 返回所有可 open 的命令名称列表（已排序）
 *
 * 当前规则：命令表中的所有 command 都允许被 open。
 */
export function getOpenableCommands(): string[] {
  return Object.keys(COMMAND_TABLE).sort();
}

/**
 * 从 (command, args) 派生此次激活的 path 集合（多路径并行）
 *
 * @param command 可通过 open(type="command", command=...) 打开的指令名（talk / program / end / ...）
 * @param args    command 的参数对象
 * @returns 点分路径数组（例：["talk", "talk.continue", "talk.relation_update"]）；command 未定义时返回 []
 */
export function deriveCommandPaths(
  command: string,
  args: Record<string, unknown>,
): string[] {
  const entry = COMMAND_TABLE[command];
  if (!entry) return [];
  try {
    return entry.match(args);
  } catch {
    /* match 抛异常时退化为只命中 bare path */
    return [command];
  }
}

/**
 * 执行命令并返回 result 字符串（可选）。
 *
 * - program 返回 shell 输出
 * - 其它命令返回 undefined（副作用通过 ctx.thread 完成）
 */
export async function executeCommand(command: string, ctx: CommandExecutionContext): Promise<string | undefined> {
  switch (command) {
    case "program":
      return executeProgramCommand(ctx);
    case "talk":
      return executeTalkCommand(ctx);
    case "do":
      return executeDoCommand(ctx);
    case "plan":
      return executePlanCommand(ctx);
    case "todo":
      return executeTodoCommand(ctx);
    case "end":
      return executeEndCommand(ctx);
    default:
      return undefined;
  }
}
