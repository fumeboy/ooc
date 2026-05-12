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
      if (thread?.status === "paused") {
        found.push({ objectId: obj.name, threadId: td.name });
      }
    }
  }
  return found;
}
