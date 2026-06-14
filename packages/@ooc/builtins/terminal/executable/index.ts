/**
 * terminal —— executable 维度。
 *
 * terminal 是 agent 组合持有的 **tool-object 成员**：把「跑 bash 脚本」能力收成方法挂在
 * terminal 上。`run` 经 `makeRootDelegator` 委托到 terminal_process 的 run constructor——
 * 构造一个 terminal_process（bash 子进程 + history）。独立声明方法壳（不 import root），断
 * root barrel 的 import 循环。
 */
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import { readable } from "../readable.js";

// side-effect：确保被委托的 terminal_process run constructor 已注册。
import "@ooc/builtins/terminal_process";

const RUN_TIP = `run 执行一段 bash 脚本，返回 terminal_process（首次 exec 已跑完，结果进 history）。
参数：code（字符串，必填）。`;

// run 的 exec = 委托到 terminal_process 的 run constructor（constructorKind = 目标窗类 type）。导出供测试直接驱动。
export const runExec = makeRootDelegator({ method: "run", constructorKind: "terminal_process", objectLabel: "terminal_process" });

export const runMethod: ObjectMethod = {
  description: "Run a bash script; result appears as a terminal_process window.",
  intents: ["run.shell"],
  schema: {
    args: {
      code: { type: "string", required: true, description: "待执行 bash 脚本" },
    },
  },
  onFormChange(_change, { args }) {
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const ready = Boolean(code);
    return { tip: ready ? "Running bash..." : RUN_TIP, intents: [{ name: "run.shell" }], quick_exec_submit: ready };
  },
  exec: runExec,
};

// terminal 类的单处声明：executable（methods）+ readable + 可见性 flag。
// parentClass:null —— tool-object **不是 Agent**：无 agency（talk/plan/…），只有自己的工具方法。
builtinRegistry.registerWindowClass({
  type: "terminal",
  parentClass: null,
  methods: { run: runMethod },
  readable,
  renderableVisible: true,
  builtinReadable: true,
});
