/**
 * agent.end —— agency 之一：结束当前 thread（标记 done），可选 reason/summary/result 回报父级。
 *
 * 新契约下签名 `(ctx, self, args)`：thread 从 ctx.thread 取，args 是独立入参。
 *
 * end({result}) 自动经 creator 会话窗 say 回报（fork 走内存树、peer 走磁盘派送，由 say 自分流）。
 * 该 auto-reply 深度依赖 core（creator window 识别 + say method 派送 + notifyThreadActivated）——
 * 见 deferred_hooks：本轮保留逻辑体，core API（say 新签名 / WindowManager）待反推阶段补齐。
 */

import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { SelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import type { Data } from "../types.js";


export const endMethod: ObjectMethod<Data> = {
  name: "end",
  description:
    "End the current thread (mark done); optional reason/summary/result to report back to parent.",
  schema: {
    args: {
      reason: { type: "string", required: false, description: "结束原因（记入 thread.endReason）" },
      summary: { type: "string", required: false, description: "本 thread 的小结（记入 thread.endSummary）" },
      result: {
        type: "string",
        required: false,
        description: "回报给父级/creator 会话窗的结果（经 creator 窗 say 派回）",
      },
    },
  },
  exec: async (ctx: ExecutableContext, self: SelfProxy<Data>, args: Record<string, unknown>) => {
    const reason = typeof args.reason === "string" ? args.reason : undefined;
    const summary = typeof args.summary === "string" ? args.summary : undefined;

    self.data.endReason = reason;
    self.data.endSummary = summary;
    self.data.status = "done";

    ctx.reportDataEdit();

    return undefined;
  },
};
