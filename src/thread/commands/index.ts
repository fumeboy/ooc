/**
 * 命令表（Command Table）—— 三阶段 Trait 激活的 Process 阶段索引
 *
 * 每个 command 维护在同名文件中，目录结构即能力清单：
 * - `commands/talk.ts`
 * - `commands/program.ts`
 * - `commands/return.ts`
 *
 * index 只负责聚合与通用查询，避免单个大表吞掉目录可读性。
 *
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#第二部分-process过程
 */

import { awaitCommand, executeAwaitCommand } from "./await.js";
import { awaitAllCommand, executeAwaitAllCommand } from "./await_all.js";
import { compactCommand, executeCompactCommand } from "./compact.js";
import { deferCommand, executeDeferCommand } from "./defer.js";
import { executeProgramCommand, programCommand } from "./program.js";
import { executeReturnCommand, returnCommand } from "./return.js";
import { executeSetPlanCommand, setPlanCommand } from "./set_plan.js";
import { executeTalkCommand, talkCommand } from "./talk.js";
import { executeThinkCommand, thinkCommand } from "./think.js";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export type { CommandTableEntry } from "./types.js";

/**
 * 命令表定义（核心数据）
 *
 * openable: true 的条目会出现在 OPEN_TOOL.command.enum（通过 getOpenableCommands() 动态生成）。
 */
export const COMMAND_TABLE: Record<string, CommandTableEntry> = {
  talk: talkCommand,
  think: thinkCommand,
  program: programCommand,
  return: returnCommand,
  set_plan: setPlanCommand,
  await: awaitCommand,
  await_all: awaitAllCommand,
  defer: deferCommand,
  compact: compactCommand,
};

/**
 * 返回所有 openable 命令的名称列表（已排序）
 *
 * 用于动态生成 OPEN_TOOL.command.enum，保持单一数据来源：
 * 新增 command 只需新增 `commands/<name>.ts` 并在此聚合。
 */
export function getOpenableCommands(): string[] {
  return Object.keys(COMMAND_TABLE)
    .filter((key) => COMMAND_TABLE[key]?.openable === true)
    .sort();
}

/**
 * 从 (command, args) 派生此次激活的 path 集合（多路径并行）
 *
 * @param command 可通过 open(type="command", command=...) 打开的指令名（talk / program / return / ...）
 * @param args    command 的参数对象
 * @returns 点分路径数组（例：["talk", "talk.continue", "talk.continue.relation_update"]）；command 未定义时返回 []
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

export async function executeCommand(command: string, ctx: CommandExecutionContext): Promise<void> {
  switch (command) {
    case "program":
      return executeProgramCommand(ctx);
    case "talk":
      return executeTalkCommand(ctx);
    case "return":
      return executeReturnCommand(ctx);
    case "think":
      return executeThinkCommand(ctx);
    case "set_plan":
      return executeSetPlanCommand(ctx);
    case "await":
      return executeAwaitCommand(ctx);
    case "await_all":
      return executeAwaitAllCommand(ctx);
    case "compact":
      return executeCompactCommand(ctx);
    case "defer":
      return executeDeferCommand(ctx);
    default:
      return undefined;
  }
}
