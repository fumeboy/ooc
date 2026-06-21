/**
 * thread —— 会话 object method（say）。
 *
 * thread 是唯一会话载体注册 class（context.md 核心 2/8/9）；所有会话窗（creator/peer/sub/fork）
 * 都是 thread 实例。会话 method 归 thread：
 *   - say : 发一条消息给对端（peer 走磁盘 talk-delivery / fork 走内存树派送）
 *
 * 注：**wait 是 3 原语之一（非 method）**——经 `core/executable/tools/wait.ts` 独立 tool 入口表达。
 * 关窗也是原语（`core/executable/tools/close.ts`）、**不是** thread method——关一个 fork 子线程窗经
 * refcount 归 0 触发 thread.unactive（通知「无订阅者」、自决），见 `index.ts`。
 *
 * 签名 `(ctx, self=Data, args)`：self 是会话窗状态（target / targetThreadId / isForkWindow），
 * ctx.object.id 是窗实例 id（= 会话身份），ctx.thread 是当前执行 thread。
 * say 的 delivery / fork 派送实现物保留在 core talk 域，本类 import 复用。
 *
 * deferred（agency 深层 thinkloop 语义，登记 WAVE4-WALL-broken-tests.md）：say 的 fork 派送完整
 * 运行时语义（子 thread thinkloop 启动、end 经 say 回报）仍依赖 scheduler/worker 协作，本轮保留
 * 行为骨架（写双方 inbox/outbox + 事件），不在 method 内闭合完整调度。
 */
import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import type { ThreadContext, ThreadMessage } from "@ooc/core/thinkable/context.js";
import { deliverTalkMessage } from "@ooc/builtins/agent/thread/executable/talk-delivery.js";
import {
  findThreadInScope,
  makeMessage,
  appendInbox,
} from "@ooc/builtins/agent/thread/executable/talk-fork.js";
import type { TalkWindowView } from "@ooc/builtins/agent/thread/types.js";
import type { Data } from "../types.js";

// ─────────────────────────── say ──────────────────────────────

const SAY_SCHEMA: MethodCallSchema = {
  args: {
    msg: { type: "string", required: true, description: "要发给对端的消息正文" },
  },
};

/**
 * 把当前会话窗的状态 + 实例 id 还原成 delivery 期望的扁平 TalkWindow 视图。
 * delivery 只读 id / target / targetThreadId（并回填 targetThreadId）；creator 窗身份由 id 派生。
 */
function asTalkWindowView(objectId: string, self: Data): TalkWindowView {
  return {
    id: objectId,
    class: "_builtin/agent/thread",
    target: self.target,
    targetThreadId: self.targetThreadId,
    isForkWindow: self.isForkWindow,
  } as TalkWindowView;
}

async function executeSay(
  ctx: ExecutableContext,
  self: Data,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[thread.say] 缺少 thread context。";
  const content = typeof args.msg === "string" ? args.msg : "";
  if (!content.trim()) return "[thread.say] 缺少 msg 参数（消息正文）。";

  // fork 子线程窗：走内存树寻址（同 session 同 job、不付磁盘 IO）。
  if (self.isForkWindow) {
    return sayToForkPeer(ctx, self, content);
  }

  // peer 会话窗：走磁盘 talk-delivery。
  const view = asTalkWindowView(ctx.object.id, self);
  const result = await deliverTalkMessage({
    caller: { thread, talkWindow: view },
    content,
    source: "talk",
  });
  // delivery 可能回填 targetThreadId（peer 首条 say）——同步回业务数据。
  if (view.targetThreadId && view.targetThreadId !== self.targetThreadId) {
    self.targetThreadId = view.targetThreadId;
    await ctx.reportDataEdit?.();
  }
  return `[thread.say] 已发送给 ${result.calleeObjectId}（thread=${result.calleeThreadId}）。`;
}

/** fork 子窗 say：在内存线程树里寻址对端（子或父），写双方消息。 */
function sayToForkPeer(
  ctx: ExecutableContext,
  self: Data,
  content: string,
): string | undefined {
  const thread = ctx.thread as ThreadContext;
  const targetThreadId = self.targetThreadId;
  if (!targetThreadId) return "[thread.say] fork 子窗缺少 targetThreadId。";
  const peer = findThreadInScope(thread, targetThreadId);
  if (!peer) return `[thread.say] 找不到对端 thread "${targetThreadId}"。`;

  const message: ThreadMessage = makeMessage(thread.id, peer.id, content);
  message.windowId = ctx.object.id;
  thread.outbox = [...(thread.outbox ?? []), message];
  appendInbox(peer, message);

  // 对端若处于非 running/paused → 翻回 running，等 scheduler 调度。
  if (peer.status !== "running" && peer.status !== "paused") {
    peer.status = "running";
    peer.inboxSnapshotAtWait = undefined;
    peer.waitingOn = undefined;
  }
  return `[thread.say] 已发送给 fork 对端 thread "${peer.id}"。`;
}

export const sayMethod: ObjectMethod<Data> = {
  name: "say",
  description:
    "Send a message to the peer. Peer conversation → disk talk-delivery; fork child window → in-memory thread-tree delivery.",
  schema: SAY_SCHEMA,
  permission: () => "allow",
  public: true,
  exec: (ctx, self, args) => executeSay(ctx, self, args),
};

export const sessionMethods: ObjectMethod<Data>[] = [sayMethod];
