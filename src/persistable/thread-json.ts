import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type FlowObjectRef, type ThreadPersistenceRef } from "./common";
import type { ThreadContext } from "../thinkable/context";
import { initContextWindows } from "../executable/windows/init";

/**
 * thread.json 的最小读写。
 *
 * Step 3（spec 2026-05-14 § 迁移节奏 Step 3）：移除 Step 1 的 LegacyThreadJson 兼容层。
 * 反序列化后只做一件兜底：若 contextWindows 缺 creator do_window，自动补一个
 * （历史数据可能缺，新数据 init 时一定有）。
 */

/** 单个线程的 `thread.json` 绝对路径。 */
export function threadFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "thread.json");
}

/**
 * 持久化前剥离 in-process 内存字段。
 *
 * 当前规则:
 * - IssueWindow.lastSeenCommentId / lastNotifiedAt 是 worker 内存语义
 *   (plan §4 决策 11),不应进 thread.json,否则重启后游标可能比 Issue 文件
 *   还前进,导致永远收不到通知(plan A5 修正)
 *
 * 新增 in-process 字段时在这里扩。
 */
function stripVolatileForPersist(thread: ThreadContext): ThreadContext {
  return {
    ...thread,
    contextWindows: thread.contextWindows.map((window) => {
      if (window.type === "issue") {
        const { lastSeenCommentId: _seen, lastNotifiedAt: _notif, ...rest } = window;
        return rest;
      }
      return window;
    }),
  };
}

/** 把线程上下文持久化到 `thread.json`；线程未携带 persistence ref 时静默跳过。 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  if (!thread.persistence) return;
  await mkdir(threadDir(thread.persistence), { recursive: true });
  const sanitized = stripVolatileForPersist(thread);
  await writeFile(threadFile(thread.persistence), toJson(sanitized), "utf8");
}

/** 从磁盘恢复线程上下文，并把 persistence ref 重新挂上。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string,
): Promise<ThreadContext | undefined> {
  const persistence: ThreadPersistenceRef = { ...ref, threadId };
  try {
    const raw = await readFile(threadFile(persistence), "utf8");
    const parsed = JSON.parse(raw) as ThreadContext;
    const restored: ThreadContext = {
      ...parsed,
      contextWindows: Array.isArray(parsed.contextWindows) ? parsed.contextWindows : [],
      persistence,
    };
    // 兜底：缺 creator window 时补一个（spec § 初始 creator 对话 window）
    initContextWindows(restored, {
      creatorThreadId: restored.creatorThreadId,
      initialTaskTitle: `thread ${restored.id}`,
    });
    return restored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
