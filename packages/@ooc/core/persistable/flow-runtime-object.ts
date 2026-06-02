/**
 * Flow-layer runtime object state IO —— ooc-6 Object Unification Phase 5'.1.
 *
 * runtime-created object 在 flow 中的状态文件：
 *   `{baseDir}/flows/{sessionId}/{objectId}/state.json`
 *
 * objectId == window.id（设计上扁平：不嵌套到 parent）。
 *
 * state.json 的内容暂时复用 ContextWindow 类型（含 type + 全部 type-specific 字段）；
 * 后续可演化为更细粒度的 schema（如 type 分文件 / 不含 thread-level 字段）。
 *
 * 双写期（P5'.1）：与 flow-context.ts 的嵌套 context/<id>/window.json 并存。
 * 切读路径（P5'.2）后即可逐步移除嵌套写。
 */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";
import { enqueueSessionWrite } from "./serial-queue";
import type { ContextWindow } from "../executable/windows/_shared/types.js";

/** runtime object 状态文件路径 = `{objectDir(ref)}/state.json`。 */
export function runtimeObjectStateFile(ref: FlowObjectRef): string {
  return join(objectDir(ref), "state.json");
}

/**
 * 写 runtime object 状态。
 *
 * 通过 enqueueSessionWrite 串行化（同 stone-object / flow-context 模式）。
 * - 自动 mkdir -p；
 * - 使用 toJson(2-space + 末尾换行) 保持仓库格式一致。
 *
 * P6.§6 (2026-06-02): contextWindows 已搬迁到 `<oid>/threads/<tid>/context.json`
 * （flow-thread-context.ts）。本写盘函数会主动剥离传入 state 中可能残留的
 * `contextWindows` 字段，确保 state.json 只存 object 自身字段（object 维度），
 * 与 thread 维度的 context.json 严格分文件——这是 state ≠ context 不变量的写盘端实施点。
 */
export async function writeRuntimeObjectState(
  ref: FlowObjectRef,
  state: ContextWindow,
): Promise<void> {
  const file = runtimeObjectStateFile(ref);
  // P6.§6: strip contextWindows — 写 state.json 只保留 object 自身字段。
  const stateForDisk = stripContextWindowsField(state);
  const key = `flow-runtime-object:${ref.baseDir}:${ref.sessionId}:${ref.objectId}`;
  await enqueueSessionWrite(key, async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(stateForDisk), "utf8");
  });
}

/**
 * P6.§6: 把 ContextWindow / Object 中的 `contextWindows` 字段剥离掉，
 * 防止它流入 state.json。返回浅 clone（不修改入参）。
 *
 * 早期实现把 thread 的 contextWindows 数组放在 state.json 同一文件，
 * 结果 state（object 维度）和 context（thread 维度）混在一起。新布局下
 * contextWindows 改写到 `<oid>/threads/<tid>/context.json`；这里负责守门。
 */
function stripContextWindowsField(state: ContextWindow): ContextWindow {
  if (!("contextWindows" in (state as object))) return state;
  const { contextWindows: _drop, ...rest } = state as ContextWindow & {
    contextWindows?: unknown;
  };
  return rest as ContextWindow;
}

/**
 * 读 runtime object 状态。
 * - 文件不存在（ENOENT） → undefined（caller 视为 "object 已被删除 / 从未创建"）；
 * - JSON parse 失败 → 抛错（fail-loud；坏数据应该被注意到）。
 */
export async function readRuntimeObjectState(
  ref: FlowObjectRef,
): Promise<ContextWindow | undefined> {
  const file = runtimeObjectStateFile(ref);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(raw) as ContextWindow;
}

/**
 * 删除 runtime object 整个目录（含 state.json + threads/ + 任何子产物）。
 * close 时调用；幂等（ENOENT 静默吞掉）。
 *
 * **注意**：reference counting 由 caller 负责（先扫 registry 确认无其他 thread
 * 引用），本函数无条件删除。
 */
export async function deleteRuntimeObject(ref: FlowObjectRef): Promise<void> {
  const dir = objectDir(ref);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * 创建 runtime object：写出 state.json（首次创建时使用）。
 *
 * 当前与 writeRuntimeObjectState 行为一致；保留独立 API 以便后续区分
 * 创建（应触发 .flow.json 等元数据）vs 更新（仅刷 state）的语义。
 */
export async function createRuntimeObject(
  ref: FlowObjectRef,
  state: ContextWindow,
): Promise<void> {
  await writeRuntimeObjectState(ref, state);
}
