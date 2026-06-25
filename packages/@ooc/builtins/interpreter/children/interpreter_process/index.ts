/**
 * interpreter_process —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 construct + executable + readable。
 * 非单例 class：construct（run）跑首段 ts/js（独立 sandbox），首条 ProcessExecRecord 进 history。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/types";
import { makeSelfProxy } from "@ooc/core/runtime/self-proxy.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import { runInterpreterExec, type InterpreterLang } from "./executable/runtime.js";
import type { Data } from "./types.js";

const LANG_ENUM = ["ts", "typescript", "js", "javascript"];

function normLang(args: Record<string, unknown>): InterpreterLang | undefined {
  return (args.language ?? args.lang) as InterpreterLang | undefined;
}

export const Class: OocClass<Data> = {
  id: "_builtin/interpreter/interpreter_process",
  construct: {
    description: "Run a ts/js snippet; result appears as a new interpreter_process window.",
    schema: {
        language: { type: "string", required: true, enum: LANG_ENUM, description: "ts / js" },
        lang: { type: "string", enum: LANG_ENUM, description: "Alias for language" },
        code: { type: "string", required: true, description: "Code string to execute" },
      },
    exec: async (ctx: ConstructorContext, args: Record<string, unknown>): Promise<Data> => {
      const lang = normLang(args);
      const code = args.code as string | undefined;
      if (!(lang && code)) {
        throw new Error("[interpreter_process] 缺少执行参数；需要 language+code。");
      }
      // 实例尚未存在（construct 无 self-proxy）：在 nascent data 上建临时 self-proxy，sandbox 内
      // self.data.* 的写入随返回的 Data 落盘。self.methods 自调在 construct 期不可用（实例 id 未分配，
      // runtime.callMethod 会抛 object-not-found）——首段脚本不应自调本对象方法。
      const data: Data = { history: [], userData: {} };
      const self = makeSelfProxy<Data>(data, "<constructing>", ctx.runtime);
      const record = await runInterpreterExec(lang, code, self, ctx);
      data.history.push(record);
      return data;
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
