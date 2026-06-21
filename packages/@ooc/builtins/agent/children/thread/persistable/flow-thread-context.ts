/**
 * thread-context.json 持久化 —— thread builtin 自有逻辑（不属 core）。
 *
 * thread 是 builtin object：它的窗状态怎么落盘是 thread 自己的逻辑（object-model 核心 7）。
 * 原 `core/persistable/flow-thread-context.ts` 已退潮收纳到此（core 不再持有 thread 序列化入口）。
 *
 * 把每个 thread 的 contextWindows 数组持久化到独立文件:
 *   `{baseDir}/flows/{sessionId}/{objectId}/threads/{threadId}/thread-context.json`
 *
 * 维度区分（关键不变量）:
 *   - data.json (Object 维度) — 仅 object 自身字段（裸 Data），跨线程共享，不含 contextWindows
 *   - thread-context.json (Thread 维度) — 该 thread 的 contextWindows 数组
 *       · 内置特性 (talk/do/todo/method_exec) 完整 inline，因为它们没有独立 data.json
 *       · 独立 flow object (plan/program/file/...) 仅放 ref `{ id, type, _ref: true, refObjectId }`
 *
 * 写盘通过 enqueueSessionWrite 串行化，per-(objectId, threadId) 一个 key，
 * 避免同 thread 多路并发写互相覆盖。同 stone-object / flow-context / flow-runtime-object
 * 模式一致。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { threadDir, toJson, type ThreadPersistenceRef } from "@ooc/core/persistable/common.js";
import { enqueueSessionWrite } from "@ooc/core/runtime/serial-queue.js";
import type { WindowStatus } from "@ooc/core/_shared/types/context-window.js";

/**
 * thread-context.json 中一条 inline contextWindow 的**磁盘形态**（平铺：class/data 在 entry 顶层）。
 *
 * 内存里 OocObjectInstance 把对象身份收进 `.object={class,data}` 子对象，但磁盘格式保持平铺历史形态
 * （`class`/`data` 仍在 entry 顶层）——内存 `.object.class` ↔ 盘上 `class`、`.object.data` ↔ 盘上 `data`。
 * 会话窗 class=`_builtin/thread`（真实注册 class）照常 inline；talk/reflect_request 投影 class 是 POV
 * 派生值、不在实例里，渲染期由 thread readable 内 computeProjectionClass 动态算（context.md 核心 2/8/9），
 * 故磁盘也不存它。
 */
export interface InlineThreadContextEntry {
  id: string;
  class: string;
  data: unknown;
  parentObjectId?: string;
  title: string;
  status: WindowStatus;
  createdAt: number;
  win?: unknown;
  closable?: boolean;
  objectRef?: { objectId: string; class: string };
}

/**
 * thread-context.json 中一条 contextWindow 的形态：
 *   - 内置特性：完整 inline entry（平铺 class/data + 全部窗视角态字段）。
 *     · 会话窗 class=`_builtin/thread`（真实注册 class）照常 inline；talk/reflect_request
 *       投影 class 是 POV 派生值、不在实例里，渲染期由 thread readable 内 computeProjectionClass
 *       动态算（context.md 核心 2/8/9），故磁盘也不存它。
 *   - 独立 flow object：只放轻量 ref，hydrate 时另读 `<refObjectId>/data.json`
 */
export type ThreadContextEntry =
  | InlineThreadContextEntry
  | { id: string; class: string; _ref: true; refObjectId: string };

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
