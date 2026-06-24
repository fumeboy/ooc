/**
 * terminal —— executable 维度（object method）。
 *
 * terminal 是 agent 组合持有的 **tool-object 成员**：把「跑 bash 脚本」能力收成方法 `run`。
 * `run` 经 `ctx.runtime.instantiate` 委托到 `_builtin/terminal/terminal_process` 的 constructor——构造一个
 * terminal_process（bash 子进程 + history，首次 exec 已跑完、结果进 history）。terminal 自身无
 * 业务数据（Data 为空），run 不改 self，只产生「造子对象」副作用。
 *
 * tool-object **不是 Agent**：无 agency（talk/plan/…），只有自己的工具方法。
 */
import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/types";
import type { Data } from "../types.js";

const TERMINAL_PROCESS_CLASS = "_builtin/terminal/terminal_process";

const runMethod: ObjectMethod<Data> = {
  name: "run",
  description: "Run a bash script; result appears as a terminal_process window.",
  schema: {
    args: {
      code: { type: "string", required: true, description: "待执行 bash 脚本" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: { code?: string }) => {
    if (!ctx.runtime) {
      throw new Error("[terminal.run] runtime 句柄缺失，无法实例化 terminal_process。");
    }
    const id = await ctx.runtime.instantiate({class: TERMINAL_PROCESS_CLASS, args: args as Record<string, unknown>});
    return `terminal_process 已创建（${id}）：bash 脚本已执行，结果进 history。`;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [runMethod],
};

export default executable;
