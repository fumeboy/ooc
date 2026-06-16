/**
 * thread —— 会话 object method（say / close / share）。
 *
 * thread 是唯一会话载体注册 class（context.md 核心 2/8/9）；所有会话窗（creator/peer/sub/fork）
 * 都是 thread 实例。这三个会话 method 全部归 thread：
 *   - say   : 发一条消息给对端（peer 走磁盘 talk-delivery / fork 走内存树派送）
 *   - close : 关本会话窗（fork 子窗 close → archive 子线程；creator 窗不可关）
 *   - share : 跨 thread 传 window 引用（仅 fork 子线程窗可用）
 *
 * 注：**wait 是 3 原语之一（非 method）**——经 `core/executable/tools/wait.ts` 独立 tool 入口表达。
 *
 * 签名 `(ctx, self=Data, args)`：self 是会话窗状态（target / targetThreadId / isForkWindow /
 * conversationId），ctx.object.id 是窗实例 id，ctx.thread 是当前执行 thread。creator 窗（self-view）
 * 不可 close 由 readable 投影可见性表达（不 surface close），不在 method 内查 flag。
 * say/close 的 delivery / fork 派送实现物保留在 core talk 域，本类 import 复用。
 *
 * deferred（agency 深层 thinkloop 语义，登记 WAVE4-WALL-broken-tests.md）：say 的 fork 派送完整
 * 运行时语义（子 thread thinkloop 启动、end 经 say 回报）仍依赖 scheduler/worker 协作，本轮保留
 * 行为骨架（写双方 inbox/outbox + 事件），不在 method 内闭合完整调度。share 的 owner 借/还机制随
 * 对象模型重构重新设计，本轮只保留骨架 + 报告未支持。
 */
import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import type { ThreadContext, ThreadMessage } from "@ooc/core/thinkable/context.js";
import { deliverTalkMessage } from "@ooc/builtins/agent/thread/executable/talk-delivery.js";
import {
  archiveForkChild,
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
    conversationId: self.conversationId,
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
  for_ui_access: true,
  exec: (ctx, self, args) => executeSay(ctx, self, args),
};

// ─────────────────────────── close ──────────────────────────────

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description:
    "Close this talk_window. Fork child windows archive the child thread.",
  permission: () => "allow",
  exec: (ctx, self) => {
    // creator 窗（self-view）不可关 —— 由 readable 投影可见性表达（thread/reflect_request 不 surface
    // close），故本 impl 只服务 talk（other-view）窗，不再做 isCreatorWindow 运行时检查。
    // fork 子线程窗 close → archive 对应子线程（peer 会话窗纯关窗，无副作用）。
    if (self.isForkWindow && ctx.thread) {
      archiveForkChild(ctx.thread, asTalkWindowView(ctx.object.id, self));
    }
    // 实例移除经 runtime（close primitive / WindowManager.close）；此处只负责副作用。
    void ctx.runtime?.close?.(ctx.object.id);
    return undefined;
  },
};

// ─────────────────────────── share ──────────────────────────────

const shareMethod: ObjectMethod<Data> = {
  name: "share",
  description:
    "Share (readonly-ref) or transfer ownership (move) of a window to the forked child/parent thread.",
  schema: {
    args: {
      window_id: { type: "string", required: true, description: "要传的 window id" },
      mode: { type: "string", required: true, description: '"readonly-ref" 只读借用；"move" 移交所有权' },
    },
  },
  exec: (_ctx, self: Data) => {
    if (!self.isForkWindow) {
      return "[thread.share] share 只能在 fork 子线程窗（同对象父子通道）上调用。";
    }
    return "[thread.share] window 引用借/还机制正随对象模型重构（OocObjectInstance）重新设计，暂未支持（WAVE4 待续）。";
  },
};

export const sessionMethods: ObjectMethod<Data>[] = [
  sayMethod,
  closeMethod,
  shareMethod,
];
