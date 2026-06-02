/**
 * root.grep command — 委托到 search_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.grep 的构造逻辑（runRipgrep + runJsFallback + SearchWindow build）
 * 已迁到 packages/@ooc/builtins/search/executable/index.ts 的 kind="constructor" search method
 * （dispatch on form.command="grep"）。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("search") 委托。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/command-types.js";
import { lookupConstructor } from "@ooc/core/extendable/_shared/registry.js";
import {
  GREP_BASIC_PATH,
  GREP_INPUT_PATH,
  KNOWLEDGE,
} from "./command.grep.impl.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 search_window constructor 注册
import "@ooc/builtins/search";

export const grepCommand: CommandTableEntry = {
  paths: ["grep"],
  match: () => ["grep"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [GREP_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.pattern !== "string" || args.pattern.length === 0) {
      entries[GREP_INPUT_PATH] =
        "grep 还缺以下参数: pattern。\n" +
        "请用 refine(form_id, args={ pattern: \"<regex>\", path?: \"<dir-or-file>\", glob?: \"*.ts\", case_insensitive?: true }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeGrepCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 search_window constructor（dispatch on form.command="grep"）。
 */
export async function executeGrepCommand(
  ctx: CommandExecutionContext,
): Promise<MethodOutcome | string | undefined> {
  const ctor = lookupConstructor("search");
  if (!ctor) return "[grep] search_window constructor 未注册（registry 期望 kind=\"constructor\" 的 search method）。";
  const ctxWithForm = ctx.form
    ? ctx
    : ({ ...ctx, form: { command: "grep" } } as CommandExecutionContext);
  return await ctor.exec(ctxWithForm);
}
