/**
 * root.grep command — 委托到 search_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.grep 的构造逻辑（runRipgrep + runJsFallback + SearchWindow build）
 * 已迁到 packages/@ooc/builtins/search/executable/index.ts 的 kind="constructor" search method
 * （dispatch on form.command="grep"）。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("search") 委托。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import {
  GREP_BASIC_PATH,
  GREP_INPUT_PATH,
  KNOWLEDGE,
} from "./method.grep.impl.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 search_window constructor 注册
import "@ooc/builtins/search";


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
  intent: emptyIntent,
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : form.accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [GREP_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    if (typeof args.pattern !== "string" || args.pattern.length === 0) {
      entries[GREP_INPUT_PATH] =
        "grep 还缺以下参数: pattern。\n" +
        "请用 refine(form_id, args={ pattern: \"<regex>\", path?: \"<dir-or-file>\", glob?: \"*.ts\", case_insensitive?: true }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeGrepCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 search_window constructor（dispatch on form.command="grep"）。
 */
export const executeGrepCommand = makeRootDelegator({
  command: "grep",
  constructorKind: "search",
  objectLabel: "search_window",
  formCommand: "grep",
});
