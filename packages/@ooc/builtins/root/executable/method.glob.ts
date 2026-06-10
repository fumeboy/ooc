/**
 * root.glob method — 委托到 search_window constructor（form.method="glob"）。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";

import "@ooc/builtins/search";

const GLOB_TIP = `glob 按文件名通配符查找文件，结果作为 search_window。
参数：pattern（必填，glob 通配符，如 src/**/*.ts）、cwd（可选，搜索根目录）。`;

export const globMethod: ObjectMethod = {
  description: "Find files by glob pattern; results appear as a search_window.",
  intents: ["glob"],
  schema: {
    args: {
      pattern: { type: "string", required: true, description: "glob 通配符" },
      cwd: { type: "string", required: false, description: "搜索根目录" },
    },
  },
  onFormChange(change, { args }) {
    const hasPattern = typeof args.pattern === "string" && args.pattern.length > 0;
    return {
      tip: hasPattern ? `globbing ${args.pattern}...` : GLOB_TIP,
      intents: [{ name: "glob" }],
      quick_exec_submit: hasPattern,
    };
  },
  exec: (ctx) => executeGlobMethod(ctx),
};

export const executeGlobMethod = makeRootDelegator({
  method: "glob",
  constructorKind: "search",
  objectLabel: "search_window",
  formMethod: "glob",
});
