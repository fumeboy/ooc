import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { STONE_CHILDREN_SUBDIR } from "@ooc/core/persistable";
import { readThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";

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

/**
 * 列出 flows/ 下所有 session 目录名。flows/ 不存在或读失败时返回空集，不抛——
 * 与 worker bootstrap / global pause 解除的退化路径一致。
 */
export async function listSessionIds(baseDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(baseDir, "flows"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * 递归扫 flows/{sessionId}/objects/ 下任意深度的 flow object 目录，按 thread.json
 * 的 status 过滤。
 *
 * 子 object 嵌套布局（方案 A——object 落 objects/，与 stone 对齐 `children/` marker）：
 *   flows/<sid>/objects/<a>/threads/<t1>                          → objectId="a"
 *   flows/<sid>/objects/<a>/children/<b>/threads/<t2>             → objectId="a/b"
 *   flows/<sid>/objects/<a>/children/<b>/children/<c>/threads/<t3>→ objectId="a/b/c"
 *
 * 一个目录被识别为 flow object iff 它直接含 `.flow.json`（与 createFlowObject 一致）。
 * 该目录内 `threads/` 子目录读 thread.json，按 status 过滤；同时进入它的 `children/`
 * 子目录对每个条目递归——`children/` 是 sub-object 的唯一物理出入口。
 *
 * objectId 派生规则：路径相对 `flows/<sid>/objects/` 的所有 segment **剥掉 `children/` 段**后用
 * "/" 拼。例：`objects/a/children/b/children/c/.flow.json` → objectId="a/b/c"。
 *
 * 所有 ENOENT / EACCES 都吞为空集，保证 worker bootstrap 不被磁盘异常拖垮。
 */
async function scanThreadsByStatus(
  baseDir: string,
  sessionId: string,
  statuses: string | string[],
): Promise<Array<{ objectId: string; threadId: string }>> {
  const wanted = new Set(Array.isArray(statuses) ? statuses : [statuses]);
  const objectsRoot = join(baseDir, "flows", sessionId, "objects");
  const found: Array<{ objectId: string; threadId: string }> = [];

  // 入口：扫 flows/<sid>/objects/ 下每个 top-level 条目，每个都是 objectId 的第一 segment（无 children/ 包裹）。
  let topEntries: Dirent[];
  try {
    topEntries = await readdir(objectsRoot, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "ENOTDIR") return found;
    throw error;
  }
  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue; // 隐藏目录（如 .session.json 不可能；但稳妥）
    await walkObjectDir(
      join(objectsRoot, entry.name),
      [entry.name],
      baseDir,
      sessionId,
      wanted,
      found,
    );
  }
  return found;
}

/**
 * 递归一层 flow object 目录。
 *
 * @param dir 当前 flow object 目录的绝对路径（一级 segment 已并入；从 sessionDir 视角看，
 *            形如 `<sid>/a` 或 `<sid>/a/children/b`）。
 * @param idSegments 当前 objectId 的逻辑 segment 数组（不含 children/）。dir 自身被识别为
 *            objectId = idSegments.join("/")。
 *
 * dir 自身含 `.flow.json` 时视为一个 flow object，扫它的 threads/，并对它的 `children/`
 * 子目录里的每一项递归（作为下一级 sub-object）。
 */
async function walkObjectDir(
  dir: string,
  idSegments: string[],
  baseDir: string,
  sessionId: string,
  wanted: Set<string>,
  found: Array<{ objectId: string; threadId: string }>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "ENOTDIR") return;
    throw error;
  }

  // 是否是 flow object：含 `.flow.json`（与 createFlowObject 一致）
  const isFlowObject = entries.some((e) => e.isFile() && e.name === ".flow.json");
  const objectId = idSegments.join("/");

  if (isFlowObject && idSegments.length > 0) {
    const threadsDir = join(dir, "threads");
    let threadDirs: Dirent[] = [];
    try {
      threadDirs = await readdir(threadsDir, { withFileTypes: true });
    } catch {
      threadDirs = [];
    }
    for (const td of threadDirs) {
      if (!td.isDirectory()) continue;
      const thread = await readThread({ baseDir, sessionId, objectId }, td.name);
      if (thread?.status && wanted.has(thread.status)) {
        found.push({ objectId, threadId: td.name });
      }
    }
  }

  // 递归 sub-object：只下到 `children/` 目录里（其它子目录如 knowledge/ data.json 不属于
  // sub-object 物理空间，必须被忽略，否则 walker 会把 knowledge/ 误识别成 object）。
  const childrenEntry = entries.find(
    (e) => e.isDirectory() && e.name === STONE_CHILDREN_SUBDIR,
  );
  if (!childrenEntry) return;
  const childrenDir = join(dir, STONE_CHILDREN_SUBDIR);
  let childEntries: Dirent[];
  try {
    childEntries = await readdir(childrenDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ce of childEntries) {
    if (!ce.isDirectory()) continue;
    if (ce.name.startsWith(".")) continue;
    await walkObjectDir(
      join(childrenDir, ce.name),
      [...idSegments, ce.name],
      baseDir,
      sessionId,
      wanted,
      found,
    );
  }
}
