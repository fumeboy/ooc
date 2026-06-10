/**
 * root.program command — 委托到 program_window constructor。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

import "@ooc/builtins/program";

const PROGRAM_TIP = `program 执行 shell/ts/js 代码，返回 program_window（首次 exec 已跑完，结果进 history）。
参数：language（shell/ts/js，必填）、code（字符串，必填）。`;

export enum ProgramMethodPath {
  Program = "program",
  Shell = "program.shell",
  TypeScript = "program.typescript",
  JavaScript = "program.javascript",
}

export const programMethod: ObjectMethod = {
  description: "Execute a shell/ts/js snippet; result appears as a program_window.",
  intents: [ProgramMethodPath.Shell, ProgramMethodPath.TypeScript, ProgramMethodPath.JavaScript],
  schema: {
    args: {
      language: { type: "string", required: true, description: "shell / ts / js", enum: ["shell", "ts", "typescript", "js", "javascript"] },
      lang: { type: "string", required: false, description: "language 的别名" },
      code: { type: "string", required: true, description: "待执行代码字符串" },
    },
  },
  onFormChange(change, { form }) {
    const args = (form as MethodExecWindow).accumulatedArgs;
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const intents = [];
    if (lang === "shell") intents.push({ name: ProgramMethodPath.Shell });
    else if (lang === "ts" || lang === "typescript") intents.push({ name: ProgramMethodPath.TypeScript });
    else if (lang === "js" || lang === "javascript") intents.push({ name: ProgramMethodPath.JavaScript });
    else intents.push({ name: "program" });
    const ready = Boolean(lang && code);
    return {
      tip: ready ? `Running ${lang} program...` : PROGRAM_TIP,
      intents,
      quick_exec_submit: ready,
    };
  },
  exec: (ctx) => executeProgramMethod(ctx),
};

export const executeProgramMethod = makeRootDelegator({
  method: "program",
  constructorKind: "program",
  objectLabel: "program_window",
});
