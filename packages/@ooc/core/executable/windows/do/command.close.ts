import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import type { DoWindow } from "../_shared/types.js";
import { archiveDoWindowChild } from "./helpers.js";

const DO_WINDOW_CLOSE_BASIC = "internal/windows/do/close/basic";
const CLOSE_KNOWLEDGE = `
do_window.close 等价于 close tool，但语义上明确表达"归档子线程对话"。
关闭后子线程会被标记为 archived，不再被 scheduler 选中执行。
`.trim();

async function executeDoWindowClose(ctx: CommandExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "do"，method 体不再 re-check。
  const window = ctx.self as DoWindow;
  archiveDoWindowChild(ctx.thread, window);
  return undefined;
}

export const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [DO_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: (ctx) => executeDoWindowClose(ctx),
};
