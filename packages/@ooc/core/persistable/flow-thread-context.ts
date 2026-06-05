/**
 * Flow-layer thread context IO —— ooc-6 P6.§6 (2026-06-02).
 *
 * 把每个 thread 的 contextWindows 数组持久化到独立文件:
 *   `{baseDir}/flows/{sessionId}/{objectId}/threads/{threadId}/thread-context.json`
 *
 * 维度区分（关键不变量）:
 *   - state.json (Object 维度) — 仅 object 自身字段，跨线程共享，不含 contextWindows
 *   - thread-context.json (Thread 维度) — 该 thread 的 contextWindows 数组
 *       · 内置特性 (talk/do/todo/method_exec) 完整 inline，因为它们没有独立 state.json
 *       · 独立 flow object (plan/program/file/...) 仅放 ref `{ id, type, _ref: true, refObjectId }`
 *
 * 与同目录的 `context.json`（legacy contextRegistry，flow-context-registry.ts）共存：
 *   `context.json`        — legacy `{ version, members[] }` 视角参数注册表（P5'.1）
 *   `thread-context.json` — P6.§6 真正的 thread contextWindows 落盘（state ≠ context 实施点）
 *
 * 两者会在 §10 cleanup 阶段合并/裁剪；§6 阶段保持双写互不干扰。
 *
 * 写盘通过 enqueueSessionWrite 串行化，per-(objectId, threadId) 一个 key，
 * 避免同 thread 多路并发写互相覆盖。同 stone-object / flow-context / flow-runtime-object
 * 模式一致。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { threadDir, toJson, type ThreadPersistenceRef } from "./common.js";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";
import type { ContextWindow } from "../executable/windows/_shared/types.js";

/**
 * thread-context.json 中一条 contextWindow 的形态：
 *   - 内置特性：完整 inline ContextWindow（含全部业务字段）
 *   - 独立 flow object：只放轻量 ref，hydrate 时另读 `<refObjectId>/state.json`
 */
export type ThreadContextEntry =
  | ContextWindow
  | { id: string; type: string; _ref: true; refObjectId: string };

/** Thread context 文件 schema —— `{objectDir}/threads/{threadId}/thread-context.json` 的内容。 */
export interface ThreadContextFile {
  threadId: string;
  contextWindows: ThreadContextEntry[];
}

/**
 * 别名 —— 让调用方不必每次 import `ThreadPersistenceRef`，
 * 也明确 IO 范围 = (object 目录, thread 子目录) 的二元组。
 */
export type ThreadContextRef = ThreadPersistenceRef;

/** thread-context.json 绝对路径。 */
export function threadContextFile(ref: ThreadContextRef): string {
  return join(threadDir(ref), "thread-context.json");
}

/**
 * 写一份 thread-context.json。
 *
 * - 自动 `mkdir -p` 父目录（threads/<tid>/ 可能尚未存在）
 * - 串行化 key 包含 objectId + threadId，与 flow-runtime-object / thread-json 不冲突
 *   （后者按 objectId 串行；本文件粒度更细到 thread）
 * - 文件内容 = `{ threadId, contextWindows }`
 */
export async function writeThreadContext(
  ref: ThreadContextRef,
  contextWindows: ThreadContextEntry[],
): Promise<void> {
  const file = threadContextFile(ref);
  const payload: ThreadContextFile = { threadId: ref.threadId, contextWindows };
  const key = `flow-thread-context:${ref.baseDir}:${ref.sessionId}:${ref.objectId}:${ref.threadId}`;
  await enqueueSessionWrite(key, async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(payload), "utf8");
  });
}

/**
 * 读一份 thread-context.json。
 *
 * - ENOENT → null（caller 视为「该 thread 还没落过 context」）
 * - JSON parse 失败 → 抛错（fail-loud；坏数据应该被注意到）
 */
export async function readThreadContext(
  ref: ThreadContextRef,
): Promise<ThreadContextFile | null> {
  const file = threadContextFile(ref);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(raw) as ThreadContextFile;
}
