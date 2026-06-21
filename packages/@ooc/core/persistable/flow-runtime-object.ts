/**
 * Flow-layer runtime object data IO —— ooc-6 Object Unification。
 *
 * runtime-created object 在 flow 中的数据文件：
 *   `{baseDir}/flows/{sessionId}/{objectId}/data.json`
 *
 * objectId == window.id（设计上扁平：不嵌套到 parent）。
 *
 * data.json 的内容是该 object 的**裸 Data**（业务字段；object↔class 绑定由 `.flow.json`
 * 的 `class` 字段独立承载，故无需信封）；context-lifecycle 字段（status / parentWindowId /
 * createdAt 等）属于 thread-context.json，不进 data.json（由 writeRuntimeObjectData 的
 * stripContextWindowsField + manager 的 inline 持久化分流保证，inline 经 class
 * persistable.mode 声明、registry.isInlinePersisted 解析）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";

/** runtime object 数据文件路径 = `{objectDir(ref)}/data.json`。 */
export function runtimeObjectDataFile(ref: FlowObjectRef): string {
  return join(objectDir(ref), "data.json");
}

/**
 * 写 runtime object 的裸 Data。
 *
 * 通过 enqueueSessionWrite 串行化（同 stone-object / flow-context 模式）。
 * - 自动 mkdir -p；
 * - 使用 toJson(2-space + 末尾换行) 保持仓库格式一致。
 *
 * contextWindows 已搬迁到 `<oid>/threads/<tid>/context.json`
 * （flow-thread-context.ts）。本写盘函数会主动剥离传入 data 中可能残留的
 * `contextWindows` 字段，确保 data.json 只存 object 自身字段（object 维度），
 * 与 thread 维度的 context.json 严格分文件——这是 data ≠ context 不变量的写盘端实施点。
 */
export async function writeRuntimeObjectData(
  ref: FlowObjectRef,
  data: Record<string, unknown>,
): Promise<void> {
  const file = runtimeObjectDataFile(ref);
  // strip contextWindows — 写 data.json 只保留 object 自身字段。
  const dataForDisk = stripContextWindowsField(data);
  const key = `flow-runtime-object:${ref.baseDir}:${ref.sessionId}:${ref.objectId}`;
  await enqueueSessionWrite(key, async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(dataForDisk), "utf8");
  });
}

/**
 * 把 Data 中的 `contextWindows` 字段剥离掉，防止它流入 data.json。
 * 返回浅 clone（不修改入参）。
 *
 * 早期实现把 thread 的 contextWindows 数组放在同一文件，结果 data（object 维度）
 * 和 context（thread 维度）混在一起。新布局下 contextWindows 改写到
 * `<oid>/threads/<tid>/context.json`；这里负责守门。
 */
function stripContextWindowsField(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!("contextWindows" in data)) return data;
  const { contextWindows: _drop, ...rest } = data;
  return rest;
}

/**
 * 读 runtime object 的裸 Data。
 * - 文件不存在（ENOENT） → undefined（caller 视为 "object 已被删除 / 从未创建"）；
 * - JSON parse 失败 → 抛错（fail-loud；坏数据应该被注意到）。
 *
 * caller 用 `.flow.json` 的 `class` 字段重组实例（对象模型核心 1：重建实例必知其 class）。
 */
export async function readRuntimeObjectData(
  ref: FlowObjectRef,
): Promise<Record<string, unknown> | undefined> {
  const file = runtimeObjectDataFile(ref);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}
