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
import { notifyThreadActivated } from "@ooc/core/observable/index.js";
import { hasCreatorChannel, objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import { getSessionObjectTable } from "@ooc/core/runtime/session-object-table.js";
import type { Data } from "../types.js";

/**
 * creator（self-view）窗的归一化视图。
 *
 * Wave 4 对象模型：contextWindows 元素是 `OocObjectRef`（元信息 + data 分离）。
 * 会话窗状态（target / targetThreadId / isForkWindow）落 `inst.data`（=TalkData），`id` 落元信息。
 * 本视图把两侧拍平给 end 的 auto-reply / 持久化通知用。
 */
type CreatorWindow = {
  id: string;
  target?: string;
  targetThreadId?: string;
  isForkWindow?: boolean;
};

function findCreatorWindow(ctx: ExecutableContext): CreatorWindow | undefined {
  if (!ctx.thread) return undefined;
  const list = ctx.thread.contextWindows ?? [];
  const table = getSessionObjectTable(ctx.thread);
  for (const inst of list) {
    // 本 thread 的过程窗（self-view）每 thread 唯一，身份编码在 id（id=`w_creator_<thread.id>`）。
    // auto-reply 只对**有上游 creator 通道**的过程窗（hasCreatorChannel：data 带 target/isForkWindow）；
    // self-driven root 的空通道过程窗 → 返回 undefined → end 忽略 result（既有降级）。
    if (!hasCreatorChannel(inst, table)) continue;
    const data = (objectDataOf(inst, table) ?? {}) as {
      target?: string;
      targetThreadId?: string;
      isForkWindow?: boolean;
    };
    return {
      id: inst.id,
      target: data.target,
      targetThreadId: data.targetThreadId,
      isForkWindow: data.isForkWindow,
    };
  }
  return undefined;
}

/**
 * end({result}) 自动经 creator 会话窗 say 回报（fork 走内存树、peer 走磁盘派送，由 say 自分流）。
 *
 * 派送经 `ctx.runtime.say(creatorWindowId, result)`——委托 talk object method `say`，
 * 由 creator 窗自身 TalkData 分流 peer 磁盘 / fork 内存派送。runtime 缺席（无 say 通道）或
 * 派送失败时退化为 thread 事件登记意图，不阻断 end 主流程。
 */
async function autoReplyTalk(
  ctx: ExecutableContext,
  creator: CreatorWindow,
  result: string,
): Promise<void> {
  const thread = ctx.thread!;
  if (ctx.runtime?.say) {
    try {
      await ctx.runtime.say(creator.id, result);
      return;
    } catch (error) {
      thread.events.push({
        category: "context_change",
        kind: "inject",
        text: `[end.result] 经 creator 会话窗 say 回报失败：${(error as Error).message}；result=${result}`,
      });
      return;
    }
  }
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[end.result] 无 runtime.say 通道，待经 creator 会话窗（target=${creator.target ?? "?"}）say 回报：${result}。`,
  });
}

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
