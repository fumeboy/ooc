/**
 * terminal_process —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 construct + 两维度（executable / readable）。
 * 非单例 class：有 construct（terminal 对象的 run → 造一个 terminal_process，首 exec 已跑完结果进 history）。
 * persistable 走系统默认（history 是纯 JSON，无需自定义序列化）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/types/executable.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import { runBashExec } from "./executable/runtime.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/terminal/terminal_process",
  construct: {
    description: "Run a bash script; result appears as a new terminal_process window.",
    schema: {
        code: { type: "string", required: true, description: "待执行 bash 脚本" },
      },
    exec: async (ctx: ConstructorContext, args: { code?: string }): Promise<Data> => {
      const code = args?.code;
      if (typeof code !== "string" || code.trim() === "") {
        throw new Error("[terminal_process] 缺少 code 参数。");
      }
      const record = await runBashExec(ctx.dir, code);
      return { history: [record] };
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
