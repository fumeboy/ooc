/**
 * interpreter —— executable 维度（object method）。
 *
 * interpreter 是 agent 组合持有的 **tool-object 成员**：把「跑 ts/js 脚本」能力收成 `run` 方法。
 * `run` 经 `ctx.runtime.instantiate('_builtin/interpreter_process', args)` 委托——造一个
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

const RUN_TIP = `run 执行一段 ts/js 脚本，返回 interpreter_process（首次 exec 已跑完，结果进 history）。
参数：language（ts/js，必填）、code（字符串，必填）。`;

/**
 * 契约外的旧 form 驱动 hook（onFormChange）逻辑——保留为本目录局部 helper 备查（登 deferred_hooks）。
 * 旧形态：随表单填写实时回报 tip / intents(run.ts|run.js) / quick_exec_submit，供前端 UI。
 * 新契约的 ObjectMethod 不含该 hook 字段；运行时若需 form 反馈应在 readable/visible 重新表达。
 */
export function runFormFeedback(args: Record<string, unknown>): {
  tip: string;
  intents: { name: string }[];
  quick_exec_submit: boolean;
} {
  const lang = (args.language ?? args.lang) as string | undefined;
  const code = typeof args.code === "string" ? (args.code as string).trim() : "";
  const intents =
    lang === "js" || lang === "javascript" ? [{ name: "run.js" }] : [{ name: "run.ts" }];
  const ready = Boolean(lang && code);
  return { tip: ready ? `Running ${lang}...` : RUN_TIP, intents, quick_exec_submit: ready };
}

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
    const id = await ctx.runtime.instantiate("_builtin/interpreter_process", {
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
