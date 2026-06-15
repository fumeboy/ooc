/**
 * interpreter_process —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 construct + executable + readable。
 * 非单例 class：construct（run）跑首段 ts/js（独立 sandbox），首条 ProcessExecRecord 进 history。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import { runInterpreterExec, type InterpreterLang } from "./executable/runtime.js";
import type { Data } from "./types.js";

const LANG_ENUM = ["ts", "typescript", "js", "javascript"];

function normLang(args: Record<string, unknown>): InterpreterLang | undefined {
  return (args.language ?? args.lang) as InterpreterLang | undefined;
}

export const Class: OocClass<Data> = {
  construct: {
    description: "Run a ts/js snippet; result appears as a new interpreter_process window.",
    schema: {
      args: {
        language: { type: "string", required: true, enum: LANG_ENUM, description: "ts / js" },
        lang: { type: "string", enum: LANG_ENUM, description: "Alias for language" },
        code: { type: "string", required: true, description: "Code string to execute" },
      },
    },
    exec: async (ctx: ConstructorContext, args: Record<string, unknown>): Promise<Data> => {
      const thread = ctx.thread;
      if (!thread) throw new Error("[interpreter_process] 缺少 thread context。");
      const lang = normLang(args);
      const code = args.code as string | undefined;
      if (!(lang && code)) {
        throw new Error("[interpreter_process] 缺少执行参数；需要 language+code。");
      }
      const record = await runInterpreterExec(thread, lang, code);
      return { history: [record] };
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
