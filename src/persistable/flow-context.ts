/**
 * Flow-layer context/ directory IO —— runtime 创建的 OOC Object 以嵌套结构持久化，
 * 自然成为 parent object 的 context window（2026-05-28 ooc-6 Object Unification）。
 *
 * 路径形态：
 *   `{baseDir}/flows/{sessionId}/objects/{parentObjectId}/context/{contextObjectId}/window.json`
 *
 * 其中：
 * - parentObjectId = window.parentWindowId（root 时为 "root"）
 * - contextObjectId = window.id
 *
 * 双读模式（dual-read）：
 * - 读：从 context/ 目录 + thread.contextWindows[] 合并，context/ 优先
 * - 写：同时写 context/ 和 thread.contextWindows[]（保持向后兼容）
 *
 * 迁移节奏：先双写双读，等所有 stones 都迁移到新格式后，再移除 thread.contextWindows[]。
 */

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";
import { enqueueSessionWrite } from "./serial-queue";
import type { ContextWindow } from "../executable/windows/_shared/types.js";

/** context/ 子目录名（与 stone 的 context/ 对齐）。 */
export const CONTEXT_SUBDIR = "context";

/**
 * 计算 parent object 的 context/ 目录绝对路径。
 * 即：`flows/<sid>/objects/<parentId>/context/`
 */
export function contextDir(ref: FlowObjectRef, parentObjectId: string): string {
  return join(
    ref.baseDir,
    "flows",
    ref.sessionId,
    "objects",
    ...parentObjectId.split("/").flatMap((seg, i) => i === 0 ? [seg] : ["children", seg]),
    CONTEXT_SUBDIR,
  );
}

/**
 * 计算单个 context object 的目录绝对路径。
 * 即：`flows/<sid>/objects/<parentId>/context/<contextId>/`
 */
export function contextObjectDir(
  ref: FlowObjectRef,
  parentObjectId: string,
  contextObjectId: string,
): string {
  return join(contextDir(ref, parentObjectId), contextObjectId);
}

/**
 * 计算单个 context object 的 window.json 绝对路径。
 */
export function contextObjectFile(
  ref: FlowObjectRef,
  parentObjectId: string,
  contextObjectId: string,
): string {
  return join(contextObjectDir(ref, parentObjectId, contextObjectId), "window.json");
}

/**
 * 读取 parent object 的 context/ 目录下所有 runtime-created objects。
 * 返回按 id 索引的 ContextWindow map。
 *
 * - 目录不存在 → 空 Map
 * - 单个 window.json 解析失败 → warn 并跳过（graceful）
 */
export async function readContextObjects(
  ref: FlowObjectRef,
  parentObjectId: string,
): Promise<Map<string, ContextWindow>> {
  const result = new Map<string, ContextWindow>();
  const ctxDir = contextDir(ref, parentObjectId);

  let entries: string[];
  try {
    entries = await readdir(ctxDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const contextId = entry.name;
    try {
      const file = contextObjectFile(ref, parentObjectId, contextId);
      const raw = await readFile(file, "utf8");
      const window = JSON.parse(raw) as ContextWindow;
      if (window && window.id && window.type) {
        result.set(window.id, window);
      }
    } catch (error) {
      console.warn(
        `[readContextObjects] 跳过损坏的 context object ${parentObjectId}/context/${contextId}: ${(error as Error).message}`,
      );
    }
  }

  return result;
}

/**
 * 递归读取一个 object 及其所有祖先的 context/ 目录，
 * 收集所有 runtime-created objects（用于 thread load 时注入）。
 *
 * 例如：objectId = "a/b/c" → 读 a/context/ + a/b/context/ + a/b/c/context/
 */
export async function readContextObjectsRecursive(
  ref: FlowObjectRef,
): Promise<Map<string, ContextWindow>> {
  const result = new Map<string, ContextWindow>();
  const segments = ref.objectId.split("/").filter(Boolean);

  // 从 root 开始，逐层累加祖先路径
  let currentPath = "";
  for (let i = 0; i < segments.length; i++) {
    currentPath = currentPath ? `${currentPath}/${segments[i]}` : segments[i];
    const objs = await readContextObjects(ref, currentPath);
    for (const [id, win] of objs) {
      result.set(id, win);
    }
  }

  return result;
}

/**
 * 写入一个 runtime-created object 到 parent 的 context/ 目录。
 *
 * 双写模式：本函数写 context/；调用方仍需写 thread.contextWindows[] 保持兼容。
 * 通过 enqueueSessionWrite 串行化，避免并发踩坏。
 */
export async function writeContextObject(
  ref: FlowObjectRef,
  parentObjectId: string,
  window: ContextWindow,
): Promise<void> {
  const file = contextObjectFile(ref, parentObjectId, window.id);
  const key = `flow-context:${ref.baseDir}:${ref.sessionId}:${parentObjectId}:${window.id}`;
  await enqueueSessionWrite(key, async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(window), "utf8");
  });
}

/**
 * 从 context/ 目录删除一个 runtime-created object（close 时清理）。
 * 静默跳过不存在的文件（幂等）。
 */
export async function deleteContextObject(
  ref: FlowObjectRef,
  parentObjectId: string,
  contextObjectId: string,
): Promise<void> {
  const { rm } = await import("node:fs/promises");
  const dir = contextObjectDir(ref, parentObjectId, contextObjectId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
