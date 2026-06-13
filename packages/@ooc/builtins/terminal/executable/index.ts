/**
 * terminal —— executable 维度。
 *
 * terminal 是 agent 组合持有的 **tool-object 成员**：把「运行程序」能力收成方法挂在 terminal 上。
 * `program` 经 `makeRootDelegator` 委托到 program constructor（shell/ts/js）——与 root.program
 * 同一条委托链、行为一致。独立声明方法壳（不 import root），断 root barrel 的 import 循环。
 *
 * 注：ts/js 解释能力本应拆成 terminal 持有的 interpreter 子成员（grill 共识），本 increment
 * 先由 program 统一承载，interpreter 拆分留作后续。
 */
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";

// side-effect：确保被委托的 program constructor 已注册。
import "@ooc/builtins/program";

const programMethod: ObjectMethod = {
  description: "Execute a shell/ts/js snippet; result appears as a program window.",
  intents: ["program"],
  schema: {
    args: {
      language: { type: "string", required: true, description: "shell / ts / js", enum: ["shell", "ts", "typescript", "js", "javascript"] },
      lang: { type: "string", required: false, description: "language 的别名" },
      code: { type: "string", required: true, description: "待执行代码字符串" },
    },
  },
  onFormChange(_change, { args }) {
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    return { intents: [{ name: "program" }], quick_exec_submit: Boolean(lang && code) };
  },
  exec: makeRootDelegator({ method: "program", constructorKind: "program", objectLabel: "program_window" }),
};

builtinRegistry.registerExecutable("terminal", {
  methods: { program: programMethod },
});
