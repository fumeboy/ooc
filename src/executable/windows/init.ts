/**
 * Thread 初始化 helper — 给任何新建 thread 注入指向 creator 的初始 window。
 *
 * spec § 初始 creator 对话 window：每个 thread 启动时必有一条与创建方的恒在通道。
 *
 * Creator window 类型由 thread 本身决定，不再由调用方指定：
 * - thread.creatorObjectId === thread.persistence?.objectId（含两者都缺省）→ "do"
 *   同 object 内 fork 出的子线程；creator 是父 thread。
 *   creator window = type=do, targetThreadId=父 thread id, isCreatorWindow=true。
 * - thread.creatorObjectId 与 self 不同 → "talk"
 *   跨对象 talk 派生 callee thread；creator 是 caller object 的某个 thread。
 *   creator window = type=talk, target=caller object, targetThreadId=caller thread,
 *   isCreatorWindow=true。callee 通过该 talk_window.say 回复给 caller。
 *
 * 两种 window 共用 creatorWindowIdOf(threadId) 派生的稳定 id；幂等插入。
 */

import {
  ROOT_WINDOW_ID,
  SESSION_CREATOR_THREAD_ID,
  creatorWindowIdOf,
  type ContextWindow,
  type DoWindow,
  type TalkWindow,
} from "./types.js";
import type { ThreadContext } from "../../thinkable/context.js";

export interface InitContextWindowsOpts {
  /** thread 的 creator thread id；缺省 = SESSION_CREATOR_THREAD_ID（仅 root thread 适用）。 */
  creatorThreadId?: string;
  /** 初始任务标题；将作为 creator window 的 title。 */
  initialTaskTitle: string;
}

/** thread 的 creator 是否=自己（同 object）。缺省字段视为同 object，回退 do_window。 */
function isCreatorSelf(thread: ThreadContext): boolean {
  const self = thread.persistence?.objectId;
  const creator = thread.creatorObjectId;
  if (!creator) return true;
  if (!self) return true;
  return creator === self;
}

/**
 * user.root 是整个 session 的交互起点；它不存在 "creator"，所以也不应该有
 * 初始 creator window（do/talk 都不合适）。本函数 short-circuit 这种 thread。
 */
function isUserRootThread(thread: ThreadContext): boolean {
  return thread.persistence?.objectId === "user" && thread.id === "root";
}

export function initContextWindows(
  thread: ThreadContext,
  opts: InitContextWindowsOpts,
): void {
  if (isUserRootThread(thread)) {
    thread.contextWindows = thread.contextWindows ?? [];
    return;
  }
  const creatorWindowId = creatorWindowIdOf(thread.id);
  const list = thread.contextWindows ?? [];
  if (list.some((w) => w.id === creatorWindowId)) {
    thread.contextWindows = list;
    return;
  }

  const creatorThreadId = opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID;
  const sameObject = isCreatorSelf(thread);

  const creatorWindow: ContextWindow = sameObject
    ? ({
        id: creatorWindowId,
        type: "do",
        parentWindowId: ROOT_WINDOW_ID,
        title: opts.initialTaskTitle,
        status: "running",
        createdAt: Date.now(),
        targetThreadId: creatorThreadId,
        isCreatorWindow: true,
      } satisfies DoWindow)
    : ({
        id: creatorWindowId,
        type: "talk",
        parentWindowId: ROOT_WINDOW_ID,
        title: opts.initialTaskTitle,
        status: "open",
        createdAt: Date.now(),
        target: thread.creatorObjectId!,
        targetThreadId: creatorThreadId,
        conversationId: creatorWindowId,
        isCreatorWindow: true,
      } satisfies TalkWindow);

  thread.contextWindows = [creatorWindow, ...list];
}
