/**
 * interpreter_process — executable 维度（object method）。
 *
 * object method 签名 `(ctx, self, args)`，self=Data（业务数据），副作用经 ctx（thread）。
 * - exec：在已打开的 interpreter_process 中再跑一段 ts/js，结果追加进 self.history。
 * - close：关窗（无副作用，由 runtime 处置信封 status）。
 * 构造（run：首次 exec 跑完造出实例）在 ../index.ts 的 Class.construct。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import { runInterpreterExec, type InterpreterLang } from "./runtime.js";
export { runInterpreterExec } from "./runtime.js";
import type { Data } from "../types.js";

const LANG_ENUM = ["ts", "typescript", "js", "javascript"];

function normLang(args: Record<string, unknown>): InterpreterLang | undefined {
  return (args.language ?? args.lang) as InterpreterLang | undefined;
}

const execMethod: ObjectMethod<Data> = {
  name: "exec",
  description: "Run another ts/js snippet in this interpreter process; result appended to history.",
  schema: {
    args: {
      language: { type: "string", required: true, enum: LANG_ENUM, description: "ts / js" },
      lang: { type: "string", enum: LANG_ENUM, description: "Alias for language" },
      code: { type: "string", required: true, description: "Code string to execute" },
    },
  },
  exec: async (ctx: ExecutableContext, self: Data, args: Record<string, unknown>) => {
    const thread = ctx.thread;
    if (!thread) return "[interpreter_process.exec] 缺少 thread context。";
    const lang = normLang(args);
    const code = args.code as string | undefined;
    if (!(lang && code)) {
      return "[interpreter_process.exec] 缺少执行参数。请重新 exec(window_id=\"<interpreter_process_id>\", method=\"exec\", args={ language: \"ts\"|\"js\", code: \"...\" })。";
    }
    const record = await runInterpreterExec(thread, lang, code, ctx.runtime);
    self.history.push(record);
    await ctx.reportDataEdit?.();
    return undefined;
  },
};

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description: "Close this interpreter process window and its history.",
  exec: () => undefined,
};

const executable: ExecutableModule<Data> = {
  methods: [execMethod, closeMethod],
};

export default executable;
