import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type FlowObjectRef, type ThreadPersistenceRef } from "./common";
import type { ThreadContext } from "../thinkable/context";

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
  threadId: string
): Promise<ThreadContext | undefined> {
  const persistence: ThreadPersistenceRef = { ...ref, threadId };
  try {
    const raw = await readFile(threadFile(persistence), "utf8");
    const parsed = JSON.parse(raw) as ThreadContext;
    return { ...parsed, persistence };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
