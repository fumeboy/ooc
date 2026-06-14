/**
 * say method —— say 是 thread 的行为（设计权威：thinkable `knowledge/thread.md` 核心 3）。
 *
 * 本 ObjectMethod 是 say 的**单一来源**：注册在 thread class 上，并被会话窗（talk / reflect_request）
 * 共享复用——LLM 在会话窗上 `exec(window, "say")`，落到这同一个 method、同一份逻辑（say.ts:executeSay）。
 * 据 ctx.self 形态分流：fork 子窗走内存树派送、peer 窗走磁盘 talk-delivery。
 */
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import { executeSay } from "./say.js";

const SAY_TIP = `say 向对端发消息（peer 会话或 fork 子线程双向通道）。
参数：msg（必填）、wait（可选，true 时本 thread 等待回复）。`;

export const sayMethod: ObjectMethod = {
  description: "Send a message to the other side of this conversation window — peer object, or the forked child/parent thread (set wait=true to block until they reply).",
  intents: ["say.wait"],
  schema: {
    args: {
      msg: { type: "string", required: true, description: "消息正文" },
      wait: { type: "boolean", required: false, default: false, description: "true 时等待回复" },
    },
  } as MethodCallSchema,
  onFormChange(change, { args }) {
    const intents = args.wait === true ? [{ name: "say.wait" }] : [{ name: "say" }];
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    return {
      tip: hasMsg ? "Sending message..." : SAY_TIP,
      intents,
      quick_exec_submit: hasMsg,
    };
  },
  exec: (ctx) => executeSay(ctx),
};
