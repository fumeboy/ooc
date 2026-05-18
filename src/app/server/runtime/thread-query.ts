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
 * 返回 status=running OR waiting 的 {objectId, threadId} 列表。
 *
 * 用途:worker 跑完一个 job 后,扫该 session 找"running 但还没被调度"的 thread
 * 入队 follow-up job;同时 waiting 状态的 caller 也要入队,因为它们可能依赖跨
 * 对象 callee 的结束信号(由 worker.syncCrossObjectCalleeEnds 在入队后真正运行
 * 时唤醒)。
 *
 * 典型场景是跨对象 talk:caller say 后 callee 变 running,但 executor 拿不到
 * jobManager,无法主动入队;这里靠 worker 兜底,保证不会有"running 但永远没
 * runtime 跑"的孤儿 thread。waiting caller 同理:cross-object callee end 后,
 * caller 不知道,只能靠 worker 周期性扫 + 同步函数唤醒。
 */
export async function scanRunningThreads(
  baseDir: string,
  sessionId: string
): Promise<Array<{ objectId: string; threadId: string }>> {
  return scanThreadsByStatus(baseDir, sessionId, ["running", "waiting"]);
}

async function scanThreadsByStatus(
  baseDir: string,
  sessionId: string,
  statuses: string | string[],
): Promise<Array<{ objectId: string; threadId: string }>> {
  const wanted = new Set(Array.isArray(statuses) ? statuses : [statuses]);
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
      if (thread?.status && wanted.has(thread.status)) {
        found.push({ objectId: obj.name, threadId: td.name });
      }
    }
  }
  return found;
}
