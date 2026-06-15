/**
 * Flow-layer thread context IO。
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
 *   `context.json`        — legacy `{ version, members[] }` 视角参数注册表
 *   `thread-context.json` — 真正的 thread contextWindows 落盘（state ≠ context 实施点）
 *
 * 两者会在 cleanup 阶段合并/裁剪；当前阶段保持双写互不干扰。
 *
 * 写盘通过 enqueueSessionWrite 串行化，per-(objectId, threadId) 一个 key，
 * 避免同 thread 多路并发写互相覆盖。同 stone-object / flow-context / flow-runtime-object
 * 模式一致。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { threadDir, toJson, type ThreadPersistenceRef } from "./common.js";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";
import {
  ROOT_WINDOW_ID,
  isNonPersistedWindow,
  type BaseContextWindow,
  type ContextWindow,
} from "../executable/windows/_shared/types.js";
import { isTalkLikeClass } from "../_shared/types/constants.js";

/**
 * thread-context.json 中一条 contextWindow 的形态：
 *   - 内置特性：完整 inline ContextWindow（含全部业务字段）
 *     · talk-family（talk/reflect_request）inline 项**不写 class**——class 是 POV 投影
 *       （context.md core 7），由 readThread 经 computeProjectionClass 在读回时重算；
 *       磁盘只存窗形态（isForkWindow/isCreatorWindow）+ 展示状态。
 *   - 独立 flow object：只放轻量 ref，hydrate 时另读 `<refObjectId>/state.json`
 */
export type ThreadContextEntry =
  | ContextWindow
  | Omit<ContextWindow, "class">
  | { id: string; class: string; _ref: true; refObjectId: string };

/** Thread context 文件 schema —— `{objectDir}/threads/{threadId}/thread-context.json` 的内容。 */
export interface ThreadContextFile {
  threadId: string;
  contextWindows: ThreadContextEntry[];
}

/**
 * buildThreadContextEntries —— 把一组内存里的 contextWindows 序列化成 thread-context.json
 * 的 entry 数组（**唯一**生成规则来源）。
 *
 * registry 以参数注入（最小结构 `{ isBuiltinFeatureType }`），避免 persistable ↔ runtime
 * 循环 import。两处调用方共用本函数，保证 writeThread 单点刷与 WindowManager.snapshot
 * 不产生不一致写：
 *   - WindowManager.writeThreadContextSnapshot（manager.ts）
 *   - writeThread（thread-json.ts，覆盖所有绕过 WindowManager 的写路径）
 *
 * 生成规则（与原 manager.ts:921-938 等价）：
 *   - root window 跳过
 *   - isNonPersistedWindow（volatile derived + self 门面窗）跳过——无 state.json，
 *     落成 _ref 后 reload 必报 missing object。
 *   - registry.isBuiltinFeatureType(type) === true → 完整 inline ContextWindow
 *   - 否则（独立 flow object）→ 轻量 ref `{ id, type, _ref: true, refObjectId: id }`
 */
export function buildThreadContextEntries(
  windows: Iterable<BaseContextWindow>,
  registry: { isBuiltinFeatureType(type: string): boolean },
): ThreadContextEntry[] {
  const entries: ThreadContextEntry[] = [];
  for (const window of windows) {
    if (window.id === ROOT_WINDOW_ID) continue;
    if (isNonPersistedWindow(window)) continue;
    if (registry.isBuiltinFeatureType(window.class)) {
      // 内置特性整窗 inline 落盘（state 即 context）。BaseContextWindow → ThreadContextEntry
      // 的 inline 分支等价于 ContextWindow union 的结构基，cast 安全。
      if (isTalkLikeClass(window.class)) {
        // talk-family（talk/reflect_request）：class 是 POV 投影，不落盘——读回时由
        // computeProjectionClass 据窗形态 + thread session 重算。仅剥 class，其余字段照常 inline。
        const { class: _dropClass, ...rest } = window as ContextWindow;
        entries.push(rest as Omit<ContextWindow, "class">);
      } else {
        entries.push(window as ContextWindow);
      }
    } else {
      entries.push({
        id: window.id,
        class: window.class,
        _ref: true,
        refObjectId: window.id,
      });
    }
  }
  return entries;
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
