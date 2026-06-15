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
import type { ContextWindow } from "@ooc/core/extendable/_shared/types.js";
import { notifyThreadActivated } from "@ooc/core/observable/index.js";
import type { Data } from "../types.js";

/** thread.contextWindows 里的 self-view（creator）窗——会话窗形（含 target / say）。 */
type CreatorWindow = ContextWindow & {
  target?: string;
  targetThreadId?: string;
  isForkWindow?: boolean;
};

function findCreatorWindow(ctx: ExecutableContext): CreatorWindow | undefined {
  const list = (ctx.thread?.contextWindows ?? []) as ContextWindow[];
  for (const w of list) {
    // creator 窗（self-view）一律恒有 isCreatorWindow=true，且每 thread 唯一。它的 class 随 POV 投影：
    // 普通 flow = thread / super flow = reflect_request / 历史 fork-creator 也走同一 flag——故按 flag
    // 识别（class-agnostic + forward-compatible），不再枚举 class 字面量。
    if ((w as { isCreatorWindow?: boolean }).isCreatorWindow === true) {
      // self-view 恒是会话窗形（含 target/say）。
      return w as CreatorWindow;
    }
  }
  return undefined;
}

/**
 * end({result}) 自动经 creator 会话窗 say 回报（fork 走内存树、peer 走磁盘派送，由 say 自分流）。
 *
 * deferred（say 归位待 talk 迁移）：thread builtin 已把 say 方法体整体推迟（其 executable.methods
 * 留空，sayMethod 不再存在）——say 深依赖 core 的 talk 渲染/delivery（旧渲染上下文签名）。故本轮
 * auto-reply 暂以 thread 事件登记意图占位；talk 迁新契约后改调 thread.executable 的 say 把 result
 * 真正派到 creator 会话窗对端。
 */
async function autoReplyTalk(
  ctx: ExecutableContext,
  creator: CreatorWindow,
  result: string,
): Promise<void> {
  const thread = ctx.thread!;
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[end.result] 待经 creator 会话窗（target=${creator.target ?? "?"}）say 回报：${result}（say 派送 deferred 至 talk 迁移）。`,
  });
}

export const endMethod: ObjectMethod<Data> = {
  name: "end",
  description:
    "End the current thread (mark done); optional reason/summary/result to report back to parent.",
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    if (!ctx.thread) return undefined;

    const reason = typeof args.reason === "string" ? args.reason : undefined;
    const summary = typeof args.summary === "string" ? args.summary : undefined;
    const result =
      typeof args.result === "string" && args.result.length > 0 ? args.result : undefined;

    if (result !== undefined) {
      const creator = findCreatorWindow(ctx);
      if (!creator) {
        console.warn(
          `[end.result] thread ${ctx.thread.id} 无 creator window（self-driven root？），result 被忽略：${result.slice(0, 100)}${result.length > 100 ? "..." : ""}`,
        );
        ctx.thread.events.push({
          category: "context_change",
          kind: "inject",
          text: "[end.result] 当前 thread 无 creator window（self-driven root），result 参数被忽略；仅 endSummary 仍会记录。",
        });
      } else {
        await autoReplyTalk(ctx, creator, result);
      }
    }

    ctx.thread.endReason = reason;
    ctx.thread.endSummary = summary;
    ctx.thread.status = "done";

    const persistence = ctx.thread.persistence ?? ctx.ownerThreadRef;
    if (persistence) {
      const creator = findCreatorWindow(ctx);
      if (creator) {
        // fork 子窗（isForkWindow）：caller = 同对象的父 thread；peer 窗：caller = creator.target 对象。
        const callerObjectId = creator.isForkWindow ? persistence.objectId : creator.target;
        const callerThreadId = creator.targetThreadId;
        const callerSessionId = ctx.thread.creatorSessionId ?? persistence.sessionId;
        if (callerObjectId && callerThreadId && callerObjectId !== "user") {
          notifyThreadActivated({
            sessionId: callerSessionId,
            objectId: callerObjectId,
            threadId: callerThreadId,
          });
        }
      }
    }
    return undefined;
  },
};
