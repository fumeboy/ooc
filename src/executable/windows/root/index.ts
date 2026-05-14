/**
 * Root window registration — 把 root window 上注册的所有 command 集中在此处。
 *
 * Step 2 重构（spec 2026-05-14）：
 * - 旧 src/executable/commands/index.ts 拆分到这里 + windows/registry.ts；
 *   commands/ 目录已迁到 windows/root/，体现 "root 是一种 window type" 的从属关系
 * - 通过 registerWindowType("root", { commands }) 注入；与其它 window type 形态一致
 * - 暴露的工具函数（getOpenableCommands / deriveCommandPaths）只服务于 root 上的命令
 */

import { registerWindowType } from "../registry.js";
import { doCommand } from "./do.js";
import { endCommand } from "./end.js";
import { openFileCommand } from "./open-file.js";
import { openKnowledgeCommand } from "./open-knowledge.js";
import { planCommand } from "./plan.js";
import { programCommand } from "./program.js";
import { talkCommand } from "./talk.js";
import { todoCommand } from "./todo.js";
import type { CommandTableEntry } from "../command-types.js";

/**
 * Root window 上注册的命令清单（核心数据）。
 *
 * 当前所有 command 都允许通过 \`open(parent_window_id?, command="X", ...)\` 打开。
 * window-level 命令（如 do_window 上的 continue）由各自 windows/X.ts 注册到对应 type 上。
 */
export const ROOT_COMMANDS: Record<string, CommandTableEntry> = {
  talk: talkCommand,
  do: doCommand,
  program: programCommand,
  plan: planCommand,
  todo: todoCommand,
  end: endCommand,
  open_file: openFileCommand,
  open_knowledge: openKnowledgeCommand,
};

/** 返回所有 root 上可 open 的命令名称列表（已排序）。 */
export function getOpenableCommands(): string[] {
  return Object.keys(ROOT_COMMANDS).sort();
}

/**
 * 测试 / 直接调用 root command 的便捷入口；不走 WindowManager。
 *
 * 仅供测试使用：单测希望验证 root command 的副作用而不必构造 form 生命周期。
 * 生产代码应通过 WindowManager.openCommandExec 触发；那条路径会注入 manager
 * 与 parentWindow 等完整 ctx。
 */
/**
 * 测试 / 直接调用 root command 的便捷入口；不走 WindowManager。
 *
 * 仅供测试使用：单测希望验证 root command 的副作用而不必构造 form 生命周期。
 * 生产代码应通过 WindowManager.openCommandExec 触发；那条路径会注入 manager
 * 与 parentWindow 等完整 ctx，并走 outcome 识别。
 *
 * 这里保持旧的"返回 string | undefined"签名以兼容大量测试断言；遇到 outcome 时压平：
 * - { ok: true, result } → result
 * - { ok: false, error } → error（与旧 string-failure 约定一致）
 */
export async function execRootCommand(
  name: string,
  ctx: import("../command-types.js").CommandExecutionContext,
): Promise<string | undefined> {
  const entry = ROOT_COMMANDS[name];
  if (!entry) throw new Error(`execRootCommand: unknown root command "${name}"`);
  const raw = await entry.exec(ctx);
  if (raw && typeof raw === "object" && "ok" in raw) {
    return raw.ok ? raw.result : raw.error;
  }
  return raw;
}

/**
 * 从 (root command, args) 派生此次激活的 path 集合。
 *
 * 仅服务 root level 的命令；非 root window 上的命令请直接通过 WINDOW_REGISTRY 查 entry.match()。
 *
 * @returns 点分路径数组；command 未定义时返回 []
 */
export function deriveRootCommandPaths(
  command: string,
  args: Record<string, unknown>,
): string[] {
  const entry = ROOT_COMMANDS[command];
  if (!entry) return [];
  try {
    return entry.match(args);
  } catch {
    return [command];
  }
}

// 向 WindowRegistry 注入 root window type 的契约。
// side-effect 注册：windows/index.ts 通过 import "./root/index.js" 触发本模块加载。
registerWindowType("root", { commands: ROOT_COMMANDS });
