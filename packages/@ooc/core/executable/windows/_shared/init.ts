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
import { DEFAULT_TRANSCRIPT_VIEWPORT } from "./transcript-viewport.js";
import type { ThreadContext } from "../../../thinkable/context.js";

export interface InitContextWindowsOpts {
  /** thread 的 creator thread id；缺省 = SESSION_CREATOR_THREAD_ID（仅 root thread 适用）。 */
  creatorThreadId?: string;
  /** 初始任务标题；将作为 creator window 的 title。 */
  initialTaskTitle: string;
}

/**
 * thread 的 creator 是否=自己（同 object **且同 session**）。缺省字段视为同 object，回退 do_window。
 *
 * "同 object" 决定 do vs talk 的语义层；但 do_window 是**同 session 内进程内**的父子机制
 * （findThreadInScope 只走内存 childThreads/_parentThreadRef 树），**无法跨 session 寻址**。
 * super-alias 场景（super flow）callee 在 "super" session、caller 在 user session：objectId
 * 相同但 session 不同——若按 do 处理，callee 用 do_window.continue / end({result}) 回报
 * creator 时 findThreadInScope 永远找不到 caller（caller 在另一 session 的 thread.json 上，
 * 不在本 job 内存树里）→ 静默失败。故 cross-session 必须落 talk_window（disk-based 派送，
 * deliverTalkMessage 通过 readThread/writeThread 跨 session 寻址），与 reflectable knowledge
 * "通过 creator talk_window 回复" 的指引一致。
 *
 * creatorSessionId 由 talk-delivery 在跨 session 创建 callee 时写入；缺省回退 self session（同 session）。
 */
function isCreatorSelf(thread: ThreadContext): boolean {
  const self = thread.persistence?.objectId;
  const creator = thread.creatorObjectId;
  if (!creator) return true;
  if (!self) return true;
  if (creator !== self) return false;
  // same object：再看 session。cross-session（如 super-alias）不能走 do_window。
  const selfSession = thread.persistence?.sessionId;
  const creatorSession = thread.creatorSessionId ?? selfSession;
  return creatorSession === selfSession;
}

/**
 * user.root 是整个 session 的交互起点；它不存在 "creator"，所以也不应该有
 * 初始 creator window（do/talk 都不合适）。本函数 short-circuit 这种 thread。
 */
function isUserRootThread(thread: ThreadContext): boolean {
  return thread.persistence?.objectId === "user" && thread.id === "root";
}

/**
 * thread 是否真有 creator（不是 self-driven root）。
 *
 * 任何一处携带 creator 信息都视为有：
 * - opts.creatorThreadId 显式给（fork/talk-delivery 调用方）
 * - thread.creatorThreadId（磁盘恢复时 thread.json 里写过）
 * - thread.creatorObjectId（跨 object talk-delivery 总会设这条）
 *
 * 三者全无 → self-driven root，没有可指向的 creator，不应注入 phantom creator window。
 * spec 2026-05-17 § wait 校验：phantom creator do_window 会被 wait 误判为合法 IO 来源，
 * 让 self-driven root 死锁——本函数从源头堵住。
 */
function hasRealCreator(thread: ThreadContext, opts: InitContextWindowsOpts): boolean {
  if (opts.creatorThreadId !== undefined) return true;
  if (thread.creatorThreadId !== undefined) return true;
  if (thread.creatorObjectId !== undefined) return true;
  return false;
}

export function initContextWindows(
  thread: ThreadContext,
  opts: InitContextWindowsOpts,
): void {
  // ooc-6: 当 thread 持有方是某 Object 时，幂等注入一个 self window
  // 单例作为该 Object 的"自我门面"。window id = object id（new design）。
  injectSelfWindowIfObjectThread(thread);

  if (isUserRootThread(thread)) {
    thread.contextWindows = thread.contextWindows ?? [];
    return;
  }
  if (!hasRealCreator(thread, opts)) {
    // self-driven root thread —— 没有可指向的 creator，don't inject phantom do_window
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
        transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT },
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
        transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT },
      } satisfies TalkWindow);

  thread.contextWindows = [creatorWindow, ...list];
}

/**
 * ooc-6 Object Unification —— 当 thread 持有方是某 Object 时，幂等注入一个 self window
 * 单例作为该 Object 的"自我门面"。
 *
 * 新设计（2026-06-01）：
 * - window id = object id（不再经过 custom: 前缀包装）
 * - window type = object id（每个 object 注册自己的 type）
 * - 不再有 custom window wrapper
 *
 * 注入条件：
 * - thread.persistence?.objectId 存在（thread 由该 Object 持有）
 * - 该 objectId 不是 "user"（user 不是 Agent，不需要 self window）
 *
 * 位置：root 之后，creator window 之前；保证 LLM 视野中 self window 的位置稳定。
 */
function injectSelfWindowIfObjectThread(thread: ThreadContext): void {
  const objectId = thread.persistence?.objectId;
  if (!objectId || objectId === "user") return;

  const id = objectId; // window id = object id (new design)
  const list = thread.contextWindows ?? (thread.contextWindows = []);
  if (list.some((w) => w.id === id)) return;

  const selfWindow: ContextWindow = {
    id,
    type: objectId as any,
    parentWindowId: ROOT_WINDOW_ID,
    title: objectId,
    status: "open",
    createdAt: Date.now(),
    // self 门面窗每次 init 幂等重注入、无独立 state.json → 标记为不持久化，
    // 否则 thread-context.json 落死 _ref，reload 刷屏 `references missing object <id>`。
    isSelfWindow: true,
  } as ContextWindow;

  // 紧跟 root 之后；creator window 仍由后续路径插到这之前/之后均可
  thread.contextWindows = [selfWindow, ...list];
}
