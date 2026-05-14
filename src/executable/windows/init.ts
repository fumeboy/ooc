/**
 * Thread 初始化 helper — 给任何新建 thread 注入初始 creator do_window。
 *
 * spec § 初始 creator 对话 window：每个 thread 启动时必有一个指向 creator 的 do_window，
 * 作为该 thread 与创建方的恒在通道。
 *
 * - root thread：creatorThreadId 取约定值 SESSION_CREATOR_THREAD_ID（"__session__"），
 *   表示该 thread 由外部 session 启动
 * - child thread：creatorThreadId = 父 thread.id
 * - 已有 creator window 的 thread 不会重复注入（持久化恢复时也走这条 helper 兜底）
 */

import {
  ROOT_WINDOW_ID,
  SESSION_CREATOR_THREAD_ID,
  creatorWindowIdOf,
  type DoWindow,
} from "./types.js";
import type { ThreadContext } from "../../thinkable/context.js";

export interface InitContextWindowsOpts {
  /** thread 的 creator id；缺省 = SESSION_CREATOR_THREAD_ID（仅 root thread 适用）。 */
  creatorThreadId?: string;
  /** 初始任务标题；将作为 creator do_window 的 title。 */
  initialTaskTitle: string;
}

/**
 * 确保 thread.contextWindows 含一个 creator do_window。
 *
 * 幂等：如果已存在同 id 的 window 直接返回；不存在时插入到 contextWindows 数组开头。
 *
 * 使用场景：
 * - flows/service.ts 中创建 root thread 后调用一次
 * - persistable/thread-json.ts 反序列化旧数据时兜底调用
 * - commands/do.ts 创建 child thread 时已自行构造（保留独立路径，避免环依赖）
 */
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
  const creatorWindow: DoWindow = {
    id: creatorWindowId,
    type: "do",
    parentWindowId: ROOT_WINDOW_ID,
    title: opts.initialTaskTitle,
    status: "running",
    createdAt: Date.now(),
    targetThreadId: opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID,
    isCreatorWindow: true,
  };
  thread.contextWindows = [creatorWindow, ...list];
}
