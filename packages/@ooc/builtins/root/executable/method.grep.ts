/**
 * root.grep method — 委托到 search_window constructor（form.method="grep"）。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";

import "@ooc/builtins/search";

const GREP_TIP = `grep 按文件内容 regex 搜索，结果作为 search_window。
参数：pattern（必填，regex）、path（可选，目录或文件）、glob（可选，文件名过滤）、case_insensitive（可选）。`;

export const grepMethod: ObjectMethod = {
  description: "Search file contents by regex; results appear as a search_window with line context.",
  intents: ["grep"],
  schema: {
    args: {
      pattern: { type: "string", required: true, description: "正则表达式" },
      path: { type: "string", required: false, description: "搜索根目录或单个文件" },
      glob: { type: "string", required: false, description: "文件名过滤 glob" },
      case_insensitive: { type: "boolean", required: false, description: "是否忽略大小写" },
    },
  },
  onFormChange(change, { args }) {
    const hasPattern = typeof args.pattern === "string" && args.pattern.length > 0;
    return {
      tip: hasPattern ? `grepping for ${args.pattern}...` : GREP_TIP,
      intents: [{ name: "grep" }],
      quick_exec_submit: hasPattern,
    };
  },
  exec: (ctx) => executeGrepMethod(ctx),
};

export const executeGrepMethod = makeRootDelegator({
  method: "grep",
  constructorKind: "search",
  objectLabel: "search_window",
  formMethod: "grep",
});
