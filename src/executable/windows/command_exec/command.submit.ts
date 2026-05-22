import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";

/**
 * command_exec.submit 命令 — 触发 form.command.exec。
 *
 * 调用形态：exec(<form_id>, "submit")
 *
 * exec ctx 中：
 * - parentWindow = 该 form 自身（type=command_exec）
 * - ctx.thread / ctx.manager 是必需的
 *
 * 命令体走 manager.submit：状态 open → executing → executed；成功移除 form，
 * 失败保留 form + result。
 *
 * 这条命令本身不引入新 path/knowledge，走 exec tool 的 auto-execute 路径。
 */
async function executeSubmit(ctx: CommandExecutionContext): Promise<string | undefined> {
  const form = ctx.parentWindow;
  if (!form || form.type !== "command_exec") {
    return "[command_exec.submit] 必须挂在 command_exec form 上调用。";
  }
  if (form.status !== "open") {
    return `[command_exec.submit] form ${form.id} 不在 open 状态（当前 ${form.status}）。`;
  }
  if (!ctx.manager || !ctx.thread) {
    return "[command_exec.submit] 缺少 manager / thread 上下文。";
  }
  try {
    const result = await ctx.manager.submit(form.id, ctx.thread);
    const after = ctx.manager.get(form.id);
    const removed = !after;
    const title = form.command;
    const messageBase = removed
      ? `[form executed] form "${title}" 已成功执行并自动释放。`
      : `[form executed] form "${title}" 执行完成（保留待 close）。`;
    return result !== undefined ? `${messageBase}\n${result}` : messageBase;
  } catch (err) {
    return `[command_exec.submit] submit 失败：${(err as Error).message}`;
  }
}

export const submitCommand: CommandTableEntry = {
  paths: ["submit"],
  match: () => ["submit"],
  knowledge: (_args, _formStatus): CommandKnowledgeEntries => ({
    "internal/windows/command_exec/submit/basic": [
      "command_exec.submit 触发 form.command 真正执行；不接受新业务参数。",
      "调用：exec(window_id=<form_id>, command=\"submit\")",
      "成功执行后系统自动从 context 移除该 form；失败则保留 result 字段，需要 close。",
    ].join("\n"),
  }),
  exec: (ctx) => executeSubmit(ctx),
};
