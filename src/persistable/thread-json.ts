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

/** 把线程上下文持久化到 `thread.json`；线程未携带 persistence ref 时静默跳过。 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  if (!thread.persistence) return;
  await mkdir(threadDir(thread.persistence), { recursive: true });
  await writeFile(threadFile(thread.persistence), toJson(thread), "utf8");
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
