/**
 * root.grep command — 委托到 search_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.grep 的构造逻辑（runRipgrep + runJsFallback + SearchWindow build）
 * 已迁到 packages/@ooc/builtins/search/executable/index.ts 的 kind="constructor" search method
 * （dispatch on form.command="grep"）。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("search") 委托。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/command-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import {
  GREP_BASIC_PATH,
  GREP_INPUT_PATH,
  KNOWLEDGE,
} from "./command.grep.impl.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 search_window constructor 注册
import "@ooc/builtins/search";

function guidanceWindows(form: MethodExecWindow, entries: Record<string, string>): ContextWindow[] {
  const out: ContextWindow[] = [];
  for (const [path, text] of Object.entries(entries)) {
    const safe = path.replace(/[^a-zA-Z0-9_]/g, "_");
    out.push({
      id: "guidance_" + form.id + "_" + safe,
      type: "guidance",
      parentWindowId: form.id,
      boundFormId: form.id,
      title: path,
      status: "open",
      createdAt: 0,
      relevance: { score: 0.8, signalCount: 1 },
      provenance: {
        kind: "derived",
        reason: { mechanism: "form_bound", sourceId: form.command },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

export const grepCommand: ObjectMethod = {
  paths: ["grep"],
  schema: {
    args: {
      pattern: { type: "string", required: true, description: "正则表达式" },
      path: { type: "string", required: false, description: "搜索根目录或单个文件" },
      glob: { type: "string", required: false, description: "文件名过滤 glob" },
      case_insensitive: { type: "boolean", required: false, description: "是否忽略大小写" },
    },
  } as MethodCallSchema,
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : form.accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [GREP_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return guidanceWindows(form, entries);
    if (typeof args.pattern !== "string" || args.pattern.length === 0) {
      entries[GREP_INPUT_PATH] =
        "grep 还缺以下参数: pattern。\n" +
        "请用 refine(form_id, args={ pattern: \"<regex>\", path?: \"<dir-or-file>\", glob?: \"*.ts\", case_insensitive?: true }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeGrepCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 search_window constructor（dispatch on form.command="grep"）。
 */
export async function executeGrepCommand(
  ctx: MethodExecutionContext,
): Promise<MethodOutcome | string | undefined> {
  const ctor = (ctx.manager?.registry ?? builtinRegistry).lookupConstructor("search");
  if (!ctor) return "[grep] search_window constructor 未注册（registry 期望 kind=\"constructor\" 的 search method）。";
  const ctxWithForm = ctx.form
    ? ctx
    : ({ ...ctx, form: { command: "grep" } } as MethodExecutionContext);
  return await ctor.exec(ctxWithForm);
}
