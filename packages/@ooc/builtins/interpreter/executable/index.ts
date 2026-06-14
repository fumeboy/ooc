/**
 * interpreter —— executable 维度。
 *
 * interpreter 是 agent 组合持有的 **tool-object 成员**：把「跑 ts/js 脚本」能力收成方法挂在
 * interpreter 上。`run` 经 `makeRootDelegator` 委托到 interpreter_process 的 run constructor——
 * 构造一个 interpreter_process（ts/js sandbox + history）。独立声明方法壳（不 import root），断
 * root barrel 的 import 循环。
 */
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import { readable } from "../readable.js";

// side-effect：确保被委托的 interpreter_process run constructor 已注册。
import "@ooc/builtins/interpreter_process";

const LANG_ENUM = ["ts", "typescript", "js", "javascript"];

const RUN_TIP = `run 执行一段 ts/js 脚本，返回 interpreter_process（首次 exec 已跑完，结果进 history）。
参数：language（ts/js，必填）、code（字符串，必填）。`;

// run 的 exec = 委托到 interpreter_process 的 run constructor（constructorKind = 目标窗类 type）。导出供测试直接驱动。
export const runExec = makeRootDelegator({ method: "run", constructorKind: "interpreter_process", objectLabel: "interpreter_process" });

export const runMethod: ObjectMethod = {
  description: "Run a ts/js snippet; result appears as an interpreter_process window.",
  intents: ["run.ts", "run.js"],
  schema: {
    args: {
      language: { type: "string", required: true, enum: LANG_ENUM, description: "ts / js" },
      lang: { type: "string", required: false, enum: LANG_ENUM, description: "language 的别名" },
      code: { type: "string", required: true, description: "待执行 ts/js 脚本" },
    },
  },
  onFormChange(_change, { args }) {
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const intents = lang === "js" || lang === "javascript" ? [{ name: "run.js" }] : [{ name: "run.ts" }];
    const ready = Boolean(lang && code);
    return { tip: ready ? `Running ${lang}...` : RUN_TIP, intents, quick_exec_submit: ready };
  },
  exec: runExec,
};

// interpreter 类的单处声明：executable（methods）+ readable + 可见性 flag。
// parentClass:null —— tool-object **不是 Agent**：无 agency，只有自己的工具方法。
builtinRegistry.registerWindowClass({
  type: "interpreter",
  parentClass: null,
  methods: { run: runMethod },
  readable,
  renderableVisible: true,
  builtinReadable: true,
});
