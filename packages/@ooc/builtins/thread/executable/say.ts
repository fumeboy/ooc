/**
 * thread.say —— say 的真正逻辑（设计权威：thinkable `knowledge/thread.md` 核心 3 + agent.md 核心 5）。
 *
 * say 是 **thread 的行为**：thread 持 inbox/outbox，say 把消息从自己的视角发到对端那条 thread。
 * 一个会话窗（talk peer / talk fork / reflect_request）只是这次发送选用的「通道」——say 据通道形态分流：
 *
 * - **fork 子线程窗**（isForkWindow）：同对象父子双向通道。经内存树寻址（findThreadInScope）定位对端，
 *   直接写其 inbox + 自己 outbox（同 session 同 job、不付磁盘 IO）。
 * - **peer 会话窗**：跨对象通道。走 talk-delivery 磁盘派送（deliverTalkMessage）。
 *
 * 逻辑落在 thread builtin（say 归 thread）；talk / reflect_request 的 say method 共享同一实现（薄 delegation）。
 */
import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types.js";
import type { TalkWindow } from "@ooc/core/extendable/_shared/types.js";
import { appendInbox, findThreadInScope, makeMessage } from "@ooc/core/executable/windows/talk/fork.js";

/**
 * fork 子线程窗的 say —— 内存树寻址派送。
 *
 * 同 session 同 job、不付磁盘 IO：经 findThreadInScope 在内存 childThreads/_parentThreadRef
 * 树里定位对端（父→子 或 子→父），直接写其 inbox + 自己 outbox。
 */
async function sayToForkWindow(ctx: MethodExecutionContext, window: TalkWindow): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  const targetThreadId = window.targetThreadId;
  if (!targetThreadId) return "[thread.say] fork 子线程窗缺少 targetThreadId。";
  const target = findThreadInScope(thread, targetThreadId);
  if (!target) {
    return `[thread.say] 找不到目标线程 ${targetThreadId}。`;
  }

  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[thread.say] 缺少 msg。";

  const message = makeMessage(thread.id, targetThreadId, content);
  appendInbox(target, message);
  if (target.status === "done" || target.status === "failed") {
    target.status = "running";
  }
  thread.outbox = [...(thread.outbox ?? []), message];

  if (ctx.args.wait === true) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
    thread.waitingOn = window.id;
  }

  if (target.persistence) {
    // observable/index 深依赖 persistable → windows-barrel；顶层 import 会与 talk/index.ts 形成
    // eval-期循环（见 sayToPeerWindow 内同样的延后理由）。
    const { notifyThreadActivated } = await import("@ooc/core/observable/index.js");
    notifyThreadActivated({
      sessionId: target.persistence.sessionId,
      objectId: target.persistence.objectId,
      threadId: target.id,
    });
  }
  return undefined;
}

/** peer 会话窗的 say —— talk-delivery 磁盘派送（跨对象）。 */
async function sayToPeerWindow(ctx: MethodExecutionContext, window: TalkWindow): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[thread.say] 缺少 thread context。";
  if (!thread.persistence) {
    return "[thread.say] 当前 thread 无 persistence ref，无法跨对象派送。";
  }
  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[thread.say] 缺少 msg。";

  try {
    // 派送实现深依赖 persistable → windows-barrel；在 say.js 顶层 import 会与 talk/index.ts 形成
    // eval-期循环（talk 注册 say → say 拉 delivery → delivery 拉 windows-barrel → talk）。
    // 延后到调用期 import 断开该环（peer 路径本就 async，无运行时代价）。
    const { deliverTalkMessage } = await import("@ooc/core/executable/windows/talk/delivery.js");
    await deliverTalkMessage({
      caller: { thread, talkWindow: window },
      content,
      source: "talk",
    });
  } catch (err) {
    return `[thread.say] 派送失败：${(err as Error).message}`;
  }

  if (ctx.args.wait === true) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
    thread.waitingOn = window.id;
  }
  return undefined;
}

/**
 * say 的真正逻辑：据 ctx.self（会话窗）形态分流。
 *
 * ctx.self 是发送选用的会话窗（fork 子窗 / peer 窗 / reflect_request 同形窗）；
 * fork 走内存树派送，peer 走磁盘 talk-delivery。
 */
export async function executeSay(ctx: MethodExecutionContext): Promise<string | undefined> {
  const window = ctx.self as TalkWindow;
  return window.isForkWindow
    ? sayToForkWindow(ctx, window)
    : sayToPeerWindow(ctx, window);
}
