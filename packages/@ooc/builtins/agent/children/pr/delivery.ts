/**
 * pr-window delivery —— 把一条 feat-branch PR 呈现给每个 reviewer + 失败回修 message 回投。
 *
 * reflectable 沉淀（窗口 + 回修）：
 *
 * - `deliverPrWindowToReviewers`：create_pr_and_invite_reviewers 开 PR 后，给每个 reviewer 的 super-session
 *   pr-review thread 投递一条 pr_window（既有 inline window + inbox_message_arrived 机制）。
 *   thread id 由 (reviewerObjectId, issueId) 确定派生——同一 PR 重复投递幂等更新同一 thread，
 *   不堆叠重复窗口。supervisor 恒在 reviewer 集，故其评审入口天然可用。
 *
 * - `routePrRepairMessage`：reject / request-changes / 合入失败时，把 verdict + reviewer 反馈
 *   作为一条 inbox 消息回投到发起沉淀的 super(foo) thread（author 在 super session 的 thread），
 *   翻其 status→running 让 worker 续跑，super(foo) 据此 resume 修复（见 method.new-feat-branch
 *   resume 重绑路径）。复用既有 inbox 投递 + notifyThreadActivated，不发明新通道。
 *
 * 不发明新名词：pr_window 是 collaborable window 家族成员；回修走 inbox/talk 既有投递。
 */

