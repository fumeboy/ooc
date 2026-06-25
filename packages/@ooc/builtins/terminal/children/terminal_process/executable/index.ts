/**
 * terminal_process — executable 维度（object method）。
 *
 * object method 签名 `(ctx, self, args)`，self=Data（业务数据），副作用经 ctx.thread（spawn bash）。
 * - exec  : 在已打开的 terminal_process 中再跑一段 bash，结果追加进 history。
 * - close : 关窗（无副作用；runtime 据返回 close 投影态）。
 *
 * 构造（run）见 ../index.ts 的 Class.construct。readable 投影 + set_history_window window method
 * 见 ../readable/index.ts。原 program 包的 shell 路径在 ./runtime.ts + ./shell.ts。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/types";
import type { SelfProxy } from "@ooc/core/types";
import { runBashExec } from "./runtime.js";
export { runBashExec } from "./runtime.js";
import type { Data } from "../types.js";

const execMethod: ObjectMethod<Data> = {
  name: "exec",
  description: "Run another bash script in this terminal process; result appended to history.",
  schema: {
      code: { type: "string", required: true, description: "待执行 bash 脚本" },
    },
  exec: async (ctx: ExecutableContext, self: SelfProxy<Data>, args: { code?: string }) => {
    const code = args?.code;
    if (typeof code !== "string" || code.trim() === "") {
      return "[terminal_process.exec] 缺少 code 参数。请重新 exec(window_id=\"<terminal_process_id>\", method=\"exec\", args={ code: \"...\" })。";
    }
    const record = await runBashExec(ctx.dir, code);
    self.data.history = [...self.data.history, record];
    await ctx.reportDataEdit?.();
    return undefined;
  },
};

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description: "Close this terminal process window and its history.",
  exec: () => undefined,
};

const executable: ExecutableModule<Data> = {
  methods: [execMethod, closeMethod],
};

export default executable;
