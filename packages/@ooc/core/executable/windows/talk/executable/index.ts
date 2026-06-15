/**
 * talk —— executable 维度（会话 3 原语之一 say + close + share 作为 object method）。
 *
 * talk 是所有会话 class 的基类（thread / reflect_request 经 class 链继承它的会话行为）。
 * 它提供会话的 object method：
 *   - say   : 发一条消息给对端（peer 走磁盘 talk-delivery / fork 走内存树派送）
 *   - close : 关本会话窗（fork 子窗 close → archive 子线程；creator 窗不可关）
 *   - share : 跨 thread 传 window 引用（仅 fork 子线程窗可用）
 *
 * 注：**wait 是 3 原语之一（非 method）**——经 `executable/tools/wait.ts` 独立 tool 入口表达，
 * 保持原语地位，不在此注册为 object method。
 *
 * 签名 `(ctx, self=TalkData, args)`：self 是会话窗的业务数据（target / targetThreadId /
 * isForkWindow / isCreatorWindow / conversationId），ctx.object.id 是窗实例 id，ctx.thread 是
 * 当前执行 thread。
 *
 * deferred（agency 深层 thinkloop 语义，登记 WAVE4-WALL-broken-tests.md）：say 的 fork 派送
 * 完整运行时语义（子 thread thinkloop 启动、end 经 say 回报）仍依赖 scheduler/worker 协作，
 * 本轮保留行为骨架（写双方 inbox/outbox + 事件），不在 method 内闭合完整调度。
 */
import type {
  ExecutableContext,
  ExecutableModule,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import type { ThreadContext, ThreadMessage } from "@ooc/core/thinkable/context.js";
import type { TalkData, TalkWindowView } from "../types.js";
import { deliverTalkMessage } from "../delivery.js";
import { archiveForkChild, findThreadInScope, makeMessage, appendInbox } from "../fork.js";

// ─────────────────────────── say ──────────────────────────────

const SAY_SCHEMA: MethodCallSchema = {
  args: {
    msg: { type: "string", required: true, description: "要发给对端的消息正文" },
  },
};

/**
 * 把当前会话窗的业务数据 + 实例 id 还原成 delivery 期望的扁平 TalkWindow 视图。
 * delivery 只读 id / target / targetThreadId / isCreatorWindow（并回填 targetThreadId）。
 */
function asTalkWindowView(objectId: string, self: TalkData): TalkWindowView {
  return {
    id: objectId,
    class: "talk",
    target: self.target,
    targetThreadId: self.targetThreadId,
    isForkWindow: self.isForkWindow,
    isCreatorWindow: self.isCreatorWindow,
    conversationId: self.conversationId,
  } as TalkWindowView;
}

async function executeSay(
  ctx: ExecutableContext,
  self: TalkData,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk.say] 缺少 thread context。";
  const content = typeof args.msg === "string" ? args.msg : "";
  if (!content.trim()) return "[talk.say] 缺少 msg 参数（消息正文）。";

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
  return `[talk.say] 已发送给 ${result.calleeObjectId}（thread=${result.calleeThreadId}）。`;
}

/** fork 子窗 say：在内存线程树里寻址对端（子或父），写双方消息。 */
function sayToForkPeer(
  ctx: ExecutableContext,
  self: TalkData,
  content: string,
): string | undefined {
  const thread = ctx.thread as ThreadContext;
  const targetThreadId = self.targetThreadId;
  if (!targetThreadId) return "[talk.say] fork 子窗缺少 targetThreadId。";
  const peer = findThreadInScope(thread, targetThreadId);
  if (!peer) return `[talk.say] 找不到对端 thread "${targetThreadId}"。`;

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
  return `[talk.say] 已发送给 fork 对端 thread "${peer.id}"。`;
}

export const sayMethod: ObjectMethod<TalkData> = {
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

const closeMethod: ObjectMethod<TalkData> = {
  name: "close",
  description:
    "Close this talk_window. Fork child windows archive the child thread; the creator talk_window cannot be closed.",
  permission: () => "allow",
  exec: (ctx, self) => {
    if (self.isCreatorWindow) {
      return `[talk.close] window "${ctx.object.id}" 是初始 creator 会话窗，与 caller 的恒在通道，不可关闭。`;
    }
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

/**
 * share —— 跨 thread 传 window 引用（仅 fork 子线程窗可用）。
 *
 * deferred（WAVE4-WALL-broken-tests.md）：旧 share 的所有权借/还机制依赖每窗 `sharing` 字段
 * （SharingState，新契约已删）+ ContextWindow 平铺 struct。新 OocObjectInstance 模型下，
 * window 引用的「借/还/move 所有权」语义需要重新设计（哪个 thread 持有实例、引用如何投影），
 * 牵连过深，本轮**只保留骨架 + 报告未支持**，不在 method 内做 sharing 字段写入。
 */
const shareMethod: ObjectMethod<TalkData> = {
  name: "share",
  description:
    "Share (readonly-ref) or transfer ownership (move) of a window to the forked child/parent thread.",
  schema: {
    args: {
      window_id: { type: "string", required: true, description: "要传的 window id" },
      mode: { type: "string", required: true, description: '"readonly-ref" 只读借用；"move" 移交所有权' },
    },
  },
  exec: (_ctx, self) => {
    if (!self.isForkWindow) {
      return "[talk.share] share 只能在 fork 子线程窗（同对象父子通道）上调用。";
    }
    return "[talk.share] window 引用借/还机制正随对象模型重构（OocObjectInstance）重新设计，暂未支持（WAVE4 待续）。";
  },
};

const executable: ExecutableModule<TalkData> = {
  methods: [sayMethod, closeMethod, shareMethod],
};

export default executable;
