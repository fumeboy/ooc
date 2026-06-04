/**
 * Flow-layer thread context registry IO —— ooc-6 Object Unification Phase 5'.1.
 *
 * 每个 thread 持有一份 context.json，记录该 thread context 中 hold 的 objects 与
 * thread-level 视角参数（compressLevel / order / decayMeta / parentObjectId）。
 *
 * 路径：`{threadDir(ref)}/context.json`
 *
 * 与 thread.json.contextWindows[] 并存（双写期）；P5'.4 后 contextWindows[] 字段
 * 退役，仅留 registry。
 *
 * **多视角共享**：同一 objectId 可同时被多个 thread 的 context.json 引用，view
 * 参数（compressLevel/order）可独立。reference counting 在 close 时由 manager
 * 跨 thread 扫描整 `flows/<sid>/` 决定是否物理删除 object 目录。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { threadDir, toJson, type ThreadPersistenceRef } from "./common";
import { enqueueSessionWrite } from "./serial-queue";

/**
 * v1 schema：
 * - version 字段必填；未来 schema 演化通过 version 升级
 * - members 列表无序（上层按 params.order 排序）
 */
export interface ContextRegistry {
  version: 1;
  members: ContextMember[];
}

export interface ContextMember {
  /** 关联到 `flows/<sid>/<objectId>/state.json`。 */
  objectId: string;
  /** thread-level 视角参数；不复制 object 自身状态。 */
  params: ContextParams;
}

export interface ContextParams {
  /** 压缩级别（替代 ContextWindow.compressLevel）。 */
  compressLevel?: number;
  /** 自然衰减运行时计数（legacy 兼容；P6 BudgetManager 不再使用）。 */
  decayMeta?: { lastTouchedAt: number; idleRounds: number } | null;
  /** 在 context 中的展示顺序（取代 contextWindows[] 数组下标）。 */
  order?: number;
  /** parent object reference（取代 ContextWindow.parentWindowId，仅对 form 等 child 关系有意义）。 */
  parentObjectId?: string;
}

/** 默认空 registry —— 文件不存在时使用。 */
export const EMPTY_REGISTRY: ContextRegistry = { version: 1, members: [] };

/** path = `{threadDir(ref)}/context.json`。 */
export function contextRegistryFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "context.json");
}

/**
 * 读 thread 的 context registry。
 * - 文件不存在 → 返回 EMPTY_REGISTRY；
 * - 已有但 version 不是 1 → fail-loud（避免误用未来 schema）。
 */
export async function readContextRegistry(
  ref: ThreadPersistenceRef,
): Promise<ContextRegistry> {
  const file = contextRegistryFile(ref);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, members: [] };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as ContextRegistry;
  if (parsed.version !== 1) {
    throw new Error(
      `[readContextRegistry] unsupported version ${(parsed as { version: unknown }).version} at ${file}`,
    );
  }
  return parsed;
}

/**
 * 整体写 registry。manager.flushRegistry 调用。
 * - 通过 enqueueSessionWrite 串行；
 * - mkdir -p 兜底（thread dir 一般已存在，但写 registry 在 thread 第一次落盘时也合法）。
 */
export async function writeContextRegistry(
  ref: ThreadPersistenceRef,
  registry: ContextRegistry,
): Promise<void> {
  const file = contextRegistryFile(ref);
  const key = `flow-context-registry:${ref.baseDir}:${ref.sessionId}:${ref.objectId}:${ref.threadId}`;
  await enqueueSessionWrite(key, async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(registry), "utf8");
  });
}
