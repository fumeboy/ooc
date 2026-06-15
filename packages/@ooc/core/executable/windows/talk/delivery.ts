/**
 * talk-delivery — 跨对象 talk 消息派送的统一入口。
 *
 * collaborable cross-object talk：
 *
 * 一次"派送"做以下 5 件事：
 *
 * 1. 解析 caller 与 target：caller = ctx.thread + ctx.talkWindow；target = talkWindow.target
 *    （objectId）。两者必须都带 persistence ref。
 *
 *    **target="super" 自指别名**（super-flow-channel）：
 *    callerWindow.target === "super" 时翻译为
 *    `(calleeObjectId = caller.objectId, calleeSessionId = "super")`——派送到
 *    自己的 super 分身。这是跨 session 派送（caller 的当前 session 与 "super" 不同），
 *    talk-delivery 不再约束 caller/callee 同 session。
 *
 * 2. 解析或创建 callee thread：
 *    - 若 talkWindow.targetThreadId 已设置 → readThread 拿到 callee
 *    - 否则 → createFlowObject(callee) 兜底（已存在则 no-op），新建一条 thread，
 *      thread id 由派送时生成；callee 携带 creatorObjectId=caller object，
 *      initContextWindows 据此自动注入指向 caller 的 creator talk_window
 *    - 跨 session 派送（如 super alias）：必要时 createFlowSession 创建目标 session 目录
 *    - callee 创建好后 talkWindow.targetThreadId 回填，让下次 say 直接命中已有 thread
 *
 * 3. 写消息：
 *    - caller.outbox 追加一条 source（talk|user）的 ThreadMessage（windowId=caller talk_window.id）
 *    - callee.inbox 追加同一条消息（replyToWindowId=callee creator talk_window.id），
 *      并 push inbox_message_arrived 事件让 LLM 看到
 *
 * 4. callee 状态：若 callee 处于 waiting/done/failed → 翻回 running，等 worker 调度
 *
 * 5. 持久化：caller / callee 双写 thread.json
 *
 * 不在本模块负责：调度（由 worker 自然轮询）、UI 通知（控制面自己决定何时 refresh）。
 */

import { readThread, writeThread, createFlowObject, createFlowSession, sessionMetadataFile, resolveSuperActor } from "../../../persistable/index.js";
import { stat } from "node:fs/promises";
import { notifyThreadActivated } from "../../../observable/index.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import { initContextWindows, injectPeerWindowsIfObjectThread, injectMemberWindowsIfObjectThread } from "../_shared/init.js";
import { isSuperSessionId, SUPER_SESSION_ID, isTalkLikeClass } from "@ooc/core/_shared/types/constants.js";
import { creatorWindowIdOf, type TalkWindow } from "../_shared/types.js";
import type { TalkData } from "./types.js";

export interface TalkDeliveryInput {
  caller: { thread: ThreadContext; talkWindow: TalkWindow };
  content: string;
  /** 消息来源：talk = LLM 通过 talk_window.say 发；user = 控制面代用户发。 */
  source: "talk" | "user";
}

export interface TalkDeliveryResult {
  calleeObjectId: string;
  calleeThreadId: string;
  /** 本次写入到 caller.outbox 的消息 id（也作为 callee.inbox 的对应消息 id）。 */
  messageId: string;
}

