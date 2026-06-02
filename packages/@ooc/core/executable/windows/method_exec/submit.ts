/**
 * method_exec.submit —— 触发 form.command.exec。
 *
 * 调用形态：exec(<form_id>, "submit")
 *
 * exec ctx 中：
 * - self = 该 form 自身（type=method_exec / 兼容 command_exec；P6.§3 由 manager dispatch 强保证类型）
 * - ctx.thread / ctx.manager 是必需的
 *
 * 命令体走 manager.submit：状态 open → executing → success | failed (Round 13 升级)。
 * 成功 (success) 自动移除 form；失败 (failed) 保留 form + result，LLM 可 refine 修复后重 submit。
 *
 * P6.§9（2026-06-02）：源文件从 `packages/@ooc/builtins/command_exec/executable/command.submit.ts`
 * 迁移到 `packages/@ooc/core/executable/windows/method_exec/submit.ts`。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  ObjectMethod,
} from "../_shared/command-types.js";
import type { CommandExecWindow as MethodExecWindow } from "../_shared/types.js";

async function executeSubmit(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "method_exec"，method 体不再 re-check。
  const form = ctx.self as MethodExecWindow;
  if (form.status !== "open") {
    return `[method_exec.submit] form ${form.id} 不在 open 状态（当前 ${form.status}）。`;
  }
  if (!ctx.manager || !ctx.thread) {
    return "[method_exec.submit] 缺少 manager / thread 上下文。";
  }
  try {
    const result = await ctx.manager.submit(form.id, ctx.thread);
    const after = ctx.manager.get(form.id);
    const removed = !after;
    const title = form.command;
    // Round 13: removed = success 路径 (form 已自动从 contextWindows 移除);
    // 留下来的必然是 failed 状态 (open → executing → failed)。
    const messageBase = removed
      ? `[form success] form "${title}" 已成功执行并自动释放。`
      : `[form failed] form "${title}" 执行失败（status=failed; refine 修正参数后可重 submit, 或 close 放弃）。`;
    return result !== undefined ? `${messageBase}\n${result}` : messageBase;
  } catch (err) {
    return `[method_exec.submit] submit 失败：${(err as Error).message}`;
  }
}

export const submitMethod: ObjectMethod = {
  paths: ["submit"],
  match: () => ["submit"],
  knowledge: (_args, _formStatus): MethodKnowledgeEntries => ({
    "internal/windows/method_exec/submit/basic": [
      "method_exec.submit 触发 form.command 真正执行；不接受新业务参数。",
      "调用：exec(window_id=<form_id>, command=\"submit\")",
      "成功执行后系统自动从 context 移除该 form；失败则保留 result 字段，需要 close。",
    ].join("\n"),
  }),
  exec: (ctx) => executeSubmit(ctx),
};

/** @deprecated P6.§9 alias — use `submitMethod`. Kept one release for backward-compat with importers under the old name. */
export const submitCommand = submitMethod;
