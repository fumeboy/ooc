/**
 * Thread 初始化 helper — 给任何新建 thread 注入指向 creator 的初始 window。
 *
 * spec § 初始 creator 对话 window：每个 thread 启动时必有一条与创建方的恒在通道。
 *
 * 两种 creator 形态：
 *
 * - "do"  — fork 出来的子线程；creator 是父 thread。
 *           creator window = type=do, targetThreadId=父 thread id, isCreatorWindow=true。
 * - "talk" — 通过跨对象 talk 派生出来的 callee thread；creator 是 caller object 的某个 thread。
 *           creator window = type=talk, target=caller object, targetThreadId=caller thread,
 *           isCreatorWindow=true。callee 通过该 talk_window.say 回复给 caller。
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

export type CreatorKind = "do" | "talk";

export interface InitContextWindowsOpts {
  /** thread 的 creator thread id；缺省 = SESSION_CREATOR_THREAD_ID（仅 root thread 适用）。 */
  creatorThreadId?: string;
  /** 初始任务标题；将作为 creator window 的 title。 */
  initialTaskTitle: string;
  /**
   * creator window 类型；
   * - "do"  ：默认；fork 子线程或 root thread 兜底
   * - "talk"：跨对象 talk 派生 callee thread；要求同时给 callerObjectId
   */
  creatorKind?: CreatorKind;
  /** 仅 creatorKind === "talk" 时使用：caller 所在 object id。 */
  callerObjectId?: string;
}

export function initContextWindows(
  thread: ThreadContext,
  opts: InitContextWindowsOpts,
): void {
  const creatorWindowId = creatorWindowIdOf(thread.id);
  const list = thread.contextWindows ?? [];
  if (list.some((w) => w.id === creatorWindowId)) {
    thread.contextWindows = list;
    return;
  }

  const creatorThreadId = opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID;
  const creatorWindow: ContextWindow = opts.creatorKind === "talk"
    ? ({
        id: creatorWindowId,
        type: "talk",
        parentWindowId: ROOT_WINDOW_ID,
        title: opts.initialTaskTitle,
        status: "open",
        createdAt: Date.now(),
        target: opts.callerObjectId ?? "user",
        targetThreadId: creatorThreadId,
        conversationId: creatorWindowId,
        isCreatorWindow: true,
      } satisfies TalkWindow)
    : ({
        id: creatorWindowId,
        type: "do",
        parentWindowId: ROOT_WINDOW_ID,
        title: opts.initialTaskTitle,
        status: "running",
        createdAt: Date.now(),
        targetThreadId: creatorThreadId,
        isCreatorWindow: true,
      } satisfies DoWindow);

  thread.contextWindows = [creatorWindow, ...list];
}
