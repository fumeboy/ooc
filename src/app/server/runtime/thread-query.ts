import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readThread } from "@src/persistable";

/**
 * 扫 flows/{sessionId}/objects/ 下所有 object 的 threads/，
 * 返回 status=paused 的 {objectId, threadId} 列表。
 * 任一层目录不存在直接当作空集，不抛异常。
 */
export async function scanPausedThreads(
  baseDir: string,
  sessionId: string
): Promise<Array<{ objectId: string; threadId: string }>> {
  return scanThreadsByStatus(baseDir, sessionId, "paused");
}

/**
 * 扫 flows/{sessionId}/objects/ 下所有 object 的 threads/，
 * 返回 status=running 的 {objectId, threadId} 列表。
 *
 * 用途:worker 跑完一个 job 后,扫该 session 找"running 但还没被调度"的 thread
 * 入队 follow-up job。典型场景是跨对象 talk:caller 的 say 通过
 * deliverTalkMessage 在另一个 object 下创建/唤醒 callee thread,但 executor 层
 * 拿不到 jobManager,无法主动入队;这里靠 worker 兜底,保证不会有"running 但永远没
 * runtime 跑"的孤儿 thread。
 */
export async function scanRunningThreads(
  baseDir: string,
  sessionId: string
): Promise<Array<{ objectId: string; threadId: string }>> {
  return scanThreadsByStatus(baseDir, sessionId, "running");
}

async function scanThreadsByStatus(
  baseDir: string,
  sessionId: string,
  status: string,
): Promise<Array<{ objectId: string; threadId: string }>> {
  const objectsRoot = join(baseDir, "flows", sessionId, "objects");
  let objectDirs;
  try {
    objectDirs = await readdir(objectsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const found: Array<{ objectId: string; threadId: string }> = [];
  for (const obj of objectDirs) {
    if (!obj.isDirectory()) continue;
    const threadsDir = join(objectsRoot, obj.name, "threads");
    let threadDirs;
    try {
      threadDirs = await readdir(threadsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const td of threadDirs) {
      if (!td.isDirectory()) continue;
      const thread = await readThread({ baseDir, sessionId, objectId: obj.name }, td.name);
      if (thread?.status === status) {
        found.push({ objectId: obj.name, threadId: td.name });
      }
    }
  }
  return found;
}