/** 生成稳定的消息 id；caller / callee 双方记录同一个 id 便于跨 thread 关联。 */
function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 生成新 callee thread 的 id。 */
function generateCalleeThreadId(callerObjectId: string): string {
  // 前缀含 caller 信息，纯做调试可读性；唯一性靠后缀
  return `t_${callerObjectId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 截断标题。 */
function deriveCalleeThreadTitle(content: string, max = 60): string {
  const trimmed = content.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

export async function deliverTalkMessage(input: TalkDeliveryInput): Promise<TalkDeliveryResult> {
  const { caller, content, source } = input;
  const callerThread = caller.thread;
  const callerWindow = caller.talkWindow;
  if (!callerThread.persistence) {
    throw new Error("caller thread has no persistence ref");
  }

  const callerRef = callerThread.persistence;
  const rawTarget = callerWindow.target;
  if (!rawTarget) throw new Error("talk_window.target is empty");

  const isSuperAlias = isSuperSessionId(rawTarget);
  // super-alias 的 callee = super-flow actor。canonical caller → 自身（透明，自我演化不变）；
  // 新对象（仅 session 内、未 canonical）→ 冒泡到最近 canonical 祖先（顶层兜底 supervisor），
  // 由其以 super flow 身份代为把新对象首版经 feat-branch PR 沉淀进 main（author=祖先，
  // ensureAuthorExists 自然通过）。必须与 worker.ts:syncCrossObjectCalleeEnds 严格一致（同 helper）。
  const calleeObjectId = isSuperAlias
    ? await resolveSuperActor(callerRef.baseDir, callerRef.objectId)
    : rawTarget;
  // session 解析：
  // - super-alias（X→super）：派进 super session
  // - 默认：派进 caller 自身 session（同 session 协作）
  // - **cross-session creator reply**：当本次派送是「通过 creator talk_window 回报创建者」
  //   且创建者在另一个 session（callerThread.creatorSessionId 与自身 session 不同，典型
  //   super-alice 在 "super" session 回报 user-session 的创建者）→ 派回 creatorSessionId。
  //   这条覆盖 reflectable super→origin 回报通道：creator talk_window 必须能跨 session
  //   找到创建者 thread，否则 readThread(calleeSessionId=自身 session) 永远找不到对端。
  const isCreatorReply = callerWindow.isCreatorWindow === true && callerWindow.target === callerRef.objectId;
  const crossSessionCreatorReply =
    isCreatorReply &&
    callerThread.creatorSessionId !== undefined &&
    callerThread.creatorSessionId !== callerRef.sessionId;
  const calleeSessionId = isSuperAlias
    ? SUPER_SESSION_ID
    : crossSessionCreatorReply
      ? callerThread.creatorSessionId!
      : callerRef.sessionId;

  // 1) 解析 callee thread；首条消息时创建
  let calleeThreadId = callerWindow.targetThreadId;
  let calleeThread: ThreadContext | undefined;

  if (calleeThreadId) {
    calleeThread = await readThread(
      { baseDir: callerRef.baseDir, sessionId: calleeSessionId, objectId: calleeObjectId },
      calleeThreadId,
    );
  }

  if (!calleeThread) {
    // super session 第一次出现时才创建 .session.json；已存在不重写（避免覆盖
    // 既有 title）
    if (isSuperAlias && !(await pathExists(sessionMetadataFile(callerRef.baseDir, SUPER_SESSION_ID)))) {
      await createFlowSession(callerRef.baseDir, SUPER_SESSION_ID, "OOC self-reflection");
    }

    await createFlowObject({
      baseDir: callerRef.baseDir,
      sessionId: calleeSessionId,
      objectId: calleeObjectId,
    });

    calleeThreadId = generateCalleeThreadId(callerRef.objectId);
    calleeThread = {
      id: calleeThreadId,
      status: "running",
      events: [],
      contextWindows: [],
      creatorThreadId: callerThread.id,
      creatorObjectId: callerRef.objectId,
      // cross-session 派送时记录 caller 的 sessionId，
      // 让后续 end({result}) auto-reply 知道把通知派回原 session
      // （super-alias 场景下 callee.persistence.sessionId === "super"，但 caller
      // 在 user session；缺这字段 notify 会找错 session）。
      creatorSessionId: callerRef.sessionId,
      persistence: {
        baseDir: callerRef.baseDir,
        sessionId: calleeSessionId,
        objectId: calleeObjectId,
        threadId: calleeThreadId,
      },
    };
    initContextWindows(calleeThread, {
      creatorThreadId: callerThread.id,
      initialTaskTitle: deriveCalleeThreadTitle(content),
    });
    await injectPeerWindowsIfObjectThread(calleeThread);
    await injectMemberWindowsIfObjectThread(calleeThread);

    // 早些时候这里还 spawn 过一条 "回复创建者" todo 用作文本 nudge。
    // 现在结构性约束（wait 要求 on=合法 IO 来源 window）已接管它的作用——
    // LLM 不 say 就 wait 会直接 reject。todo 撤除以避免"双保险"带来的冗余。
    // 回填 caller talk_window.targetThreadId
    callerWindow.targetThreadId = calleeThreadId;
  }

  // 2) 构造消息：双方共享同一个 message id；caller 视图、callee 视图各自的 windowId 不同
  const messageId = generateMessageId();
  const calleeReplyToWindowId = resolveCalleeReplyToWindowId(calleeThread, callerThread.id, callerRef.objectId);
  const createdAt = Date.now();

  const callerMessage: ThreadMessage = {
    id: messageId,
    fromThreadId: callerThread.id,
    toThreadId: calleeThread.id,
    fromObjectId: callerRef.objectId,
    content,
    createdAt,
    source,
    windowId: callerWindow.id,
  };
  const calleeMessage: ThreadMessage = {
    ...callerMessage,
    // callee 视角下,replyToWindowId 决定这条消息归到 callee 哪个 talk window 的 transcript。
    // 见 resolveCalleeReplyToWindowId 的注释:精确按 callerThreadId → fallback 按 objectId →
    // fallback 到 callee 的 creator talk window(初次创建场景)。
    replyToWindowId: calleeReplyToWindowId,
  };

  callerThread.outbox = [...(callerThread.outbox ?? []), callerMessage];
  calleeThread.inbox = [...(calleeThread.inbox ?? []), calleeMessage];
  calleeThread.events = [
    ...calleeThread.events,
    { category: "context_change", kind: "inbox_message_arrived", msgId: messageId },
  ];

  // 3) callee 状态：waiting/done/failed → running；inboxSnapshotAtWait / waitingOn 清空
  if (calleeThread.status !== "running" && calleeThread.status !== "paused") {
    calleeThread.status = "running";
    calleeThread.inboxSnapshotAtWait = undefined;
    calleeThread.waitingOn = undefined;
  }

  // 4) 持久化双方
  await writeThread(callerThread);
  await writeThread(calleeThread);

  // 5) 状态翻转 → 通知 runtime。callback 自己决定要不要入队 worker。
  //    历史上这里对 user 短路（避免 user 被 worker 跑），现在改在 buildServer 的
  //    setThreadActivationNotifier callback 里判 user 后跳过 jobManager —
  //    talk-delivery 总是发 notify，让 lark event-relay 等订阅方都能收到 user 激活信号。
  notifyThreadActivated({
    sessionId: calleeSessionId,
    objectId: calleeObjectId,
    threadId: calleeThread.id,
  });

  return {
    calleeObjectId,
    calleeThreadId: calleeThread.id,
    messageId,
  };
}

/**
 * 在 callee 的 contextWindows 里找出"这条入站消息归属的 talk_window id"。
 *
 * 用作 calleeMessage.replyToWindowId,决定 transcript 视图归位:
 *   filterMessagesForTalkWindow 的入站规则是 `m.replyToWindowId === self.id`。
 *
 * 老实现硬写为 callee 的 creator talk_window (creatorWindowIdOf(calleeThread.id))。
 * 在 user→callee 的初次派送 OK,但 callee 自己也当 caller 时(典型:assistant 派给 critic,
 * critic 回 assistant) 会把回信错误地塞到 callee 的 creator window(target=user) 上,
 * 与 user 完全无关的消息显示成 user 的消息,且对应的 caller→callee talk_window 反而
 * 看不到回信。
 *
 * 正确解析优先级:
 *   1. callee 的 talk_window 中 targetThreadId === callerThread.id  → 精确命中本条 conversation
 *   2. callee 的 talk_window 中 target === callerRef.objectId 且未匹配过      → 对象级 fallback
 *   3. callee 的 creator talk_window                                       → 初次创建场景
 */
function resolveCalleeReplyToWindowId(
  calleeThread: ThreadContext,
  callerThreadId: string,
  callerObjectId: string,
): string {
  // Wave 4：contextWindows 元素是 OocObjectInstance（信封 + data 分离）；会话业务字段
  // （target / targetThreadId）落 inst.data（=TalkData）。会话窗（talk + reflect_request
  // self-view）按 inst.class 识别，回信归位字段从 inst.data 读。
  const windows = (calleeThread.contextWindows ?? [])
    .filter((inst) => isTalkLikeClass(inst.class))
    .map((inst) => ({ id: inst.id, data: (inst.data ?? {}) as TalkData }));
  const byThreadId = windows.find((w) => w.data.targetThreadId === callerThreadId);
  if (byThreadId) return byThreadId.id;
  const byObjectId = windows.find((w) => w.data.target === callerObjectId);
  if (byObjectId) return byObjectId.id;
  return creatorWindowIdOf(calleeThread.id);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
