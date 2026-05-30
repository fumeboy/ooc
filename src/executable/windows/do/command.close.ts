import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import { archiveDoWindowChild } from "./helpers.js";

const DO_WINDOW_CLOSE_BASIC = "internal/windows/do/close/basic";
const CLOSE_KNOWLEDGE = `
do_window.close 等价于 close tool，但语义上明确表达"归档子线程对话"。
关闭后子线程会被标记为 archived，不再被 scheduler 选中执行。
`.trim();

async function executeDoWindowClose(ctx: MethodExecutionContext): Promise<string | undefined> {
  const window = ctx.parentWindow;
  if (!window || window.type !== "do") {
    return "[do_window.close] 未挂载在 do_window 上。";
  }
  archiveDoWindowChild(ctx.thread, window);
  return undefined;
}

export const closeCommand: MethodEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): MethodKnowledgeEntries => ({ [DO_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: (ctx) => executeDoWindowClose(ctx),
};
