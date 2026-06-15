/**
 * interpreter —— executable 维度（object method）。
 *
 * interpreter 是 agent 组合持有的 **tool-object 成员**：把「跑 ts/js 脚本」能力收成 `run` 方法。
 * `run` 经 `ctx.runtime.instantiate('_builtin/interpreter/interpreter_process', args)` 委托——造一个
 * interpreter_process（ts/js sandbox + history；首次 exec 已跑完，结果进 history）。
 *
 * 与 readable 维度（投影 + 方法菜单，在 ../readable/index.ts）物理分离。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const LANG_ENUM = ["ts", "typescript", "js", "javascript"];

interface RunArgs {
  language?: string;
  lang?: string;
  code?: string;
}

const runMethod: ObjectMethod<Data, RunArgs> = {
  name: "run",
  description: "Run a ts/js snippet; result appears as an interpreter_process window.",
  schema: {
    args: {
      language: { type: "string", required: true, enum: LANG_ENUM, description: "ts / js" },
      lang: { type: "string", required: false, enum: LANG_ENUM, description: "language 的别名" },
      code: { type: "string", required: true, description: "待执行 ts/js 脚本" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: RunArgs) => {
    if (!ctx.runtime) {
      return "[run] runtime 句柄缺失，无法实例化 interpreter_process。";
    }
    const id = await ctx.runtime.instantiate("_builtin/interpreter/interpreter_process", {
      language: args.language ?? args.lang,
      code: args.code,
    });
    return `interpreter_process 已启动（${id}）。`;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [runMethod],
};

export default executable;