import { stat } from "node:fs/promises";
import {
  createFlowObject,
  createFlowSession,
  sessionMetadataFile,
} from "@ooc/core/persistable/index.js";
import { readThread, writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";
import { notifyThreadActivated } from "@ooc/core/observable/index.js";
import { SUPER_SESSION_ID, PR_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { ROOT_WINDOW_ID } from "@ooc/core/_shared/types/context-window.js";
import { materializeWindow } from "@ooc/core/runtime/session-object-table.js";
import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/thread/types.js";
import type { Data as PrData } from "./types.js";

/** pr_window 的稳定 id：同一 reviewer 看同一 PR 复用同一 window（幂等更新，不堆叠）。 */
export function prWindowId(issueId: number): string {
  return `prw_${issueId}`;
}

/** reviewer 在 super session 下专收某 PR 的 pr-review thread id（确定派生，幂等）。 */
export function prReviewThreadId(reviewerObjectId: string, issueId: number): string {
  return `t_prreview_${reviewerObjectId.replace(/\//g, "_")}_${issueId}`;
}

function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

export interface DeliverPrWindowInput {
  baseDir: string;
  issueId: number;
  /** reviewer objectId 列表（PR record.reviewers）。 */
  reviewers: string[];
  /** 发起沉淀的 author（super(foo) 的 foo）；reject 时回投目标。 */
  authorObjectId: string;
  /** author 发起沉淀的 super(foo) threadId（回投定位）。 */
  authorThreadId?: string;
  /** PR 标题（pr_window title）。 */
  title: string;
}

export interface DeliverPrWindowResult {
  delivered: Array<{ reviewerObjectId: string; threadId: string; windowId: string }>;
}

/**
 * 给每个 reviewer 的 super-session pr-review thread 投递（或幂等更新）一条 pr_window。
 *
 * thread 不存在则创建（createFlowObject + 首次出现时建 super .session.json）；window 按
 * prWindowId(issueId) 去重——已存在则替换（更新 reviewers/approvals 在 render 时实时读 record，
 * window 自身只持 issueId，故"更新"主要是确保 window 在场 + 重新 push inbox 事件提醒 reviewer）。
 */
export async function deliverPrWindowToReviewers(
  input: DeliverPrWindowInput,
): Promise<DeliverPrWindowResult> {
  const { baseDir, issueId, reviewers, authorObjectId, authorThreadId, title } = input;
  const delivered: DeliverPrWindowResult["delivered"] = [];

  // super .session.json 首次出现时建（与 talk-delivery 一致，避免覆盖既有 title）。
  if (!(await pathExists(sessionMetadataFile(baseDir, SUPER_SESSION_ID)))) {
    await createFlowSession(baseDir, SUPER_SESSION_ID, "OOC self-reflection");
  }

  for (const reviewerObjectId of reviewers) {
    const threadId = prReviewThreadId(reviewerObjectId, issueId);
    await createFlowObject({ baseDir, sessionId: SUPER_SESSION_ID, objectId: reviewerObjectId });

    let thread = await readThread(
      { baseDir, sessionId: SUPER_SESSION_ID, objectId: reviewerObjectId },
      threadId,
    );
    if (!thread) {
      thread = {
        id: threadId,
        status: "running",
        events: [],
        contextWindows: [],
        persistence: { baseDir, sessionId: SUPER_SESSION_ID, objectId: reviewerObjectId, threadId },
      };
    }

    const windowId = prWindowId(issueId);
    // 对象/窗拆分：窗 = OocObjectRef（视角态在顶层）；对象身份（class + 业务 data）入 session
    // 对象表。materializeWindow 一处登记对象 + 返回纯 ref。pr 业务字段
    // （issueId/reviewerObjectId/authorObjectId/authorThreadId）落 PrData。
    const prInstance = materializeWindow(thread, {
      id: windowId,
      parentWindowId: ROOT_WINDOW_ID,
      title,
      status: "open",
      createdAt: Date.now(),
      // 注册 class id（非投影名 "pr"）——否则 createFlowObject/hydrate 解析不到 class，
      // pr 窗过不了持久化 round-trip、reload 后被 drop（pr readable 才把它投影成 "pr"）。
      class: PR_CLASS_ID,
      data: {
        issueId,
        reviewerObjectId,
        authorObjectId,
        ...(authorThreadId ? { authorThreadId } : {}),
      } satisfies PrData,
    });

    const windows = (thread.contextWindows ?? []).filter((w) => w.id !== windowId);
    thread.contextWindows = [...windows, prInstance];

    // push inbox_message_arrived 让 reviewer LLM 看到「有新 PR 待审」（与 talk-delivery 一致）。
    const messageId = generateMessageId();
    thread.events = [
      ...thread.events,
      { category: "context_change", kind: "inbox_message_arrived", msgId: messageId },
    ];
    if (thread.status !== "running" && thread.status !== "paused") {
      thread.status = "running";
      thread.inboxSnapshotAtWait = undefined;
      thread.waitingOn = undefined;
    }

    await writeThread(thread);
    notifyThreadActivated({ sessionId: SUPER_SESSION_ID, objectId: reviewerObjectId, threadId });
    delivered.push({ reviewerObjectId, threadId, windowId });
  }

  return { delivered };
}

export interface RoutePrRepairMessageInput {
  baseDir: string;
  /** super(foo) 的 author objectId（= foo）。 */
  authorObjectId: string;
  /** super(foo) threadId（PR 开启时记录的发起 thread）。 */
  authorThreadId: string;
  /** 回修原因正文（verdict + reviewer 反馈 / 合入失败信息）。 */
  reason: string;
}

export type RoutePrRepairMessageResult =
  | { ok: true; threadId: string; messageId: string }
  | { ok: false; code: "NO_AUTHOR_THREAD"; message: string };

/**
 * 把 verdict + reviewer 反馈作为一条 inbox 消息回投到 super(foo) thread，翻其
 * status→running 让 worker 续跑（resume 修复）。author thread 必须已存在（PR 由它开启）；
 * 找不到 → fail-loud（NO_AUTHOR_THREAD），不静默吞。
 */
export async function routePrRepairMessage(
  input: RoutePrRepairMessageInput,
): Promise<RoutePrRepairMessageResult> {
  const { baseDir, authorObjectId, authorThreadId, reason } = input;
  if (!authorThreadId || !authorThreadId.trim()) {
    return { ok: false, code: "NO_AUTHOR_THREAD", message: "authorThreadId required for repair routing" };
  }
  const thread = await readThread(
    { baseDir, sessionId: SUPER_SESSION_ID, objectId: authorObjectId },
    authorThreadId,
  );
  if (!thread) {
    return {
      ok: false,
      code: "NO_AUTHOR_THREAD",
      message: `super(${authorObjectId}) thread '${authorThreadId}' not found for repair routing`,
    };
  }

  const messageId = generateMessageId();
  const message: ThreadMessage = {
    id: messageId,
    fromThreadId: authorThreadId,
    toThreadId: authorThreadId,
    fromObjectId: "supervisor",
    content: reason,
    createdAt: Date.now(),
    source: "user",
  };
  thread.inbox = [...(thread.inbox ?? []), message];
  thread.events = [
    ...thread.events,
    { category: "context_change", kind: "inbox_message_arrived", msgId: messageId },
  ];
  if (thread.status !== "running" && thread.status !== "paused") {
    thread.status = "running";
    thread.inboxSnapshotAtWait = undefined;
    thread.waitingOn = undefined;
  }
  await writeThread(thread as ThreadContext);
  notifyThreadActivated({
    sessionId: SUPER_SESSION_ID,
    objectId: authorObjectId,
    threadId: authorThreadId,
  });
  return { ok: true, threadId: authorThreadId, messageId };
}
